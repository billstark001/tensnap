import type * as FileSystem from 'node:fs/promises';
import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { installSkills, loadSkillBundleFrom, readSkillTree, type SkillBundle } from './skills';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof FileSystem>();
  return {
    ...original,
    writeFile: vi.fn(original.writeFile),
    rename: vi.fn(original.rename),
    rm: vi.fn(original.rm),
  };
});
const original = await vi.importActual<typeof FileSystem>('node:fs/promises');
const roots: string[] = [];
afterEach(async () => {
  vi.mocked(writeFile).mockReset().mockImplementation(original.writeFile);
  vi.mocked(rename).mockReset().mockImplementation(original.rename);
  vi.mocked(rm).mockReset().mockImplementation(original.rm);
  await Promise.all(
    roots.splice(0).map((path) => original.rm(path, { recursive: true, force: true })),
  );
});

async function fixture(executable = false) {
  const temporary = await mkdtemp(join(tmpdir(), 'tensnap-skills-'));
  roots.push(temporary);
  const source = join(temporary, 'bundle');
  const root = join(temporary, 'model/.agents/skills');
  const bundle: SkillBundle = {
    schemaVersion: 1,
    package: '@tensnap/agent',
    version: '1.0.0',
    skills: [],
  };
  for (const name of ['alpha', 'beta']) {
    const path = join(source, name);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'SKILL.md'), `---\nname: ${name}\ndescription: Test skill\n---\n`);
    if (executable) {
      await mkdir(join(path, 'scripts'));
      await writeFile(join(path, 'scripts/check.sh'), '#!/bin/sh\nexit 0\n');
      await chmod(join(path, 'scripts/check.sh'), 0o755);
    }
    const tree = await readSkillTree(path);
    bundle.skills.push({
      name,
      description: 'Test skill',
      files: tree.files,
      executables: tree.executables,
    });
  }
  await writeFile(join(source, 'manifest.json'), JSON.stringify(bundle));
  await loadSkillBundleFrom(source, bundle.version);
  return {
    temporary,
    source,
    root,
    bundle,
    install: (force = false) => installSkills(source, bundle, root, bundle.skills, force),
  };
}

it('tracks reserved filenames, empty directories, and executable changes', async () => {
  const f = await fixture();
  const skill = join(f.source, 'alpha');
  await writeFile(join(skill, '__proto__'), 'user content');
  await mkdir(join(skill, 'empty'));
  const initial = await readSkillTree(skill);
  expect(Object.hasOwn(initial.files, '__proto__')).toBe(true);
  expect(initial.directories).toContain('empty');
  await chmod(join(skill, '__proto__'), 0o755);
  expect((await readSkillTree(skill)).executables).toContain('__proto__');
});

it('copies executable resources and treats chmod and empty-directory additions as local edits', async () => {
  const f = await fixture(true);
  await f.install();
  const script = join(f.root, 'alpha/scripts/check.sh');
  expect((await lstat(script)).mode & 0o111).not.toBe(0);
  await chmod(script, 0o644);
  await expect(f.install()).rejects.toMatchObject({ category: 'input_error' });
  const replaced = await f.install(true);
  expect((await lstat(join(replaced[0].backupPath!, 'scripts/check.sh'))).mode & 0o111).toBe(0);
  expect((await lstat(script)).mode & 0o111).not.toBe(0);
  await mkdir(join(f.root, 'alpha/my-empty-directory'));
  await expect(f.install()).rejects.toMatchObject({ category: 'input_error' });
});

it('can upgrade older non-executable receipts without requiring force', async () => {
  const f = await fixture();
  await f.install();
  for (const { name } of f.bundle.skills) {
    const path = join(f.root, name, '.tensnap-skill.json');
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    delete receipt.executables;
    await writeFile(path, JSON.stringify(receipt));
  }
  f.bundle.version = '2.0.0';
  expect((await f.install()).map(({ status }) => status)).toEqual(['upgraded', 'upgraded']);
});

it.each([null, [], {}, { skills: {} }])(
  'rejects malformed bundle JSON with an actionable input error: %j',
  async (value) => {
    const f = await fixture();
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(value));
    await expect(loadSkillBundleFrom(f.source, '1.0.0')).rejects.toMatchObject({
      category: 'input_error',
      message: expect.stringContaining('Rebuild or reinstall'),
    });
  },
);

it.each(['duplicate', 'escape', 'missing', 'linked-root', 'linked-file'] as const)(
  'rejects invalid bundle resources: %s',
  async (kind) => {
    const f = await fixture();
    if (kind === 'duplicate') f.bundle.skills.push(f.bundle.skills[0]);
    if (kind === 'escape') f.bundle.skills[0].files['../escape'] = '0'.repeat(64);
    if (kind === 'missing') await rm(join(f.source, 'alpha/SKILL.md'));
    if (kind === 'linked-root') {
      await rename(join(f.source, 'alpha'), join(f.temporary, 'external'));
      await symlink(join(f.temporary, 'external'), join(f.source, 'alpha'), 'dir');
    }
    if (kind === 'linked-file') {
      await rename(join(f.source, 'alpha/SKILL.md'), join(f.temporary, 'external.md'));
      await symlink(join(f.temporary, 'external.md'), join(f.source, 'alpha/SKILL.md'));
    }
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.bundle));
    await expect(loadSkillBundleFrom(f.source, '1.0.0')).rejects.toMatchObject({
      category: 'input_error',
    });
  },
);

it('preserves edits made during staging and keeps staged skills outside discovery', async () => {
  const f = await fixture();
  await f.install();
  f.bundle.version = '2.0.0';
  let edited = false;
  vi.mocked(writeFile).mockImplementation(async (path, data, options) => {
    if (!edited && String(path).includes('.tensnap-stage-')) {
      expect(String(path).startsWith(f.root + '/')).toBe(false);
      await original.writeFile(join(f.root, 'alpha/user-notes'), 'new user edit');
      edited = true;
    }
    return original.writeFile(path, data, options);
  });
  await expect(f.install()).rejects.toThrow('changed during installation');
  expect(await readFile(join(f.root, 'alpha/user-notes'), 'utf8')).toBe('new user edit');
  expect(
    JSON.parse(await readFile(join(f.root, 'alpha/.tensnap-skill.json'), 'utf8')).version,
  ).toBe('1.0.0');
  expect((await readdir(f.root)).sort()).toEqual(['alpha', 'beta']);
});

it('checks copied bytes before committing any skill', async () => {
  const f = await fixture();
  vi.mocked(writeFile).mockImplementation(async (path, data, options) =>
    original.writeFile(
      path,
      String(path).includes('.tensnap-stage-') && String(path).endsWith('SKILL.md')
        ? 'corrupt copy'
        : data,
      options,
    ),
  );
  await expect(f.install()).rejects.toThrow('changed while staging');
  expect(await readdir(f.root)).toEqual([]);
});

async function existingTargets() {
  const f = await fixture();
  for (const { name } of f.bundle.skills) {
    await mkdir(join(f.root, name), { recursive: true });
    await writeFile(join(f.root, name, 'SKILL.md'), `original ${name}`);
  }
  return f;
}
function failSecondCommit() {
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (String(from).includes('.tensnap-stage-') && String(to).endsWith('/beta'))
      throw Object.assign(new Error('commit failure'), { code: 'EACCES' });
    return original.rename(from, to);
  });
}

it('continues restoring other skills when one rollback fails and retains the recovery lock', async () => {
  const f = await existingTargets();
  failSecondCommit();
  const commit = vi.mocked(rename).getMockImplementation()!;
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (String(from).includes('.tensnap-skill-backups') && String(to).endsWith('/beta'))
      throw new Error('rollback failure');
    return commit(from, to);
  });
  await expect(f.install(true)).rejects.toMatchObject({
    category: 'persistence_failed',
    message: expect.stringMatching(
      /commit failure.*Rollback incomplete:.*original backup:.*\.tensnap-install.lock/,
    ),
  });
  expect(await readFile(join(f.root, 'alpha/SKILL.md'), 'utf8')).toBe('original alpha');
  const backups = join(dirname(f.root), '.tensnap-skill-backups');
  const beta = (await readdir(backups)).find((name) => name.startsWith('beta-'))!;
  expect(await readFile(join(backups, beta, 'SKILL.md'), 'utf8')).toBe('original beta');
  expect((await lstat(join(f.root, '.tensnap-install.lock'))).isFile()).toBe(true);
  await expect(f.install(true)).rejects.toThrow('Another skill install');
});

it('cleans other stages and releases the lock even when stage cleanup fails', async () => {
  const f = await existingTargets();
  failSecondCommit();
  let leftover = '';
  vi.mocked(rm).mockImplementation(async (path, options) => {
    if (
      !leftover &&
      String(path).includes('.tensnap-stage-') &&
      (await original.lstat(path).then(
        () => true,
        () => false,
      ))
    ) {
      leftover = String(path);
      throw new Error('cleanup failure');
    }
    return original.rm(path, options);
  });
  await expect(f.install(true)).rejects.toMatchObject({
    category: 'persistence_failed',
    message: expect.stringMatching(/commit failure.*cleanup failure/),
  });
  expect(await readFile(join(f.root, 'alpha/SKILL.md'), 'utf8')).toBe('original alpha');
  expect(await readFile(join(f.root, 'beta/SKILL.md'), 'utf8')).toBe('original beta');
  expect((await readdir(f.root)).sort()).toEqual(['alpha', 'beta']);
  expect(
    (await readdir(dirname(f.root))).filter((name) => name.startsWith('.tensnap-stage-')),
  ).toEqual([leftover.split('/').pop()]);
});
