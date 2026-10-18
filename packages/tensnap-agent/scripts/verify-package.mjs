#!/usr/bin/env node

// Acceptance against real npm tarballs, installed outside the checkout with an isolated HOME.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import {
  cp,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { stampSkill } from './skills-build.mjs';

const execute = promisify(execFile);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'tensnap-npm-acceptance-'));
const app = join(temporary, 'app');
const project = join(temporary, 'model');
const userHome = join(temporary, 'home');
const env = {
  ...process.env,
  PATH: `${dirname(process.execPath)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
  HOME: userHome,
  USERPROFILE: userHome,
  npm_config_cache: join(temporary, 'cache'),
  npm_config_audit: 'false',
  npm_config_fund: 'false',
};
delete env.NODE_PATH;
delete env.CODEX_HOME;
const manifest = JSON.parse(await readFile(join(packageRoot, 'dist/package.json'), 'utf8'));
const dependencies = [];
const denyNetwork = join(temporary, 'deny-network.cjs');
let server;
let cli;

async function command(file, args, options = {}) {
  try {
    return await execute(file, args, {
      cwd: project,
      env,
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    throw new Error(
      `${file} ${args.join(' ')} failed (${error.code}):\n${error.stdout ?? ''}\n${error.stderr ?? ''}`,
      { cause: error },
    );
  }
}

async function run(args, expectedCode = 0, options = {}) {
  let result;
  try {
    const nodeArgs = args[0] === 'skills' ? ['--require', denyNetwork] : [];
    result = await execute(process.execPath, [...nodeArgs, cli, ...args, '--output-version', '1'], {
      cwd: project,
      env: { ...env, HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1' },
      timeout: 20_000,
      ...options,
    });
    assert.equal(expectedCode, 0, `Expected exit ${expectedCode}: ${args}`);
  } catch (error) {
    if (!('stdout' in error)) throw error;
    assert.equal(error.code, expectedCode, error.stderr);
    result = error;
  }
  const response = JSON.parse(result.stdout);
  assert.equal(response.schemaVersion, 1);
  assert.equal(response.ok, expectedCode === 0, result.stderr);
  return response;
}

async function pack(directory) {
  const result = await command('npm', [
    'pack',
    directory,
    '--json',
    '--pack-destination',
    temporary,
  ]);
  const packed = JSON.parse(result.stdout);
  const [{ filename }] = Array.isArray(packed) ? packed : Object.values(packed);
  return join(temporary, filename);
}

async function install(tarball) {
  await command('npm', ['install', '--no-audit', '--no-fund', ...dependencies, tarball], {
    cwd: app,
  });
  cli = join(app, 'node_modules/.bin/tensnap-agent');
}

async function checkLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert(!entry.isSymbolicLink(), `Bundled resource is a symlink: ${path}`);
    if (entry.isDirectory()) await checkLinks(path);
    else if (entry.name.endsWith('.md')) {
      const text = (await readFile(path, 'utf8')).replace(/```[\s\S]*?```/g, '');
      for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
        const link = match[1].split('#')[0];
        if (!link || /^(?:https?:|mailto:)/.test(link)) continue;
        assert(
          (await lstat(resolve(dirname(path), link))).isFile(),
          `Missing reference in ${path}: ${link}`,
        );
      }
    }
  }
}

try {
  for (const path of [app, project, userHome]) await mkdir(path, { recursive: true });
  await writeFile(
    denyNetwork,
    `
const { syncBuiltinESMExports } = require('node:module');
require('node:net').Socket.prototype.connect = function () { throw new Error('Offline skill install attempted network access'); };
globalThis.fetch = async function () { throw new Error('Offline skill install attempted fetch'); };
const fs = require('node:fs/promises');
const rename = fs.rename;
fs.rename = async function (from, to) {
  if (process.env.TENSNAP_TEST_FAIL_COMMIT && from.includes('.tensnap-stage-') && to.endsWith('/tensnap-abm-binding')) {
    const error = new Error('Injected commit failure'); error.code = 'EACCES'; throw error;
  }
  return rename(from, to);
};
syncBuiltinESMExports();
`,
  );
  await writeFile(
    join(app, 'package.json'),
    JSON.stringify({
      name: 'acceptance-model',
      private: true,
      type: 'module',
      allowScripts: { canvas: true },
    }),
  );
  await checkLinks(join(packageRoot, 'dist'));
  // Use the same dependency artifacts as a coordinated release, including unpublished versions.
  for (const directory of ['network', 'protocol', 'core']) {
    const path = resolve(packageRoot, '..', directory);
    await command('pnpm', ['--dir', path, 'build'], { cwd: packageRoot });
    const tarball = join(temporary, `${directory}.tgz`);
    await command('pnpm', ['--dir', path, 'pack', '--out', tarball], { cwd: packageRoot });
    dependencies.push(tarball);
  }
  const currentTarball = await pack(join(packageRoot, 'dist'));

  // A synthetic earlier release exercises a real npm package replacement without registry writes.
  const earlier = join(temporary, 'earlier');
  await cp(join(packageRoot, 'dist'), earlier, { recursive: true });
  await writeFile(
    join(earlier, 'package.json'),
    JSON.stringify({ ...manifest, version: '0.0.0-acceptance' }),
  );
  const bundlePath = join(earlier, 'skills/manifest.json');
  const oldBundle = JSON.parse(await readFile(bundlePath, 'utf8'));
  oldBundle.version = '0.0.0-acceptance';
  for (const skill of oldBundle.skills) {
    const path = join(earlier, 'skills', skill.name, 'SKILL.md');
    const text = stampSkill(await readFile(path, 'utf8'), skill.name, '0.0.0-acceptance').content;
    await writeFile(path, text);
    skill.files['SKILL.md'] = createHash('sha256').update(text).digest('hex');
  }
  // Verify that npm packing and offline copying both retain executable resources.
  const executablePath = 'scripts/package-check.sh';
  const executableText = '#!/bin/sh\nexit 0\n';
  const executableSource = join(earlier, 'skills', oldBundle.skills[0].name, executablePath);
  await mkdir(dirname(executableSource), { recursive: true });
  await writeFile(executableSource, executableText);
  await chmod(executableSource, 0o755);
  oldBundle.skills[0].files[executablePath] = createHash('sha256')
    .update(executableText)
    .digest('hex');
  oldBundle.skills[0].executables.push(executablePath);
  await writeFile(bundlePath, JSON.stringify(oldBundle));
  await install(await pack(earlier));
  assert.equal((await run(['--version'])).data, '0.0.0-acceptance');
  assert.equal((await run(['skills', 'install', '--all'])).data.results[0].status, 'installed');
  const installedExecutable = join(
    project,
    '.agents/skills',
    oldBundle.skills[0].name,
    executablePath,
  );
  assert((await lstat(installedExecutable)).mode & 0o111);
  await chmod(installedExecutable, 0o644);
  await run(['skills', 'install', '--all'], 2);
  await chmod(installedExecutable, 0o755);
  const upgradeNote = join(project, '.agents/skills/tensnap-abm-binding/local.txt');
  await writeFile(upgradeNote, 'keep this during upgrade');
  await install(currentTarball);
  await command(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import { createDefaultRootLayout, encodeProjectFile, decodeProjectFile, encodeRecordingFile, decodeRecordingFile } from '@tensnap/core/persistence';
    import { Scenario } from '@tensnap/core/scenario';
    import { createSingleSnapshot } from '@tensnap/core/snapshot';
    assert.equal(typeof window, 'undefined');
    const scene = new Scenario().dump();
    const snapshot = createSingleSnapshot(scene, { id: 'published-import' });
    const project = { version: 3, source: { kind: 'snapshot', snapshot_id: 'published-import' }, mainView: createDefaultRootLayout(), scenario: scene, snapshots: [snapshot] };
    for (const format of ['json', 'msgpack']) {
      assert.equal(decodeProjectFile(encodeProjectFile(project, format), format).snapshots[0].metadata.id, 'published-import');
      assert.equal(decodeRecordingFile(encodeRecordingFile(snapshot, { format })).report.resourcesComplete, true);
    }
    console.log('PASS: published core/persistence imports and round trips in pure Node');
  `,
    ],
    { cwd: app },
  );
  assert.equal((await command(cli, ['--version'])).stdout.trim(), manifest.version);
  assert.equal((await run(['--version'])).data, manifest.version);
  await run(['skills', 'install', '--all'], 2);
  assert.equal(await readFile(upgradeNote, 'utf8'), 'keep this during upgrade');
  assert(
    (await readFile(join(project, '.agents/skills/tensnap-agent/SKILL.md'), 'utf8')).includes(
      '0.0.0-acceptance',
    ),
  );
  await rm(upgradeNote);
  const upgraded = (await run(['skills', 'install', '--all'])).data;
  assert(upgraded.results.every((result) => result.status === 'upgraded'));
  for (const result of upgraded.results) {
    assert.equal(result.previousVersion, '0.0.0-acceptance');
    assert(
      (await readFile(join(result.backupPath, 'SKILL.md'), 'utf8')).includes('0.0.0-acceptance'),
    );
    assert(!result.backupPath.startsWith(upgraded.root + '/'));
  }
  assert(
    (await run(['skills', 'install', '--all'])).data.results.every(
      (result) => result.status === 'unchanged',
    ),
  );

  const listed = (await run(['skills', 'list'])).data;
  assert.equal(listed.version, manifest.version);
  assert.equal(listed.skills.length, 2);
  const require = createRequire(join(app, 'package.json'));
  const nativeBuild = join(dirname(require.resolve('canvas/package.json')), 'build');
  const savedBuild = join(temporary, 'canvas-build');
  await rename(nativeBuild, savedBuild);
  try {
    assert.equal((await run(['--version'])).data, manifest.version);
    const help = await command(cli, ['run', 'start', '--help']);
    assert.equal(help.stderr, '');
    assert(help.stdout.includes('Usage: tensnap-agent run start'));
    assert(help.stdout.includes('--max-actions'));
    assert((await run(['param', 'set', '--help'])).data.includes('Usage: tensnap-agent param set'));
    assert(
      (await run(['skills', '--help'])).data.includes('Installs are offline and non-interactive.'),
    );
    assert.equal((await run(['--version', '--unknown'], 2)).error.category, 'input_error');
    assert.equal((await run(['run', 'start'], 2)).error.category, 'input_error');
    assert.equal((await run(['action', 'run', ''], 2)).error.category, 'input_error');
    assert.equal((await run(['scene', 'restore'], 2)).error.category, 'input_error');
    assert.equal(
      (await run(['runtime', 'up', '--ip-family', 'invalid'], 2)).error.category,
      'input_error',
    );
    assert.equal(
      (await run(['runtime', 'up', '--port', 'Infinity'], 2)).error.category,
      'input_error',
    );
    assert.equal((await run(['skills', 'list'])).data.skills.length, 2);
    assert.equal((await run(['skills', 'install', '--all'])).data.results[0].status, 'unchanged');
  } finally {
    await rename(savedBuild, nativeBuild);
  }
  const installedRoot = listed.root;
  for (const skill of listed.skills) {
    await checkLinks(join(installedRoot, skill.name));
    const content = await readFile(join(installedRoot, skill.name, 'SKILL.md'), 'utf8');
    assert.equal(parse(content.split('---')[1]).metadata.version, manifest.version);
  }
  const user = (await run(['skills', 'install', 'tensnap-agent', '--scope', 'user'])).data;
  assert.equal(user.root, join(userHome, '.agents/skills'));
  assert.equal(
    (await run(['skills', 'install', 'tensnap-agent', '--scope', 'user'])).data.results[0].status,
    'unchanged',
  );
  const claude = (
    await run(['skills', 'install', '--all', '--agent', 'claude-code', '--scope', 'user'])
  ).data;
  assert.equal(claude.root, join(userHome, '.claude/skills'));
  const otherProject = join(temporary, 'explicit-project');
  const explicit = (
    await run([
      'skills',
      'install',
      'tensnap-abm-binding',
      '--project-dir',
      otherProject,
      '--agent',
      'universal',
    ])
  ).data;
  assert.equal(explicit.root, join(otherProject, '.agents/skills'));

  const binding = join(installedRoot, 'tensnap-abm-binding');
  const custom = join(binding, 'my-notes.txt');
  await writeFile(custom, 'user content');
  const agentSkill = join(installedRoot, 'tensnap-agent');
  const original = await readFile(join(agentSkill, 'SKILL.md'), 'utf8');
  await rm(join(agentSkill, '.tensnap-skill.json'));
  await writeFile(join(agentSkill, 'SKILL.md'), original + '\nuser changes\n');
  assert.equal((await run(['skills', 'install', '--all'], 2)).error.category, 'input_error');
  assert.equal(await readFile(custom, 'utf8'), 'user content');
  assert((await readFile(join(agentSkill, 'SKILL.md'), 'utf8')).includes('user changes'));
  const replaced = (await run(['skills', 'install', '--all', '--force'])).data.results;
  assert(replaced.every((result) => result.status === 'replaced'));
  assert.equal(
    await readFile(
      join(
        replaced.find((result) => result.name === 'tensnap-abm-binding').backupPath,
        'my-notes.txt',
      ),
      'utf8',
    ),
    'user content',
  );

  await rm(agentSkill, { recursive: true });
  const linkTarget = join(temporary, 'user-owned-skill');
  await mkdir(linkTarget);
  await writeFile(join(linkTarget, 'SKILL.md'), 'user owned');
  await symlink(linkTarget, agentSkill, 'dir');
  await run(['skills', 'install', 'tensnap-agent'], 2);
  const linkReplacement = (await run(['skills', 'install', 'tensnap-agent', '--force'])).data
    .results[0];
  assert((await lstat(linkReplacement.backupPath)).isSymbolicLink());
  assert.equal(await readFile(join(linkTarget, 'SKILL.md'), 'utf8'), 'user owned');
  await writeFile(join(installedRoot, '.tensnap-install.lock'), 'busy');
  await run(['skills', 'install', '--all'], 2);
  await rm(join(installedRoot, '.tensnap-install.lock'));
  const linkedProject = join(temporary, 'linked-project');
  await mkdir(linkedProject);
  await symlink(join(userHome, '.agents'), join(linkedProject, '.agents'), 'dir');
  await run(['skills', 'install', '--all', '--project-dir', linkedProject], 2);
  for (const args of [
    ['skills', 'install'],
    ['skills', 'install', '../escape'],
    ['skills', 'install', '--all', '--scope', 'user', '--project-dir', project],
  ])
    await run(args, 2);

  const receiptPath = join(binding, '.tensnap-skill.json');
  const receiptBytes = await readFile(receiptPath);
  for (const invalid of ['null', '{broken', '[]']) {
    await writeFile(receiptPath, invalid);
    await run(['skills', 'install', 'tensnap-abm-binding'], 2);
  }
  await writeFile(receiptPath, receiptBytes);
  const reference = join(binding, 'references/protocol-types.md');
  const referenceBytes = await readFile(reference);
  await rm(reference);
  await run(['skills', 'install', 'tensnap-abm-binding'], 2);
  await writeFile(reference, referenceBytes);

  const rollbackProject = join(temporary, 'rollback-project');
  const rollbackRoot = join(rollbackProject, '.agents/skills');
  for (const { name } of listed.skills) {
    await mkdir(join(rollbackRoot, name), { recursive: true });
    await writeFile(join(rollbackRoot, name, 'SKILL.md'), `original ${name}`);
  }
  const failure = await run(
    ['skills', 'install', '--all', '--force', '--project-dir', rollbackProject],
    6,
    {
      env: { ...env, TENSNAP_TEST_FAIL_COMMIT: '1' },
    },
  );
  assert.equal(failure.error.category, 'persistence_failed');
  assert.deepEqual(
    (await readdir(rollbackRoot)).sort(),
    listed.skills.map(({ name }) => name).sort(),
  );
  for (const { name } of listed.skills)
    assert.equal(await readFile(join(rollbackRoot, name, 'SKILL.md'), 'utf8'), `original ${name}`);

  const bundledEntrypoint = join(listed.source, 'tensnap-agent/SKILL.md');
  const sourceBytes = await readFile(bundledEntrypoint);
  await writeFile(bundledEntrypoint, 'corrupted');
  await run(['skills', 'install', '--all'], 2);
  await writeFile(bundledEntrypoint, sourceBytes);
  console.log(
    'PASS: npm tarball upgrade, offline scopes, repeat install, local edits, conflicts, backups, links, locks, integrity, and rollback',
  );

  if (process.argv.includes('--ecosystem')) {
    const ecosystemProject = join(temporary, 'ecosystem-project');
    await mkdir(ecosystemProject);
    await command(
      'npm',
      [
        'exec',
        '--yes',
        '--package=skills@1.7.2',
        '--',
        'skills',
        'add',
        listed.source,
        '--skill',
        'tensnap-agent',
        '--skill',
        'tensnap-abm-binding',
        '--agent',
        'codex',
        '--copy',
        '--yes',
      ],
      {
        cwd: ecosystemProject,
        env: { ...env, DISABLE_TELEMETRY: '1' },
      },
    );
    for (const { name } of listed.skills) {
      const path = join(ecosystemProject, '.agents/skills', name);
      assert((await lstat(join(path, 'SKILL.md'))).isFile());
      await checkLinks(path);
    }
    await run(['skills', 'install', '--all', '--project-dir', ecosystemProject], 2);
    console.log(
      'PASS: Vercel skills 1.7.2 local bundle discovery, copy install, complete references, and installer ownership conflict',
    );
  }

  // Resolve every runtime dependency from the isolated npm install.
  const { WebSocketServer } = require('ws');
  server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  let tick = 0;
  server.on('connection', (socket) => {
    const send = (type, payload) => socket.send(JSON.stringify({ type, payload }));
    send('simulator_info', {
      protocol_version: '0.3',
      binding: { name: 'package-acceptance', version: '1' },
      model: { id: 'counter' },
      instance_id: 'counter-1',
      capabilities: [],
    });
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      const request_id = message.payload?.request_id;
      if (message.type === 'state_sync') {
        send('state_sync_begin', {
          request_id,
          model_id: 'counter',
          instance_id: 'counter-1',
          mode: 'replace',
        });
        send('env_create', { id: 'main', type: '2d' });
        send('env_layer_create', { env_id: 'main', layer_id: 'agents', layer_type: 'agent' });
        send('item_create', {
          env_id: 'main',
          layer_id: 'agents',
          items: [{ id: 'one', x: 5, y: 5, color: '#00aa88', size: 1 }],
        });
        send('action_create', { id: 'step', label: 'Step', continuous: true });
        send('metadata_update', { time: tick });
        send('state_sync_end', { request_id, state_revision: '1' });
      } else if (message.type === 'action_invoke') {
        tick += 1;
        send('metadata_update', { time: tick });
        send('action_result', { id: message.payload.id, request_id, should_continue: true });
      }
    });
  });
  await run([
    'runtime',
    'up',
    '--context',
    'package',
    '--encoding',
    'json',
    '--simulator-url',
    `ws://127.0.0.1:${server.address().port}`,
  ]);
  assert((await run(['scene', 'inspect', '--context', 'package'])).data);
  const accepted = (
    await run(['run', 'start', 'step', '--max-actions', '2', '--record', '--context', 'package'])
  ).data;
  assert(accepted.run.id);
  const summary = (
    await run(['run', 'wait', accepted.run.id, '--until', 'persisted', '--context', 'package'])
  ).data;
  assert.equal(summary.run.completedActions, 2);
  assert.equal(summary.run.settled, true);
  assert.equal(summary.run.recording.status, 'persisted');
  const output = join(project, 'evidence.png');
  await run([
    'scene',
    'render',
    '--env',
    'main',
    '--width',
    '320',
    '--height',
    '200',
    '--output',
    output,
    '--context',
    'package',
  ]);
  const bytes = await readFile(output);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.equal(bytes.readUInt32BE(16), 320);
  assert.equal(bytes.readUInt32BE(20), 200);
  await run(['runtime', 'down', '--context', 'package']);
  // Copies stay complete even after the npm package is removed.
  await rm(join(app, 'node_modules/@tensnap/agent'), { recursive: true });
  await checkLinks(join(installedRoot, 'tensnap-agent'));
  console.log(
    'PASS: installed CLI sync, bounded run, persisted recording, headless PNG, shutdown, and independent skill copies',
  );
} catch (error) {
  for (const path of ['runtime.json', 'logs/runtime.log']) {
    try {
      console.error(await readFile(join(project, '.tensnap/contexts/package', path), 'utf8'));
    } catch {
      /* Runtime may not have started. */
    }
  }
  throw error;
} finally {
  if (cli) {
    try {
      await run(['runtime', 'down', '--context', 'package']);
    } catch {
      /* may already be stopped or removed */
    }
  }
  if (server) {
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
  await rm(temporary, { recursive: true, force: true });
}
