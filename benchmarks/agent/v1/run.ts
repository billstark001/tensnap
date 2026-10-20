import assert from 'node:assert/strict';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import type { ScenarioSnapshot, ScenarioQueryResult } from '../../../packages/core/src/scenario';
import type { RunStatus } from '../../../packages/core/src/runtime';
import type { ExternalBenchmarkResult } from '../../../packages/benchmark/src/harness/types';
import { readRecordingBoundary } from '../../../packages/tensnap-agent/src/runtime/recording-files';
import { resolveConfig } from './benchmark';
import { finishResources } from './cleanup';
import {
  assertRun,
  observeRun,
  validateMeasurement,
  type Measurement,
  type ActionObservation,
} from './measurement';
import {
  digest,
  expectedQuery,
  pointHash,
  points,
  queryFor,
  queryProof,
  reference,
} from './oracle';

const execute = promisify(execFile);
const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const input = JSON.parse(process.argv[2]!);
const config = resolveConfig(input.config);
const { warmupActions, measuredActions } = input as {
  warmupActions: number;
  measuredActions: number;
};
const cliPath = join(root, 'packages/tensnap-agent/dist/cli.js');
const require = createRequire(join(root, 'packages/benchmark/package.json'));
const temporary = await mkdtemp(join(tmpdir(), 'tensnap-agent-benchmark-'));
const common = ['--context-dir', temporary, '--context', 'benchmark', '--output-version', '1'];
const children: ChildProcess[] = [];
const metrics: Record<string, number | number[]> = {};
const stages: Record<string, number | number[]> = {};
let baseUrl = '';
let cleanupPromise: Promise<void> | undefined;

async function stop(child: ChildProcess) {
  if (!child.pid) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    assert.equal(child.exitCode, 0, 'Benchmark child exited unexpectedly.');
    return;
  }
  await new Promise<void>((done, fail) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(new Error('Benchmark child did not shut down.'));
    }, 10_000);
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) done();
      else fail(new Error(`Benchmark child exited ${code}.`));
    });
    child.kill('SIGTERM');
  });
}
function cleanup() {
  return (cleanupPromise ??= (async () => {
    // Daemon first: settle work and flush stores before shutting down its host.
    const failures: unknown[] = [];
    for (const child of [...children].reverse())
      try {
        await stop(child);
      } catch (error) {
        failures.push(error);
      }
    if (failures.length) throw new AggregateError(failures, 'Benchmark child cleanup failed.');
  })());
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void finishResources(undefined, cleanup, () =>
      rm(temporary, { recursive: true, force: true }),
    ).finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  });

async function ready<T>(name: string, args: string[]): Promise<T> {
  const child = spawn(
    process.execPath,
    ['--import', join(root, 'benchmarks/agent/v1/resource-probe.mjs'), ...args],
    {
      cwd: root,
      env: {
        ...process.env,
        TENSNAP_BENCH_RESOURCE_FILE: join(temporary, `${name}-resources.json`),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  children.push(child);
  return new Promise<T>((done, fail) => {
    let stdout = '',
      stderr = '';
    const timer = setTimeout(() => fail(new Error(`${name} startup timeout: ${stderr}`)), 30_000);
    const failed = (error: Error) => {
      clearTimeout(timer);
      fail(error);
    };
    child.once('error', failed);
    child.once('close', (code) => failed(new Error(`${name} exited ${code}: ${stderr}`)));
    child.stderr!.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-16_000);
    });
    child.stdout!.on('data', (chunk) => {
      stdout += chunk;
      if (!stdout.includes('\n')) return;
      clearTimeout(timer);
      try {
        done(JSON.parse(stdout.split('\n')[0]!));
      } catch (error) {
        fail(error);
      }
    });
  });
}
async function cli<T>(args: string[], online = true) {
  const started = performance.now();
  const { stdout } = await execute(
    process.execPath,
    [cliPath, ...args, ...(online ? common : ['--output-version', '1'])],
    { cwd: root, timeout: 900_000, maxBuffer: 64 * 1024 * 1024 },
  );
  const elapsedMs = performance.now() - started;
  const envelope = JSON.parse(stdout) as { ok: boolean; schemaVersion: number; data: T };
  assert.equal(envelope.ok, true, stdout);
  assert.equal(envelope.schemaVersion, 1);
  return { data: envelope.data, elapsedMs, bytes: Buffer.byteLength(stdout) };
}
async function http<T>(route: string, body?: unknown) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${route}`, {
    signal: AbortSignal.timeout(900_000),
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  const text = await response.text();
  const elapsedMs = performance.now() - started;
  assert.equal(response.ok, true, text);
  return { data: JSON.parse(text) as T, elapsedMs, bytes: Buffer.byteLength(text) };
}
async function batch(steps: number) {
  const accepted = await http<{ run: RunStatus }>('/v1/runs', {
    mode: 'bounded',
    actionId: 'start',
    maxSteps: steps,
  });
  const settled = await http<{ run: RunStatus }>(`/v1/runs/${accepted.data.run.id}/wait`, {
    until: 'settled',
  });
  return { run: settled.data.run, transactionsMs: [accepted.elapsedMs, settled.elapsedMs] };
}
async function diskBytes(path: string): Promise<number> {
  const item = await stat(path);
  if (!item.isDirectory()) return item.size;
  let bytes = 0;
  for (const entry of await readdir(path)) bytes += await diskBytes(join(path, entry));
  return bytes;
}
async function buildHash(path: string): Promise<string> {
  const files: [string, string][] = [];
  async function visit(directory: string) {
    for (const entry of (await readdir(directory)).sort()) {
      const name = join(directory, entry);
      if ((await stat(name)).isDirectory()) await visit(name);
      else if (entry.endsWith('.js'))
        files.push([name.slice(path.length), digest((await readFile(name)).toString('base64'))]);
    }
  }
  await visit(path);
  return digest(files);
}

let result: ExternalBenchmarkResult | undefined;
let primaryError: unknown;
try {
  const host = await ready<{ url: string; validation: { send: string; receive: string } }>('host', [
    '--import',
    require.resolve('tsx'),
    join(root, 'benchmarks/agent/v1/host.ts'),
    JSON.stringify(config),
  ]);
  assert.deepEqual(host.validation, { send: 'error', receive: 'error' });
  const start = performance.now();
  const daemon = await ready<{
    data: {
      control: { host: string; port: number };
      status: {
        phase: string;
        encoding: string;
        clientMessageValidation: string;
        serverMessageValidation: string;
      };
    };
  }>('daemon', [
    cliPath,
    'daemon',
    'serve',
    '--simulator-url',
    host.url,
    '--encoding',
    'json',
    '--ip-family',
    'ipv4',
    '--render-trigger',
    'manual',
    '--client-message-validation',
    'error',
    '--server-message-validation',
    'error',
    ...common,
  ]);
  metrics.startupReadyMs = performance.now() - start;
  assert.equal(daemon.data.status.phase, 'ready');
  assert.equal(daemon.data.status.encoding, 'json');
  assert.equal(daemon.data.status.clientMessageValidation, 'error');
  assert.equal(daemon.data.status.serverMessageValidation, 'error');
  baseUrl = `http://${daemon.data.control.host}:${daemon.data.control.port}`;
  if (config.case !== 'collection' && config.prepSteps)
    assertRun((await batch(config.prepSteps)).run, config.prepSteps);
  const finalTime =
    config.case === 'collection'
      ? config.steps
      : config.prepSteps + (config.case === 'control' ? config.steps : 0);
  // This scientific reference runs before timing and never reads the host/daemon projection.
  const expected = reference(config, finalTime);
  const cliBuildSha256 = await buildHash(join(root, 'packages/tensnap-agent/dist'));
  const evidence: Record<string, unknown> = {};
  const expectedEvidence: Record<string, unknown> = {};
  const timingsMs: number[] = [];
  let recordingPath: string | undefined;
  let measurement: Measurement;

  if (config.case === 'control') {
    const started = performance.now();
    if (config.control === 'cli-single') {
      const actions: ActionObservation[] = [];
      for (let index = 0; index < config.steps; index++) {
        const reply = await cli<{ action: Omit<ActionObservation, 'elapsedMs'> }>([
          'action',
          'run',
          'step',
          '--wait',
        ]);
        actions.push({ ...reply.data.action, elapsedMs: reply.elapsedMs });
      }
      timingsMs.push(performance.now() - started);
      stages.actionCliMs = actions.map((action) => action.elapsedMs);
      measurement = { kind: 'single', actions, transactionsMs: stages.actionCliMs };
    } else {
      const reply = config.control === 'http-batch' ? await batch(config.steps) : undefined;
      const command = reply
        ? undefined
        : await cli<{ run: RunStatus }>([
            'run',
            'start',
            'start',
            '--max-actions',
            String(config.steps),
            '--wait',
          ]);
      timingsMs.push(performance.now() - started);
      const run = reply?.run ?? command!.data.run;
      stages.runtimeSettledMs = run.settledAt! - run.startedAt;
      measurement = {
        kind: 'bounded',
        run: observeRun(run),
        transactionsMs: reply?.transactionsMs ?? [command!.elapsedMs],
      };
    }
    metrics.successfulActionsPerSecond = (config.steps * 1000) / timingsMs[0]!;
  } else if (config.case === 'query') {
    const query = queryFor(config.query, expected.agents);
    const observations: unknown[] = [];
    const planned: unknown[] = [];
    const bytes: number[] = [];
    const responses: { elapsedMs: number; bytes: number }[] = [];
    for (let index = 0; index < warmupActions + measuredActions; index++) {
      const reply =
        config.transport === 'cli'
          ? await cli<ScenarioQueryResult & { snapshot: ScenarioSnapshot }>(
              query
                ? ['scene', 'inspect', '--query', JSON.stringify(query)]
                : ['scene', 'snapshot'],
            )
          : await http<ScenarioQueryResult & { snapshot: ScenarioSnapshot }>(
              query ? '/v1/scene/query' : '/v1/scene/snapshot',
              query,
            );
      const observed = query
        ? queryProof(reply.data)
        : {
            time: reply.data.snapshot.metadata.time,
            agentsHash: pointHash(points(reply.data.snapshot)),
          };
      const wanted = query
        ? expectedQuery(config.query, expected, finalTime)
        : { time: finalTime, agentsHash: pointHash(expected.agents) };
      assert.equal(digest(observed), digest(wanted), `Query mismatch: ${config.query}`);
      if (index >= warmupActions) {
        timingsMs.push(reply.elapsedMs);
        bytes.push(reply.bytes);
        responses.push({ elapsedMs: reply.elapsedMs, bytes: reply.bytes });
        observations.push(observed);
        planned.push(wanted);
      }
    }
    metrics.responseBytes = bytes;
    measurement = { kind: 'query', responses };
    evidence.queries = observations;
    expectedEvidence.queries = planned;
  } else {
    const args = ['run', 'start', 'start', '--max-actions', String(config.steps), '--wait'];
    let setupMs = 0;
    if (config.collection === 'archive') {
      setupMs = (
        await cli([
          'recording',
          'start',
          '--max-frames',
          String(config.steps + 10),
          '--max-bytes',
          String(512 * 1024 * 1024),
          '--retention',
          'bounded',
        ])
      ).elapsedMs;
      stages.recordingSetupCliMs = setupMs;
    }
    if (config.collection === 'full-history' || config.collection === 'rolling') {
      recordingPath = join(temporary, 'collection.store');
      const collectionFile = join(temporary, 'collection.json');
      await writeFile(
        collectionFile,
        JSON.stringify({
          version: 1,
          mode: config.collection,
          ...(config.collection === 'rolling' ? { maxFrames: config.retainedFrames } : {}),
          maxSegmentBytes: 4 * 1024 * 1024,
          maxPendingBytes: 8 * 1024 * 1024,
          maxPendingSegments: 2,
          cacheBytes: 1024 * 1024,
          maxStoredBytes: 2 * 1024 * 1024 * 1024,
          liveHistory: { chartPoints: 100, logs: 100 },
          rules: [],
          window: { before: 0, after: 0 },
          maxTriggers: 1,
          checkpoints: {
            policy: 'none',
            onTrigger: false,
            maxCount: 0,
            maxBytes: 0,
            overflow: 'fail',
          },
        }),
      );
      args.push('--collection', collectionFile, '--store', recordingPath, '--until', 'persisted');
    }
    const started = performance.now();
    const reply = await cli<{ run: RunStatus & { recording?: { status: string } } }>(args);
    const transactionsMs = [...(setupMs ? [setupMs] : []), reply.elapsedMs];
    let recordingStatus = reply.data.run.recording?.status;
    let persistedAt = performance.now();
    if (config.collection === 'archive') {
      const stopped = await cli<{ recording: { status: string; path: string } }>([
        'recording',
        'stop',
      ]);
      transactionsMs.push(stopped.elapsedMs);
      recordingStatus = stopped.data.recording.status;
      recordingPath = stopped.data.recording.path;
      persistedAt = performance.now();
    }
    timingsMs.push(setupMs + persistedAt - started);
    measurement = {
      kind: 'bounded',
      run: observeRun(reply.data.run),
      transactionsMs,
      ...(config.collection === 'none' ? {} : { recordingStatus }),
    };
    stages.runtimeSettledMs = reply.data.run.settledAt! - reply.data.run.startedAt;
    // The residual includes CLI startup/control/exit and final persistence, so it is not labelled storage-only.
    stages.completionOverheadMs = timingsMs[0]! - (stages.runtimeSettledMs as number);
    metrics.successfulActionsPerSecond = (config.steps * 1000) / timingsMs[0]!;
  }
  const live = (await http<{ snapshot: ScenarioSnapshot }>('/v1/scene/snapshot')).data.snapshot;
  const succeededActions =
    measurement.kind === 'query'
      ? 0
      : measurement.kind === 'bounded'
        ? measurement.run.succeededActions
        : measurement.actions.filter((action) => action.status === 'succeeded').length;
  Object.assign(evidence, {
    time: live.metadata.time,
    succeededActions,
    agentsHash: pointHash(points(live)),
  });
  Object.assign(expectedEvidence, {
    time: finalTime,
    succeededActions,
    agentsHash: pointHash(expected.agents),
  });
  assert.equal(digest(evidence), digest(expectedEvidence), 'Final scientific projection mismatch.');
  await cleanup();
  if (recordingPath) {
    // Validate actual persisted history with both public offline info and an independent model trajectory.
    const info = (
      await cli<{
        firstFrame?: number;
        lastFrame?: number;
        count?: number;
        frameCount?: number;
        status?: string;
        truncated: boolean;
        storedBytes?: number;
      }>(['recording', 'info', recordingPath], false)
    ).data;
    const frames = info.count ?? info.frameCount!;
    const expectedFrames =
      config.collection === 'archive'
        ? config.steps + 1
        : config.collection === 'rolling'
          ? Math.min(config.steps + 2, config.retainedFrames + 1)
          : config.steps + 2;
    assert.equal(frames, expectedFrames);
    const truncated = config.collection === 'rolling' && config.steps + 1 > config.retainedFrames;
    assert.equal(info.truncated, truncated);
    if (info.status !== undefined) assert.equal(info.status, 'complete');
    const firstTime =
      config.collection === 'rolling' ? Math.max(0, finalTime - config.retainedFrames + 1) : 0;
    const checks: unknown[] = [],
      expectedChecks: unknown[] = [];
    for (const time of [
      ...new Set([firstTime, Math.max(firstTime, Math.floor(finalTime / 2)), finalTime]),
    ]) {
      const retained = await readRecordingBoundary(
        recordingPath,
        { time, match: 'last' },
        undefined,
        'active',
      );
      const observed = {
        time: retained.frame.scene.metadata.time,
        agentsHash: pointHash(points(retained.frame.scene)),
      };
      const wanted = { time, agentsHash: pointHash(reference(config, time).agents) };
      assert.equal(digest(observed), digest(wanted), 'Persisted historical state mismatch.');
      checks.push(observed);
      expectedChecks.push(wanted);
    }
    evidence.history = { checks, truncated };
    expectedEvidence.history = { checks: expectedChecks, truncated };
    metrics.retainedFrames = frames;
    metrics.recordingDiskBytes = await diskBytes(recordingPath);
    if (info.storedBytes !== undefined) metrics.storedEncodedBytes = info.storedBytes;
  }
  metrics.contextDiskBytes = await diskBytes(join(temporary, 'contexts'));
  for (const name of ['host', 'daemon'])
    metrics[`${name}MaxRssBytes`] = JSON.parse(
      await readFile(join(temporary, `${name}-resources.json`), 'utf8'),
    ).maxRssBytes;
  const series = (values: Record<string, number | number[]>) =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Array.isArray(v) ? v : [v]]));
  validateMeasurement(config, measurement, timingsMs, series(stages), series(metrics));
  result = {
    schemaVersion: 1,
    measurementEvidence: measurement,
    retainSemanticEvidence: true,
    timingsMs,
    metrics,
    stagesMs: stages,
    runtime: {
      node: process.version,
      encoding: 'json',
      hostSendValidation: host.validation.send,
      hostReceiveValidation: host.validation.receive,
      daemonConfiguredSendValidation: daemon.data.status.clientMessageValidation,
      daemonConfiguredReceiveValidation: daemon.data.status.serverMessageValidation,
      renderTrigger: 'manual',
      cliBuildSha256,
    },
    correctness: {
      valid: true,
      actionCount: measuredActions,
      state: evidence,
      expectedState: expectedEvidence,
    },
  };
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  await finishResources(primaryError, cleanup, () =>
    rm(temporary, { recursive: true, force: true }),
  );
}
console.log(JSON.stringify(result));
