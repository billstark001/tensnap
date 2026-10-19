import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { encodeRecordingFile } from '@tensnap/core/persistence';
import type { Snapshot } from '@tensnap/core/snapshot';
import type { ScenarioSnapshot } from '@tensnap/core/scenario';
import type { RuntimeContextOptions, RuntimeControlFile, RuntimeLogEntry } from '../types';
import { writeFileAtomically } from './atomic-file';

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

function snapshotReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return {
      __type: 'Uint8Array',
      base64: Buffer.from(value).toString('base64'),
    };
  }

  return value;
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

export async function ensureRuntimeContext(paths: RuntimeContextPaths): Promise<void> {
  await mkdir(paths.contextDir, { recursive: true });
  await mkdir(paths.assetsDir, { recursive: true });
  await mkdir(paths.capturesDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
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

export async function writeRuntimeControl(
  paths: RuntimeContextPaths,
  control: RuntimeControlFile,
): Promise<void> {
  // Encode before the first await so later caller mutations cannot change this write.
  const data = `${JSON.stringify(control, null, 2)}\n`;
  const pid = control.pid;
  await ensureRuntimeContext(paths);
  await writeFileAtomically(paths.controlFile, data);
  if (typeof pid === 'number' && pid > 0) {
    await writeFileAtomically(paths.pidFile, `${pid}\n`);
  } else {
    await rm(paths.pidFile, { force: true });
  }
}

export async function appendRuntimeLog(
  paths: RuntimeContextPaths,
  entry: RuntimeLogEntry,
): Promise<void> {
  const data = `${JSON.stringify(entry)}\n`;
  await ensureRuntimeContext(paths);
  await appendFile(paths.logFile, data, 'utf8');
}

export async function writeSceneSnapshot(
  paths: RuntimeContextPaths,
  snapshot: ScenarioSnapshot,
): Promise<void> {
  const data = `${JSON.stringify(snapshot, snapshotReplacer, 2)}\n`;
  await ensureRuntimeContext(paths);
  await writeFileAtomically(paths.snapshotFile, data);
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Commit a self-contained recording only after encoding and resource validation succeed. */
export async function writeRunRecording(
  paths: RuntimeContextPaths,
  runId: string,
  snapshot: Snapshot,
  format: 'json' | 'msgpack' = 'json',
): Promise<string> {
  const data = encodeRecordingFile(snapshot, { format });
  const output = join(
    paths.recordingsDir,
    `${encodeURIComponent(runId)}.tensnap-recording.${format}`,
  );
  await writeFileAtomically(output, data);
  return output;
}
