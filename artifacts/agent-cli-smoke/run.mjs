#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { arch, platform, release } from 'node:os';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const artifactDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(artifactDir, '..', '..');
const resultsDir = join(artifactDir, 'results');
const cliPath = join(repositoryRoot, 'packages', 'tensnap-agent', 'dist', 'cli.js');
const contextName = 'artifact-smoke';

async function execute(command, args, options = {}) {
  const { stdout } = await execFileAsync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  return stdout.trim();
}

async function executeDiscard(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 32_768) stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${code ?? signal}: ${stderr.trim()}`));
    });
  });
}

async function reservePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await new Promise((resolvePromise, reject) => {
    server.once('listening', resolvePromise);
    server.once('error', reject);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Unable to reserve a TCP port.');
  }
  await new Promise((resolvePromise, reject) => {
    server.close((error) => error ? reject(error) : resolvePromise());
  });
  return address.port;
}

function startSimulator(port) {
  const args = [
    '--filter', '@tensnap/examples-js', 'demo:ws', 'schelling',
    '--width', '20', '--height', '16', '--density', '0.7', '--balance', '0.5',
    '--threshold', '0.6', '--seed', '7', '--port', String(port), '--encoding', 'msgpack',
  ];
  const detached = process.platform !== 'win32';
  const child = spawn('pnpm', args, {
    cwd: repositoryRoot,
    detached,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let settled = false;
  const ready = new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      if (!settled) reject(new Error(`Simulator startup timed out: ${output.slice(-4096)}`));
    }, 10_000);
    const observe = (chunk) => {
      output = `${output}${chunk}`.slice(-16_384);
      if (!settled && output.includes(`ws://127.0.0.1:${port}`)) {
        settled = true;
        clearTimeout(timer);
        resolvePromise();
      }
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', observe);
    child.stderr.on('data', observe);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (!settled) {
        clearTimeout(timer);
        reject(new Error(`Simulator exited with ${code ?? signal}: ${output.slice(-4096)}`));
      }
    });
  });
  return { child, detached, ready };
}

async function stopSimulator(simulator) {
  const { child, detached } = simulator;
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (detached && child.pid) process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
  ]);
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    const normalized = value.map(canonicalize);
    if (normalized.every((item) => item && typeof item === 'object' && 'id' in item)) {
      normalized.sort((left, right) => String(left.id).localeCompare(String(right.id)));
    }
    return normalized;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function canonicalModelState(scene) {
  return canonicalize({
    time: scene.snapshot.metadata.time,
    parameters: scene.snapshot.parameters.map(({ id, value }) => ({ id, value })),
    environments: scene.snapshot.environments.map(({ id, type, layers }) => ({
      id,
      type,
      layers: layers.map(({ id: layerId, type: layerType, storageSnapshot }) => ({
        id: layerId,
        type: layerType,
        storageSnapshot,
      })),
    })),
  });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function modelStateHash(scene) {
  return sha256(JSON.stringify(canonicalModelState(scene)));
}

function requireCheck(condition, message) {
  if (!condition) throw new Error(message);
  return 'pass';
}

async function readPng(path) {
  const data = await readFile(path);
  const signature = data.subarray(0, 8).toString('hex');
  requireCheck(signature === '89504e470d0a1a0a', 'Rendered file is not a PNG.');
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    bytes: data.length,
    sha256: sha256(data),
  };
}

async function main() {
  await mkdir(resultsDir, { recursive: true });
  const summaryPath = join(resultsDir, 'summary.json');
  const renderPath = join(resultsDir, 'scene.png');
  await rm(summaryPath, { force: true });
  await rm(renderPath, { force: true });

  await executeDiscard('pnpm', ['--filter', '@tensnap/agent', 'build']);
  const sourceCommit = await execute('git', ['rev-parse', 'HEAD']);
  const pnpmVersion = await execute('pnpm', ['--version']);
  const runtimeRoot = await mkdtemp(join(tmpdir(), 'tensnap-agent-smoke-'));
  const checkpointPath = join(runtimeRoot, 'checkpoint.json');
  const port = await reservePort();
  const simulator = startSimulator(port);
  const contextArgs = ['--context', contextName, '--context-dir', runtimeRoot];
  const cli = async (args) => JSON.parse(await execute(process.execPath, [cliPath, ...args, ...contextArgs]));
  const cliDiscard = async (args) => executeDiscard(process.execPath, [cliPath, ...args, ...contextArgs]);
  let runtimeStarted = false;

  try {
    await simulator.ready;
    const status = await cli([
      'runtime', 'up', '--simulator-url', `ws://127.0.0.1:${port}`, '--encoding', 'msgpack',
      '--client-message-validation', 'error', '--server-message-validation', 'error',
    ]);
    runtimeStarted = true;
    const initialInspection = await cli(['scene', 'inspect']);
    const initial = initialInspection.scene;
    await cli(['param', 'set', 'similarityThreshold', '0.75']);
    await cli([
      'run', 'start', 'start', '--max-steps', '20', '--stop-when', 'time >= 5',
      '--max-wall-time-ms', '5000',
    ]);

    let run;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      run = (await cli(['run', 'status'])).run;
      if (run?.state === 'stopped') break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
    requireCheck(run?.state === 'stopped', 'Bounded run did not stop.');

    await cliDiscard(['scene', 'capture', '--output', checkpointPath]);
    const capturedScene = await cli(['scene', 'snapshot']);
    await cliDiscard([
      'scene', 'render', 'artifact-evidence', '--env', 'main', '--width', '640', '--height', '480',
      '--output', renderPath,
    ]);
    await cli(['action', 'run', 'step']);
    const advancedScene = await cli(['scene', 'snapshot']);
    const restore = await cli(['scene', 'restore', '--checkpoint', checkpointPath]);
    const restoredScene = await cli(['scene', 'snapshot']);
    const finalInspection = await cli(['scene', 'inspect']);
    const checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'));
    const runtimeLogPath = join(runtimeRoot, 'contexts', contextName, 'logs', 'runtime.log');
    const runtimeLog = await readFile(runtimeLogPath, 'utf8');
    const warningOrErrorCount = runtimeLog
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.level === 'warn' || entry.level === 'error')
      .length;

    const capturedHash = modelStateHash(capturedScene);
    const advancedHash = modelStateHash(advancedScene);
    const restoredHash = modelStateHash(restoredScene);
    const render = await readPng(renderPath);
    const threshold = capturedScene.snapshot.parameters
      .find((parameter) => parameter.id === 'similarityThreshold')?.value;
    const agentCount = capturedScene.snapshot.environments
      .flatMap((environment) => environment.layers)
      .find((layer) => layer.id === 'agents')?.storageSnapshot.agents?.length;

    const checks = {
      builtCliConnected: requireCheck(status.isConnected === true, 'Built CLI did not connect.'),
      strictBidirectionalValidation: requireCheck(
        status.clientMessageValidation === 'error' && status.serverMessageValidation === 'error',
        'Strict bidirectional validation was not active.',
      ),
      initialSceneInspected: requireCheck(
        initial.time === 0 && initial.environments.length === 1,
        `Initial scene inspection was unexpected: ${JSON.stringify({
          time: initial.time,
          environmentCount: initial.environments.length,
        })}`,
      ),
      runtimeParameterChanged: requireCheck(threshold === 0.75, 'Runtime parameter change was not retained.'),
      boundedConditionStop: requireCheck(
        run.spec.mode === 'bounded' && run.completedSteps === 5
          && run.stopReason === 'condition' && run.conditionValue === true,
        `Bounded run did not stop on the declared condition: ${JSON.stringify({
          spec: run.spec,
          completedSteps: run.completedSteps,
          stopReason: run.stopReason,
          conditionValue: run.conditionValue,
        })}`,
      ),
      exactCheckpointVersioned: requireCheck(
        checkpoint.state_schema_version === '1'
          && checkpoint.checkpoint.encoding === 'application/msgpack',
        'Checkpoint metadata was unexpected.',
      ),
      advanceChangedState: requireCheck(
        capturedHash !== advancedHash && advancedScene.snapshot.metadata.time === 6,
        'One step did not change canonical model state.',
      ),
      restoreRecoveredState: requireCheck(
        restore.status === 'ok' && restoredScene.snapshot.metadata.time === 5
          && restoredHash === capturedHash,
        'Restore did not recover canonical model state.',
      ),
      offscreenRenderCreated: requireCheck(
        render.width === 640 && render.height === 480 && render.bytes > 0,
        'Offscreen render was not 640x480.',
      ),
      noRuntimeWarningsOrErrors: requireCheck(
        warningOrErrorCount === 0 && finalInspection.scene.logs.length === 0,
        'Runtime or scene reported warnings/errors.',
      ),
    };

    const summary = {
      artifact: 'tensnap-agent-cli-smoke-v1',
      generatedAt: new Date().toISOString(),
      sourceCommit,
      environment: {
        platform: platform(),
        release: release(),
        architecture: arch(),
        node: process.version,
        pnpm: pnpmVersion,
      },
      scenario: {
        model: 'schelling',
        transport: 'websocket/msgpack',
        validation: { client: 'error', server: 'error' },
        seed: 7,
        grid: { width: 20, height: 16 },
        density: 0.7,
        balance: 0.5,
        initialSimilarityThreshold: 0.6,
        runtimeSimilarityThreshold: threshold,
        agentCount,
      },
      boundedRun: {
        actionId: run.spec.actionId,
        maxSteps: run.spec.maxSteps,
        stopWhen: run.spec.stopWhen,
        completedSteps: run.completedSteps,
        stopReason: run.stopReason,
        conditionValue: run.conditionValue,
      },
      checkpointRoundTrip: {
        stateSchemaVersion: checkpoint.state_schema_version,
        encoding: checkpoint.checkpoint.encoding,
        capturedTime: capturedScene.snapshot.metadata.time,
        advancedTime: advancedScene.snapshot.metadata.time,
        restoredTime: restoredScene.snapshot.metadata.time,
        capturedStateSha256: capturedHash,
        advancedStateSha256: advancedHash,
        restoredStateSha256: restoredHash,
      },
      render,
      retainedFiles: ['results/summary.json', 'results/scene.png'],
      discarded: ['daemon context', 'checkpoint payload', 'raw snapshots', 'process logs'],
      checks,
    };
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (runtimeStarted) {
      try {
        await cliDiscard(['runtime', 'down']);
      } catch {
        // Preserve the primary experiment error; temporary context is removed below.
      }
    }
    await stopSimulator(simulator);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    await rm(runtimeRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
