import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RuntimeContextOptions, RuntimeControlFile } from '../types';

export interface RuntimeContextPaths {
  cwd: string;
  rootDir: string;
  contextsDir: string;
  contextName: string;
  contextDir: string;
  assetsDir: string;
  capturesDir: string;
  recordingsDir: string;
  logsDir: string;
  controlFile: string;
  logFile: string;
  pidFile: string;
  snapshotFile: string;
}

/** Normalize one directory name; empty names and path-navigation segments use default. */
export function sanitizeContextName(name?: string): string {
  const normalized = (name ?? 'default').trim().toLowerCase();
  const cleaned = normalized.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return !cleaned || cleaned === '.' || cleaned === '..' ? 'default' : cleaned;
}

export function resolveRuntimeContextPaths(
  options: RuntimeContextOptions = {},
): RuntimeContextPaths {
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
    recordingsDir: join(contextDir, 'recordings'),
    logsDir,
    controlFile: join(contextDir, 'runtime.json'),
    logFile: join(logsDir, 'runtime.log'),
    pidFile: join(contextDir, 'daemon.pid'),
    snapshotFile: join(contextDir, 'scene.snapshot.json'),
  };
}

export async function readRuntimeControl(
  paths: RuntimeContextPaths,
): Promise<RuntimeControlFile | null> {
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

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
