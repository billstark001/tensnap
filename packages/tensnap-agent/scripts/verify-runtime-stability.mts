/** Plan-one acceptance against the real seeded Schelling model and built CLI. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { decodeSnapshotArchive, materializeSnapshot } from '@tensnap/core/snapshot';
import { startJsExampleWebSocketDemo } from '../../../examples/js/src/entries/main-ws';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'tensnap-runtime-acceptance-'));
const common = ['--context-dir', root, '--context', 'acceptance', '--output-version', '1'];
async function command(args: string[], expectedExit = 0) {
  let stdout: string;
  let code = 0;
  try {
    ({ stdout } = await execute(process.execPath, [cli, ...args, ...common], {
      maxBuffer: 16 * 1024 * 1024,
    }));
  } catch (error) {
    const failure = error as { stdout: string; code: number };
    stdout = failure.stdout;
    code = failure.code;
  }
  assert.equal(code, expectedExit, stdout!);
  const result = JSON.parse(stdout!);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.ok, expectedExit === 0);
  return result;
}

const model = await startJsExampleWebSocketDemo('schelling', {
  port: 0,
  ip_family: 'ipv4',
  encoding: 'json',
  config: {
    gridWidth: 12,
    gridHeight: 12,
    density: 0.8,
    balance: 0.5,
    similarityThreshold: 0.9,
    seed: 42,
  },
});
let daemon: ReturnType<typeof spawn> | undefined;
try {
  const invalid = await command(['runtime', 'up', '--root-dir', join(root, 'must-not-exist')], 2);
  assert.equal(invalid.error.category, 'input_error');
  await assert.rejects(stat(join(root, 'contexts')));
  daemon = spawn(
    process.execPath,
    [
      cli,
      'daemon',
      'serve',
      '--simulator-url',
      model.url!,
      '--encoding',
      'json',
      '--ip-family',
      'ipv4',
      ...common,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const ready = await new Promise<any>((resolve, reject) => {
    let output = '';
    let errors = '';
    const timer = setTimeout(() => reject(new Error(`Daemon startup timeout: ${errors}`)), 15_000);
    daemon!.stderr!.on('data', (chunk) => {
      errors += chunk;
    });
    daemon!.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Daemon exited ${code}: ${errors}`));
    });
    daemon!.stdout!.on('data', (chunk) => {
      output += chunk;
      if (!output.includes('\n')) return;
      clearTimeout(timer);
      resolve(JSON.parse(output));
    });
  });
  const baseUrl = `http://${ready.data.control.host}:${ready.data.control.port}`;
  const started = await command(['run', 'start', 'start', '--max-actions', '3', '--record']);
  const runId = started.data.run.id;
  let run: any;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    ({ run } = await (await fetch(`${baseUrl}/v1/runs/${runId}`)).json());
    if (run.settled && run.recording?.status !== 'pending') break;
    await delay(25);
  }
  assert.equal(run.id, runId);
  assert.equal(run.settled, true);
  assert.equal(run.stateKnown, true);
  assert.equal(run.completedActions, 3);
  assert.equal(run.succeededActions, 3);
  assert.equal(run.failedActions, 0);
  assert.equal(run.stopReason, 'max-steps');
  assert.equal(run.recording.status, 'persisted');
  const archive = decodeSnapshotArchive(JSON.parse(await readFile(run.recording.path, 'utf8')));
  assert.ok(
    archive.frames.some((frame) => frame.source === 'lifecycle' && frame.action?.id === 'stop'),
  );
  const live = (await command(['scene', 'snapshot'])).data.snapshot;
  const replay = materializeSnapshot(archive);
  assert.deepEqual(replay.metadata, live.metadata);
  assert.deepEqual(replay.environments, live.environments);
  assert.deepEqual(replay.charts, live.charts);
  const envId = live.environments[0].id;
  const image = join(root, 'schelling.png');
  const rendered = await command([
    'scene',
    'render',
    '--env',
    envId,
    '--width',
    '400',
    '--height',
    '400',
    '--output',
    image,
  ]);
  assert.equal(rendered.data.artifacts.length, 1);
  assert.ok((await stat(image)).size > 100);
  const missing = await command(['scene', 'render', '--env', 'missing'], 5);
  assert.equal(missing.error.category, 'render_failed');
  assert.equal(missing.data.errors[0].code, 'render_missing');
  const blocker = join(root, 'blocker');
  await writeFile(blocker, 'file');
  const failed = await command(
    ['scene', 'render', '--env', envId, '--output', join(blocker, 'scene.png')],
    6,
  );
  assert.equal(failed.error.category, 'persistence_failed');
  console.log(
    JSON.stringify({
      ok: true,
      model: 'schelling',
      seed: 42,
      completedActions: run.completedActions,
      modelTime: live.metadata.time,
      lifecycleRecorded: true,
      replayMatches: true,
      pngBytes: (await stat(image)).size,
      verifiedExitCodes: [0, 2, 5, 6],
    }),
  );
} finally {
  if (daemon && daemon.exitCode === null) {
    const exited = once(daemon, 'exit');
    daemon.kill('SIGTERM');
    await exited;
  }
  await model.stop();
  await rm(root, { recursive: true, force: true });
}
