import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliInputError } from './cli-options';

export interface SkillOptions {
  scope?: 'project' | 'user';
  agent?: 'codex' | 'claude-code' | 'universal';
  projectDir?: string;
  all?: boolean;
  force?: boolean;
}

function packageVersion(): string {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  }
}

export const CLI_VERSION = packageVersion();
const RECEIPT = '.tensnap-skill.json';
const PACKAGE = '@tensnap/agent';

interface FileSet {
  files: Record<string, string>;
  // Older receipts describe non-executable resources and omit this field.
  executables?: string[];
}
export interface SkillEntry extends FileSet {
  name: string;
  description: string;
}
export interface SkillBundle {
  schemaVersion: 1;
  package: string;
  version: string;
  skills: SkillEntry[];
}
interface Receipt extends FileSet {
  schemaVersion: 1;
  package: string;
  version: string;
  name: string;
}
interface SkillTree extends FileSet {
  executables: string[];
  directories: string[];
}

export class SkillPersistenceError extends Error {
  readonly category = 'persistence_failed';
  readonly exitCode = 6;
}

async function stat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function validPath(path: string): boolean {
  return (
    !isAbsolute(path) &&
    !/^[a-z]:/i.test(path) &&
    !/[\\\0]/.test(path) &&
    !path.split('/').some((part) => ['..', '.', ''].includes(part)) &&
    path !== RECEIPT
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function fileSet(value: Record<string, unknown>): value is Record<string, unknown> & FileSet {
  return (
    record(value.files) &&
    typeof value.files['SKILL.md'] === 'string' &&
    Object.entries(value.files).every(
      ([path, hash]) => validPath(path) && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash),
    ) &&
    (value.executables === undefined ||
      (Array.isArray(value.executables) &&
        new Set(value.executables).size === value.executables.length &&
        value.executables.every(
          (path) => typeof path === 'string' && Object.hasOwn(value.files as object, path),
        )))
  );
}
function sameFiles(a: Record<string, string>, b: Record<string, string>): boolean {
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([path, hash]) => b[path] === hash)
  );
}
function sameNames(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((name) => b.includes(name));
}
function directoriesFor(files: Record<string, string>): string[] {
  const directories = new Set<string>();
  for (const path of Object.keys(files)) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  return [...directories];
}
function matches(tree: SkillTree, expected: FileSet): boolean {
  return (
    sameFiles(tree.files, expected.files) &&
    sameNames(tree.directories, directoriesFor(expected.files)) &&
    (process.platform === 'win32' || sameNames(tree.executables, expected.executables ?? []))
  );
}

/** Reject links at every level; retain empty directories and executable bits as local changes. */
export async function readSkillTree(root: string, prefix = ''): Promise<SkillTree> {
  const directory = join(root, prefix);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new CliInputError(`Skill must be a real directory: ${directory}`);
  const tree: SkillTree = { files: Object.create(null), executables: [], directories: [] };
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!prefix && path === RECEIPT) continue;
    if (entry.isDirectory()) {
      const nested = await readSkillTree(root, path);
      Object.assign(tree.files, nested.files);
      tree.directories.push(path, ...nested.directories);
      tree.executables.push(...nested.executables);
    } else if (entry.isFile()) {
      tree.files[path] = createHash('sha256')
        .update(await readFile(join(root, path)))
        .digest('hex');
      if ((await lstat(join(root, path))).mode & 0o111) tree.executables.push(path);
    } else throw new CliInputError(`Skill contains a symlink or special file: ${join(root, path)}`);
  }
  return tree;
}

export async function loadSkillBundleFrom(root: string, version: string): Promise<SkillBundle> {
  try {
    const info = await lstat(root);
    const manifest = join(root, 'manifest.json');
    if (!info.isDirectory() || info.isSymbolicLink() || !(await lstat(manifest)).isFile())
      throw new Error('bundle paths must be regular files and directories');
    const bundle: unknown = JSON.parse(await readFile(manifest, 'utf8'));
    if (
      !record(bundle) ||
      bundle.schemaVersion !== 1 ||
      bundle.package !== PACKAGE ||
      bundle.version !== version ||
      !Array.isArray(bundle.skills) ||
      !bundle.skills.length
    )
      throw new Error('invalid manifest or CLI version mismatch');
    const names = new Set<string>();
    for (const skill of bundle.skills) {
      if (
        !record(skill) ||
        typeof skill.name !== 'string' ||
        skill.name.length > 64 ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) ||
        names.has(skill.name) ||
        typeof skill.description !== 'string' ||
        !skill.description.trim() ||
        !fileSet(skill)
      )
        throw new Error('invalid or duplicate skill entry');
      names.add(skill.name);
      if (!matches(await readSkillTree(join(root, skill.name)), skill))
        throw new Error(`resource integrity check failed: ${skill.name}`);
    }
    return bundle as unknown as SkillBundle;
  } catch (error) {
    throw new CliInputError(
      `Cannot load bundled skills at ${root}: ${error instanceof Error ? error.message : String(error)}. Rebuild or reinstall @tensnap/agent.`,
    );
  }
}

async function loadSkillBundle(): Promise<{ root: string; bundle: SkillBundle }> {
  for (const url of ['./skills/', '../dist/skills/']) {
    const root = fileURLToPath(new URL(url, import.meta.url));
    if (await stat(root)) return { root, bundle: await loadSkillBundleFrom(root, CLI_VERSION) };
  }
  throw new CliInputError(
    'Bundled skills are missing. Run pnpm --filter @tensnap/agent build in a checkout, or reinstall @tensnap/agent.',
  );
}

function target(options: SkillOptions) {
  const scope = options.scope ?? 'project';
  const agent = options.agent ?? 'codex';
  const base = scope === 'user' ? homedir() : resolve(options.projectDir ?? process.cwd());
  return {
    scope,
    agent,
    root: join(base, agent === 'claude-code' ? '.claude' : '.agents', 'skills'),
  };
}

async function requireRealDirectories(path: string, base = dirname(dirname(path))): Promise<void> {
  if (path === base) return;
  const info = await stat(path);
  if (info && (!info.isDirectory() || info.isSymbolicLink()))
    throw new CliInputError(`Skill destination ancestor must be a real directory: ${path}`);
  const parent = dirname(path);
  if (parent !== path) await requireRealDirectories(parent, base);
}

async function readReceipt(path: string, name: string): Promise<Receipt | undefined> {
  try {
    if (!(await lstat(path)).isFile()) return undefined;
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (
      record(value) &&
      value.schemaVersion === 1 &&
      value.package === PACKAGE &&
      value.name === name &&
      typeof value.version === 'string' &&
      fileSet(value)
    )
      return value as unknown as Receipt;
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw error;
  }
  return undefined;
}

interface TargetState {
  info?: Awaited<ReturnType<typeof stat>>;
  receipt?: Receipt;
  tree?: SkillTree;
}
async function inspectTarget(path: string, name: string): Promise<TargetState> {
  const info = await stat(path);
  const state: TargetState = { info };
  if (info?.isDirectory() && !info.isSymbolicLink()) {
    state.receipt = await readReceipt(join(path, RECEIPT), name);
    try {
      state.tree = await readSkillTree(path);
    } catch (error) {
      if (!(error instanceof CliInputError)) throw error;
    }
  }
  return state;
}
function unchangedTarget(a: TargetState, b: TargetState): boolean {
  return (
    a.info?.ino === b.info?.ino &&
    a.info?.dev === b.info?.dev &&
    JSON.stringify(a.receipt) === JSON.stringify(b.receipt) &&
    (!a.tree
      ? !b.tree
      : !!b.tree &&
        sameFiles(a.tree.files, b.tree.files) &&
        sameNames(a.tree.directories, b.tree.directories) &&
        sameNames(a.tree.executables, b.tree.executables))
  );
}

interface InstallResult {
  name: string;
  path: string;
  status: 'installed' | 'unchanged' | 'upgraded' | 'replaced';
  previousVersion?: string;
  backupPath?: string;
}

/** Stage outside discovery, recheck targets, and preserve recovery data if rollback itself fails. */
export async function installSkills(
  source: string,
  bundle: SkillBundle,
  root: string,
  selected: SkillEntry[],
  force = false,
): Promise<InstallResult[]> {
  await requireRealDirectories(root);
  await mkdir(root, { recursive: true });
  const lockPath = join(root, '.tensnap-install.lock');
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new CliInputError(
        `Another skill install holds ${lockPath}. If it was interrupted, remove that lock and retry.`,
      );
    throw error;
  }
  const staged: { temporary: string; result: InstallResult; committed: boolean }[] = [];
  let failure: unknown;
  let results: InstallResult[] = [];
  let keepLock = false;
  const cleanupErrors: string[] = [];
  try {
    await lock.writeFile(
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        version: bundle.version,
        skills: selected.map(({ name }) => name),
      }) + '\n',
    );
    const plans: { skill: SkillEntry; state: TargetState; result: InstallResult }[] = [];
    for (const skill of selected) {
      const path = join(root, skill.name);
      const state = await inspectTarget(path, skill.name);
      const clean = !!state.receipt && !!state.tree && matches(state.tree, state.receipt);
      if (state.info && !clean && !force)
        throw new CliInputError(
          `Skill conflict at ${path}: unmanaged content or local modifications. Preserved. Use --force to replace it with a backup.`,
        );
      const unchanged =
        clean && state.receipt!.version === bundle.version && matches(state.tree!, skill);
      const result: InstallResult = {
        name: skill.name,
        path,
        status: unchanged
          ? 'unchanged'
          : state.info
            ? clean
              ? 'upgraded'
              : 'replaced'
            : 'installed',
        ...(state.receipt ? { previousVersion: state.receipt.version } : {}),
      };
      plans.push({ skill, state, result });
    }
    for (const { skill, state, result } of plans) {
      if (result.status === 'unchanged') continue;
      const temporary = await mkdtemp(join(dirname(root), '.tensnap-stage-'));
      staged.push({ temporary, result, committed: false });
      for (const path of Object.keys(skill.files)) {
        const output = join(temporary, path);
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, await readFile(join(source, skill.name, path)), { flag: 'wx' });
        await chmod(output, skill.executables?.includes(path) ? 0o755 : 0o644);
      }
      const receipt: Receipt = {
        schemaVersion: 1,
        package: PACKAGE,
        version: bundle.version,
        name: skill.name,
        files: skill.files,
        executables: skill.executables ?? [],
      };
      await writeFile(join(temporary, RECEIPT), JSON.stringify(receipt, null, 2) + '\n', {
        flag: 'wx',
      });
      if (!matches(await readSkillTree(temporary), skill))
        throw new CliInputError(
          `Bundled resources changed while staging ${skill.name}. Reinstall @tensnap/agent and retry.`,
        );
      if (state.info) {
        const backups = join(dirname(root), '.tensnap-skill-backups');
        await requireRealDirectories(backups, dirname(backups));
        await mkdir(backups, { recursive: true });
      }
    }
    // Check every target before the first commit, then each target again at its own commit.
    const checkTarget = async (name: string, path: string) => {
      const plan = plans.find(({ skill }) => skill.name === name)!;
      if (!unchangedTarget(plan.state, await inspectTarget(path, name)))
        throw new CliInputError(
          `Skill changed during installation: ${plan.result.path}. Preserved; retry the install.`,
        );
    };
    for (const { skill, result } of plans) await checkTarget(skill.name, result.path);
    for (const entry of staged) {
      await checkTarget(entry.result.name, entry.result.path);
      if (await stat(entry.result.path)) {
        const backup = join(
          dirname(root),
          '.tensnap-skill-backups',
          `${entry.result.name}-${randomUUID()}`,
        );
        await rename(entry.result.path, backup);
        entry.result.backupPath = backup;
        await checkTarget(entry.result.name, backup);
      }
      await rename(entry.temporary, entry.result.path);
      entry.committed = true;
    }
    results = plans.map(({ result }) => result);
  } catch (error) {
    failure = error;
    const recoveryErrors: string[] = [];
    for (const entry of [...staged].reverse()) {
      try {
        if (entry.committed) await rm(entry.result.path, { recursive: true, force: true });
        if (entry.result.backupPath) await rename(entry.result.backupPath, entry.result.path);
      } catch (rollbackError) {
        recoveryErrors.push(
          `${entry.result.path}: ${String(rollbackError)}; original backup: ${entry.result.backupPath ?? 'none (new install)'}`,
        );
      }
    }
    if (recoveryErrors.length) {
      keepLock = true;
      failure = new SkillPersistenceError(
        `Skill installation failed: ${String(error)}. Rollback incomplete: ${recoveryErrors.join('; ')}. Recover these paths before removing ${lockPath}.`,
      );
    }
  } finally {
    // Attempt every cleanup even when one fails; never mask the primary failure.
    for (const entry of staged) {
      try {
        await rm(entry.temporary, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(`${entry.temporary}: ${String(error)}`);
      }
    }
    try {
      await lock.close();
    } catch (error) {
      cleanupErrors.push(`${lockPath} (close): ${String(error)}`);
    }
    if (!keepLock) {
      try {
        await rm(lockPath);
      } catch (error) {
        cleanupErrors.push(`${lockPath}: ${String(error)}`);
      }
    }
  }
  if (cleanupErrors.length)
    throw new SkillPersistenceError(
      `${failure ? `Skill installation failed: ${String(failure)}` : 'Skills were installed, but cleanup failed'}. Remaining cleanup: ${cleanupErrors.join('; ')}.`,
    );
  if (failure) throw failure;
  return results;
}

export async function listSkills(options: SkillOptions): Promise<unknown> {
  const { root: source, bundle } = await loadSkillBundle();
  return {
    ...target(options),
    package: PACKAGE,
    version: bundle.version,
    source,
    skills: bundle.skills.map(({ name, description }) => ({ name, description })),
  };
}

export async function installBundledSkills(
  name: string | undefined,
  options: SkillOptions,
): Promise<unknown> {
  const { root: source, bundle } = await loadSkillBundle();
  const destination = target(options);
  const selected = options.all
    ? bundle.skills
    : bundle.skills.filter((skill) => skill.name === name);
  if (!selected.length) throw new CliInputError(`Unknown skill: ${name}. Use skills list.`);
  return {
    ...destination,
    package: PACKAGE,
    version: bundle.version,
    results: await installSkills(source, bundle, destination.root, selected, !!options.force),
  };
}
