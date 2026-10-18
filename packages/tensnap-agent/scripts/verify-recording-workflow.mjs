#!/usr/bin/env node
// Real model acceptance: all interaction and evidence generation use the built public CLI.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const workspace = resolve(packageRoot, '../..');
const output = resolve(
  process.argv[2] ?? join(workspace, '.tensnap', `recording-acceptance-${Date.now()}`),
);
await mkdir(output, { recursive: true });
const cli = join(packageRoot, 'dist/cli.js');
const context = ['--context', 'acceptance', '--context-dir', join(output, 'runtime')];
const loader = createRequire(join(packageRoot, 'package.json')).resolve('tsx');
const model = spawn(
  process.execPath,
  [
    '--import',
    loader,
    join(workspace, 'examples/js/src/entries/main-ws.ts'),
    'schelling',
    '--port',
    '0',
    '--width',
    '12',
    '--height',
    '10',
    '--seed',
    '42',
  ],
  { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] },
);
const commands = [];
let daemonStarted = false;
async function run(args, online = false, expected = 0) {
  let result;
  const argv = [...args, ...(online ? context : []), '--output-version', '1'];
  try {
    result = await execute(process.execPath, [cli, ...argv], {
      cwd: workspace,
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(expected, 0, `Expected error for ${args}`);
  } catch (error) {
    if (!('stdout' in error)) throw error;
    assert.equal(error.code, expected, `${args}: ${error.stdout}\n${error.stderr}`);
    result = error;
  }
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, expected === 0);
  commands.push({ command: args, exitCode: expected, ok: envelope.ok });
  return envelope.data;
}
try {
  const url = await new Promise((resolveUrl, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('Model did not start.')), 10_000);
    model.stdout.on('data', (chunk) => {
      text += chunk;
      const match = text.match(/ws:\/\/[^\s]+/);
      if (match) {
        clearTimeout(timer);
        resolveUrl(match[0]);
      }
    });
    model.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    model.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Model exited ${code}: ${text}`));
    });
  });
  await run(['runtime', 'up', '--simulator-url', url], true);
  daemonStarted = true;
  const { run: settled } = await run(
    ['run', 'start', 'start', '--max-actions', '5', '--record', '--wait', '--until', 'persisted'],
    true,
  );
  assert.equal(settled.succeededActions, 5);
  assert.equal(settled.settled, true);
  assert.equal(settled.recording.status, 'persisted');
  const catalog = await run(['recording', 'list'], true);
  const recording = catalog.recordings.find((entry) => entry.runId === settled.id);
  assert.ok(recording);
  const file = join(output, 'run.tensnap-recording.json');
  await run(['recording', 'export', recording.id, '--output', file], true);
  const imageFlags = [
    '--env',
    'main',
    '--chart',
    'segregation',
    '--width',
    '640',
    '--height',
    '480',
  ];
  const saved = join(output, 'saved');
  await run(['frame', 'save', '--checkpoint', 'required', '--output', saved, ...imageFlags], true);
  await run(['action', 'run', 'step', '--wait'], true);
  const a = join(output, 'branch-a');
  await run(['frame', 'save', '--checkpoint', 'required', '--output', a], true);
  const restored = await run(
    ['frame', 'restore', saved, '--mode', 'checkpoint', '--history', 'replace'],
    true,
  );
  assert.equal(restored.modelStatus, 'restored');
  assert.equal(restored.historyStatus, 'restored');
  const restoredDirectory = join(output, 'restored');
  await run(['frame', 'save', '--checkpoint', 'required', '--output', restoredDirectory], true);
  assert.equal((await run(['frame', 'compare', saved, restoredDirectory])).equal, true);
  await run(['action', 'run', 'step', '--wait'], true);
  const b = join(output, 'branch-b');
  await run(['frame', 'save', '--checkpoint', 'required', '--output', b], true);
  const comparison = await run(['frame', 'compare', a, b]);
  assert.equal(comparison.equal, true);
  assert.equal(comparison.checkpointEqual, true);
  await run(
    ['frame', 'save', '--env', 'missing', '--output', join(output, 'missing-target')],
    true,
    5,
  );
  await run(['runtime', 'down'], true);
  daemonStarted = false;
  model.kill('SIGTERM');
  await once(model, 'exit');
  const info = await run(['recording', 'info', file]);
  assert.equal(info.frameCount, 6); // Five actions plus the stop lifecycle, with repeated model time.
  const selected = await run(['recording', 'seek', file, '--time', '5', '--match', 'last']);
  assert.equal(selected.position.frame, 6);
  const history = join(output, 'history');
  await run([
    'recording',
    'export-frame',
    file,
    '--frame',
    '3',
    '--output',
    history,
    ...imageFlags,
  ]);
  const png = join(output, 'offline.png');
  await run([
    'recording',
    'render',
    join(history, 'state.recording.json'),
    '--frame',
    '0',
    '--env',
    'main',
    '--width',
    '640',
    '--height',
    '480',
    '--output',
    png,
  ]);
  assert.deepEqual(await readFile(png), await readFile(join(history, 'environment-main.png')));
  const batch = await run([
    'recording',
    'render',
    file,
    '--frame',
    '3',
    '--output',
    join(output, 'all.png'),
    '--width',
    '640',
    '--height',
    '480',
  ]);
  assert.equal(batch.artifacts.length, 2);
  assert.equal(new Set(batch.artifacts.map((artifact) => artifact.path)).size, 2);
  const report = {
    ok: true,
    model: 'schelling',
    seed: 42,
    actions: 5,
    recordingFrames: info.frameCount,
    restoredSceneEqual: true,
    rerunSceneEqual: comparison.equal,
    rerunCheckpointEqual: comparison.checkpointEqual,
    offlineImageEqual: true,
    commands,
  };
  await writeFile(join(output, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, output }));
} finally {
  if (daemonStarted) await run(['runtime', 'down'], true).catch(() => {});
  if (model.exitCode === null && model.signalCode === null) {
    model.kill('SIGTERM');
    await once(model, 'exit');
  }
}
