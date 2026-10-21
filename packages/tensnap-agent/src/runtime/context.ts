import type { RuntimeContextPaths } from './context-paths';
import { publishRecording } from './recording-catalog';
import { appendFile, mkdir, rm } from 'node:fs/promises';
import { encodeRecordingFile } from '@tensnap/core/persistence';
import type { Snapshot } from '@tensnap/core/snapshot';
import type { ScenarioSnapshot } from '@tensnap/core/scenario';
import type { RuntimeControlFile, RuntimeLogEntry } from '../types';
import { writeFileAtomically } from './atomic-file';

function snapshotReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return {
      __type: 'Uint8Array',
      base64: Buffer.from(value).toString('base64'),
    };
  }

  return value;
}

export async function ensureRuntimeContext(paths: RuntimeContextPaths): Promise<void> {
  await mkdir(paths.contextDir, { recursive: true });
  await mkdir(paths.assetsDir, { recursive: true });
  await mkdir(paths.capturesDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
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

/** Commit a self-contained recording only after encoding and resource validation succeed. */
export async function writeRunRecording(
  paths: RuntimeContextPaths,
  runId: string,
  snapshot: Snapshot,
  format: 'json' | 'msgpack' = 'json',
): Promise<string> {
  const data = encodeRecordingFile(snapshot, { format });
  return publishRecording(paths.recordingsDir, runId, format, data);
}
