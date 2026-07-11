import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { ScenarioSnapshot } from '@tensnap/core/scenario';
import type { RuntimeContextOptions, RuntimeControlFile, RuntimeLogEntry } from '../types';

export interface RuntimeContextPaths {
  cwd: string;
  rootDir: string;
  contextsDir: string;
  contextName: string;
  contextDir: string;
  assetsDir: string;
  capturesDir: string;
  logsDir: string;
  controlFile: string;
  logFile: string;
  pidFile: string;
  snapshotFile: string;
}

function snapshotReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return {
      __type: 'Uint8Array',
      base64: Buffer.from(value).toString('base64'),
    };
  }

  return value;
}

export function sanitizeContextName(name?: string): string {
  const normalized = (name ?? 'default').trim().toLowerCase();
  const cleaned = normalized.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'default';
}

export function resolveRuntimeContextPaths(options: RuntimeContextOptions = {}): RuntimeContextPaths {
  const cwd = resolve(options.cwd ?? process.cwd());
  const rootDir = resolve(options.rootDir ?? join(cwd, '.tensnap'));
  const contextsDir = join(rootDir, 'contexts');
  const contextName = sanitizeContextName(options.contextName);
  const contextDir = join(contextsDir, contextName);
  const logsDir = join(contextDir, 'logs');

  return {
    cwd,
    rootDir,
    contextsDir,
    contextName,
    contextDir,
    assetsDir: join(contextDir, 'assets'),
    capturesDir: join(contextDir, 'captures'),
    logsDir,
    controlFile: join(contextDir, 'runtime.json'),
    logFile: join(logsDir, 'runtime.log'),
    pidFile: join(contextDir, 'daemon.pid'),
    snapshotFile: join(contextDir, 'scene.snapshot.json'),
  };
}

export async function ensureRuntimeContext(paths: RuntimeContextPaths): Promise<void> {
  await mkdir(paths.contextDir, { recursive: true });
  await mkdir(paths.assetsDir, { recursive: true });
  await mkdir(paths.capturesDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
}

export async function readRuntimeControl(paths: RuntimeContextPaths): Promise<RuntimeControlFile | null> {
  try {
    const raw = await readFile(paths.controlFile, 'utf8');
    return JSON.parse(raw) as RuntimeControlFile;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function writeRuntimeControl(paths: RuntimeContextPaths, control: RuntimeControlFile): Promise<void> {
  await ensureRuntimeContext(paths);
  await writeFile(paths.controlFile, `${JSON.stringify(control, null, 2)}\n`, 'utf8');

  if (typeof control.pid === 'number' && control.pid > 0) {
    await writeFile(paths.pidFile, `${control.pid}\n`, 'utf8');
  } else {
    await rm(paths.pidFile, { force: true });
  }
}

export async function appendRuntimeLog(paths: RuntimeContextPaths, entry: RuntimeLogEntry): Promise<void> {
  await ensureRuntimeContext(paths);
  await appendFile(paths.logFile, `${JSON.stringify(entry)}\n`, 'utf8');
}

export async function writeSceneSnapshot(paths: RuntimeContextPaths, snapshot: ScenarioSnapshot): Promise<void> {
  await ensureRuntimeContext(paths);
  const temporaryFile = `${paths.snapshotFile}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryFile, `${JSON.stringify(snapshot, snapshotReplacer, 2)}\n`, 'utf8');
    await rename(temporaryFile, paths.snapshotFile);
  } finally {
    await rm(temporaryFile, { force: true });
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
