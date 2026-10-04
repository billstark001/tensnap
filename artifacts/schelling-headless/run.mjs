#!/usr/bin/env node

// Publication experiment, not part of the teaching example. Each run:
//   1. starts one real language host and connects the built TenSnap agent CLI;
//   2. checks its protocol projection against an independently read model sidecar;
//   3. captures, advances, restores, and replays an exact checkpoint;
//   4. forks two threshold trajectories from that checkpoint and renders a PNG.
// Hosts run sequentially so CLI builds and temporary contexts cannot race.
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { tmpdir, platform, arch } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const results = join(root, 'artifacts/schelling-headless/results');
const cliPath = join(root, 'packages/tensnap-agent/dist/cli.js');
const hosts = ['python', 'go', 'julia', 'js'];
const selected = process.argv.slice(2).length ? process.argv.slice(2) : hosts;
if (selected.some((host) => !hosts.includes(host)))
  throw new Error(`Choose hosts from ${hosts.join(', ')}`);
// The working tree may be uncommitted. Hash the sources that determine this
// experiment so a report identifies the implementation it actually exercised.
const sourceFiles = [
  'artifacts/schelling-headless/run.mjs',
  'examples/python_mesa/schelling.py',
  'examples/python_mesa/schelling_tensnap.py',
  'examples/python_mesa/schelling_viz.py',
  'examples/python_mesa/schelling_audit.py',
  'examples/python_mesa/schelling_checkpoint.py',
  'examples/go/internal/schelling/model.go',
  'examples/go/internal/schelling/checkpoint.go',
  'examples/go/internal/schelling/audit.go',
  'examples/go/internal/schelling/viz.go',
  'examples/go/internal/schelling/server.go',
  'examples/julia/schelling.jl',
  'examples/julia/schelling_tensnap.jl',
  'examples/julia/schelling_viz.jl',
  'examples/julia/schelling_audit.jl',
  'examples/js/src/models/schelling.ts',
  'examples/js/src/renderers/schelling.ts',
  'examples/js/src/entries/main-ws.ts',
  'examples/js/src/entries/schelling-audit.ts',
];

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const hash = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function command(binary, args, options = {}) {
  // CLI invocations are separate processes, but --context points each one at
  // the same local agent daemon and its single simulator connection.
  const { stdout } = await exec(binary, args, {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  return stdout.trim();
}

async function reservePort() {
  // Ask the OS for an unused port, then release it before starting the host.
  const server = createServer();
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', ok);
  });
  const port = server.address().port;
  await new Promise((ok) => server.close(ok));
  return port;
}

function launch(host, port, auditPath) {
  // All hosts receive the same scientific inputs. Julia uses environment
  // variables while the other launchers accept command-line flags.
  const common = [
    '--width',
    '16',
    '--height',
    '12',
    '--density',
    '0.72',
    '--balance',
    '0.5',
    '--threshold',
    '0.65',
    '--seed',
    '7',
    '--port',
    String(port),
  ];
  const choices = {
    python: [
      'python',
      [
        'examples/python_mesa/schelling_viz.py',
        ...common,
        '--encoding',
        'json',
        '--no-collect-data',
      ],
    ],
    go: ['go', ['run', './schelling', ...common], join(root, 'examples/go')],
    julia: ['julia', ['--project=examples/julia', 'examples/julia/schelling_viz.jl']],
    js: [
      'pnpm',
      ['--filter', '@tensnap/examples-js', 'demo:ws', 'schelling', ...common, '--encoding', 'json'],
    ],
  };
  const [binary, args, cwd = root] = choices[host];
  // The audit path is the opt-in injection point. Without it, teaching runs
  // do no independent state scan or audit file write.
  const env = {
    ...process.env,
    TENSNAP_SCHELLING_AUDIT_STATE: auditPath,
    PYTHONPATH: [join(root, 'packages/tensnap-python'), process.env.PYTHONPATH]
      .filter(Boolean)
      .join(':'),
    TENSNAP_SERVER_PORT: String(port),
    TENSNAP_SCHELLING_WIDTH: '16',
    TENSNAP_SCHELLING_HEIGHT: '12',
    TENSNAP_SCHELLING_DENSITY: '0.72',
    TENSNAP_SCHELLING_BALANCE: '0.5',
    TENSNAP_SCHELLING_THRESHOLD: '0.65',
    TENSNAP_SCHELLING_SEED: '7',
    TENSNAP_USE_MSGPACK: 'false',
  };
  const child = spawn(binary, args, {
    cwd,
    env,
    detached: platform() !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Retain only a short tail for a useful failure log without flooding stdout.
  let log = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (part) => {
      log = (log + part).slice(-20_000);
    });
  return { child, log: () => log };
}

async function ready(port, processInfo, timeoutMs = 90_000) {
  // Startup costs differ substantially, especially Julia compilation. TCP
  // readiness is enough here; runtime up performs the protocol handshake.
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (processInfo.child.exitCode !== null) throw new Error(`Host exited: ${processInfo.log()}`);
    const reachable = await new Promise((done) => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        done(true);
      });
      socket.once('error', () => done(false));
    });
    if (reachable) return;
    await sleep(100);
  }
  throw new Error(`Host startup timed out: ${processInfo.log()}`);
}

async function stop(processInfo) {
  // pnpm and go run may spawn children. Stop the whole process group so no
  // simulator keeps its port or audit writer alive after a host finishes.
  const { child } = processInfo;
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (platform() !== 'win32') process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  await Promise.race([new Promise((done) => child.once('exit', done)), sleep(2_000)]);
}

async function audit(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
function agentProjection(host, state) {
  // Host-private sidecars have different layouts. Normalize only the public
  // spatial identity fields for comparison with the wire projection.
  const source =
    host === 'python'
      ? state.state.agents
      : host === 'go'
        ? state.state.cells.filter((cell) => cell.group !== 0)
        : state.agents;
  return source
    .map(({ id, x, y }) => ({ id: String(id), x, y }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
function sceneAgents(scene) {
  // This comes from the agent's protocol snapshot, never from the audit file.
  const layer = scene.snapshot.environments
    .flatMap((environment) => environment.layers)
    .find((candidate) => candidate.id === 'agents');
  assert(layer, 'Scene has no agents layer.');
  return layer.storageSnapshot.agents
    .map(({ id, x, y }) => ({ id: String(id), x, y }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function runHost(host, revision, sourceDigest) {
  // A temporary directory holds the daemon context, live sidecar, and capture.
  // Only the report, checkpoint, and render are retained under results/.
  const contextRoot = await mkdtemp(join(tmpdir(), `tensnap-schelling-${host}-`));
  const port = await reservePort();
  const auditPath = join(contextRoot, 'audit.json');
  const checkpointPath = join(contextRoot, 'checkpoint.json');
  const outputDir = join(results, host);
  await mkdir(outputDir, { recursive: true });
  const simulator = launch(host, port, auditPath);
  const context = ['--context', `schelling-${host}`, '--context-dir', contextRoot];
  const cli = async (args) =>
    JSON.parse(await command(process.execPath, [cliPath, ...args, ...context]));
  const cliFile = (args) => command(process.execPath, [cliPath, ...args, ...context]);
  let connected = false;

  async function observation(expectedTime) {
    // Actions and parameter changes are asynchronous. Wait until the model
    // sidecar and protocol snapshot both announce the requested tick.
    for (let tries = 0; tries < 150; tries++) {
      const state = await audit(auditPath).catch(() => null);
      const scene = await cli(['scene', 'snapshot']);
      if (state?.time === expectedTime && scene.snapshot.metadata.time === expectedTime) {
        // This catches a host that exports a plausible scene unrelated to the
        // actual live agent positions. Full private state is hashed separately.
        const actual = agentProjection(host, state);
        const projected = sceneAgents(scene);
        assert(
          JSON.stringify(actual) === JSON.stringify(projected),
          `${host} live agents differ from protocol projection at t=${expectedTime}`,
        );
        return {
          time: expectedTime,
          stateHash: hash(state),
          agentsHash: hash(actual),
          metrics: state.metrics,
          threshold:
            host === 'python'
              ? state.state.similarityThreshold
              : host === 'go'
                ? state.state.similarityThreshold
                : state.config.similarityThreshold,
          state,
          scene,
        };
      }
      await sleep(50);
    }
    const lastState = await audit(auditPath).catch(() => null);
    const lastScene = await cli(['scene', 'snapshot']).catch(() => null);
    throw new Error(
      `${host} did not reach synchronized t=${expectedTime}; auditTime=${lastState?.time}, sceneTime=${lastScene?.snapshot?.metadata?.time}, modelTick=${lastState?.state?.tick}`,
    );
  }

  async function setThreshold(value) {
    // param set only acknowledges dispatch. param list confirms that the host
    // actually accepted the runtime change before the next model step.
    await cli(['param', 'set', 'similarityThreshold', String(value)]);
    for (let i = 0; i < 80; i++) {
      const listed = await cli(['param', 'list']);
      if (JSON.stringify(listed).includes(`"value":${value}`)) return;
      await sleep(50);
    }
    throw new Error(`${host} threshold did not become ${value}`);
  }

  async function steps(count, from) {
    // One step per observation gives an auditable trajectory, including private
    // RNG/cache state, spatial agents, metrics, and the active threshold.
    const points = [];
    for (let offset = 1; offset <= count; offset++) {
      await cli(['action', 'run', 'step']);
      const point = await observation(from + offset);
      points.push({
        time: point.time,
        stateHash: point.stateHash,
        agentsHash: point.agentsHash,
        metrics: point.metrics,
        threshold: point.threshold,
      });
    }
    return points;
  }

  try {
    // Phase 1: connect with strict validation and verify both spatial layers.
    await ready(port, simulator);
    const status = await cli([
      'runtime',
      'up',
      '--simulator-url',
      `ws://127.0.0.1:${port}`,
      '--encoding',
      'json',
      '--client-message-validation',
      'error',
      '--server-message-validation',
      'error',
    ]);
    connected = true;
    assert(status.isConnected, `${host} failed to connect.`);
    const inspection = await cli(['scene', 'inspect']);
    const initial = await observation(0);
    const layerIds = initial.scene.snapshot.environments.flatMap((environment) =>
      environment.layers.map((layer) => layer.id),
    );
    assert(
      layerIds.includes('agents') && layerIds.includes('grid'),
      `${host} must expose both agent and grid layers.`,
    );
    // Phase 2: a bounded CLI run establishes the common t=5 checkpoint state.
    await cli([
      'run',
      'start',
      'start',
      '--max-steps',
      '5',
      '--stop-when',
      'time >= 5',
      '--max-wall-time-ms',
      '15000',
    ]);
    let bounded;
    for (let i = 0; i < 200; i++) {
      bounded = (await cli(['run', 'status'])).run;
      if (bounded?.state === 'stopped') break;
      await sleep(50);
    }
    assert(
      bounded?.state === 'stopped' && bounded.completedSteps === 5,
      `${host} bounded run failed: ${JSON.stringify(bounded)}`,
    );
    const captured = await observation(5);
    await cliFile(['scene', 'capture', '--output', checkpointPath]);
    const checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'));
    assert(
      checkpoint.model_id === (host === 'js' ? 'schelling' : 'examples.schelling') &&
        checkpoint.state_schema_version === '2',
      `${host} checkpoint identity/schema mismatch: ${JSON.stringify(checkpoint).slice(0, 300)}`,
    );
    // Phase 3: advance three steps, restore, and demand equality of both the
    // complete live state and every later trajectory point.
    const future = await steps(3, 5);
    // Exact-only hosts restore their own protocol clocks from the checkpoint.
    // JS also supports projected time, so its CLI request states t=5 explicitly.
    const restore = await cli([
      'scene',
      'restore',
      '--checkpoint',
      checkpointPath,
      ...(host === 'js' ? ['--time', '5'] : []),
    ]);
    assert(
      restore.status === 'ok',
      `${host} checkpoint restore failed: ${JSON.stringify(restore)}`,
    );
    const restored = await observation(5);
    assert(
      restored.stateHash === captured.stateHash,
      `${host} model-owned state not restored exactly.`,
    );
    const replay = await steps(3, 5);
    assert(
      JSON.stringify(future) === JSON.stringify(replay),
      `${host} future trajectory differs after restore.`,
    );

    async function branch(threshold) {
      // Each branch starts at the same captured private state. Only the
      // similarity threshold changes before its six measured steps.
      await cli([
        'scene',
        'restore',
        '--checkpoint',
        checkpointPath,
        ...(host === 'js' ? ['--time', '5'] : []),
      ]);
      await observation(5);
      await setThreshold(threshold);
      const trajectory = await steps(6, 5);
      return { threshold, trajectory };
    }
    const branches = [await branch(0.55), await branch(0.8)];
    assert(
      branches[0].trajectory.some(
        (point, i) => point.agentsHash !== branches[1].trajectory[i].agentsHash,
      ),
      `${host} branches produced identical spatial trajectories.`,
    );
    // Phase 4: retain a real offscreen rendering and its dimensions/hash.
    const renderPath = join(outputDir, 'scene.png');
    await cliFile([
      'scene',
      'render',
      `schelling-${host}`,
      '--env',
      'main',
      '--width',
      '640',
      '--height',
      '480',
      '--output',
      renderPath,
    ]);
    const png = await readFile(renderPath);
    assert(png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', `${host} render is not PNG.`);
    const report = {
      // Reports store hashes and short trajectories; the full checkpoint is a
      // separate file so reviewers can inspect the exact restore input.
      experiment: 'schelling-headless-v1',
      host,
      revision,
      sourceDigest,
      generatedAt: new Date().toISOString(),
      setup: {
        gridWidth: 16,
        gridHeight: 12,
        density: 0.72,
        balance: 0.5,
        similarityThreshold: 0.65,
        seed: 7,
        protocolEncoding: 'json',
        validation: 'error',
      },
      model: inspection.scene.model,
      capabilities: inspection.scene.capabilities,
      layerIds,
      initial: {
        stateHash: initial.stateHash,
        agentsHash: initial.agentsHash,
        metrics: initial.metrics,
      },
      boundedRun: { completedSteps: bounded.completedSteps, stopReason: bounded.stopReason },
      checkpoint: {
        modelId: checkpoint.model_id,
        schema: checkpoint.state_schema_version,
        encoding: checkpoint.checkpoint.encoding,
        sha256: hash(await readFile(checkpointPath)),
      },
      exactRestore: { captured: captured.stateHash, restored: restored.stateHash, pass: true },
      deterministicFuture: { future, replay, pass: true },
      branches,
      rendering: {
        path: 'scene.png',
        width: png.readUInt32BE(16),
        height: png.readUInt32BE(20),
        sha256: hash(png),
      },
    };
    await writeFile(join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(join(outputDir, 'checkpoint.json'), `${JSON.stringify(checkpoint)}\n`);
    await rm(join(outputDir, 'failure.log'), { force: true });
    console.log(`${host}: exact restore, deterministic replay, threshold branches, render passed`);
    return { host, report: join(outputDir, 'report.json'), pass: true };
  } catch (error) {
    // Preserve the simulator's last output when a phase fails.
    await writeFile(
      join(outputDir, 'failure.log'),
      `${error.stack ?? error}\n\n${simulator.log()}\n`,
    );
    throw error;
  } finally {
    // Runtime down precedes host termination; temp context and live sidecar
    // are then removed, even after a failed assertion.
    if (connected) await cliFile(['runtime', 'down']).catch(() => {});
    await stop(simulator);
    await rm(contextRoot, { recursive: true, force: true });
  }
}

async function main() {
  // Build once before opening any host. Per-host runs stay serial because the
  // CLI build replaces dist/ and each result has a fixed output location.
  await mkdir(results, { recursive: true });
  await command('pnpm', ['--filter', '@tensnap/agent', 'build']);
  const revision = await command('git', ['rev-parse', 'HEAD']);
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (path) => [path, hash(await readFile(join(root, path)))]),
    ),
  );
  const sourceDigest = hash(sourceHashes);
  const summary = {
    experiment: 'schelling-headless-v1',
    generatedAt: new Date().toISOString(),
    revision,
    sourceDigest,
    sourceHashes,
    scriptSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    environment: { platform: platform(), arch: arch(), node: process.version },
    hosts: [],
  };
  try {
    for (const host of selected) summary.hosts.push(await runHost(host, revision, sourceDigest));
  } finally {
    // A partial summary still records which hosts finished before a failure.
    await writeFile(join(results, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  }
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
