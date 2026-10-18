import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RuntimeControlFile } from '../types';
import {
  readRuntimeControl,
  resolveRuntimeContextPaths,
  sanitizeContextName,
  writeRuntimeControl,
} from './context';

describe('sanitizeContextName', () => {
  it('normalizes unsafe characters', () => {
    expect(sanitizeContextName(' Agent Session / Demo ')).toBe('agent-session-demo');
  });

  it('falls back to default for empty names', () => {
    expect(sanitizeContextName('   ')).toBe('default');
  });

  it.each(['.', '..', ' .. ', '--..--', '/..', '../'])(
    'keeps %j inside the contexts directory',
    (name) => {
      const paths = resolveRuntimeContextPaths({ rootDir: '/tmp/tensnap', contextName: name });
      expect(paths.contextName).toBe('default');
      expect(paths.contextDir).toBe(join(paths.contextsDir, 'default'));
    },
  );
});

describe('resolveRuntimeContextPaths', () => {
  it('uses .tensnap under cwd by default', () => {
    const paths = resolveRuntimeContextPaths({
      cwd: '/tmp/tensnap-demo',
      contextName: 'researcher-1',
    });
    expect(paths.rootDir).toBe('/tmp/tensnap-demo/.tensnap');
    expect(paths.contextDir).toBe('/tmp/tensnap-demo/.tensnap/contexts/researcher-1');
    expect(paths.snapshotFile).toBe(
      '/tmp/tensnap-demo/.tensnap/contexts/researcher-1/scene.snapshot.json',
    );
  });
});

describe('runtime control persistence', () => {
  it('keeps the control file readable while status is updated', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-context-'));
    const paths = resolveRuntimeContextPaths({ rootDir, contextName: 'concurrent-status' });
    const now = new Date().toISOString();
    const control: RuntimeControlFile = {
      version: 1,
      contextName: paths.contextName,
      contextDir: paths.contextDir,
      createdAt: now,
      updatedAt: now,
      host: '127.0.0.1',
      controlPort: 8765,
      pid: process.pid,
      phase: 'ready',
      encoding: 'json',
      clientMessageValidation: 'error',
      serverMessageValidation: 'error',
      maxRunStepsPolicy: 100,
      render: { trigger: 'manual', backgroundColor: '#000000' },
      painters: [],
      sceneRevision: 0,
      sceneDirty: false,
    };
    try {
      const firstWrite = writeRuntimeControl(paths, control);
      control.pid = null;
      control.render.trigger = 'action-result';
      await firstWrite;
      expect(await readRuntimeControl(paths)).toMatchObject({
        pid: process.pid,
        render: { trigger: 'manual' },
      });
      expect(await readFile(paths.pidFile, 'utf8')).toBe(`${process.pid}\n`);
      await Promise.all([
        (async () => {
          for (let index = 1; index <= 100; index += 1) {
            await writeRuntimeControl(paths, {
              ...control,
              sceneRevision: index,
              painters: Array(100).fill(`painter-${index}`),
            });
          }
        })(),
        (async () => {
          for (let index = 0; index < 500; index += 1) {
            const persisted = await readRuntimeControl(paths);
            expect(persisted?.contextName).toBe('concurrent-status');
            expect(persisted?.sceneRevision).toBeGreaterThanOrEqual(0);
          }
        })(),
      ]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

it('captures persistence inputs before asynchronous filesystem preparation', async () => {
  const { Scenario } = await import('@tensnap/core/scenario');
  const { createSingleSnapshot, decodeSnapshotArchive, materializeSnapshot } =
    await import('@tensnap/core/snapshot');
  const { appendRuntimeLog, writeSceneSnapshot, writeRunRecording } = await import('./context');
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-write-ownership-'));
  const paths = resolveRuntimeContextPaths({ rootDir });
  const scene = new Scenario().dump();
  scene.metadata.time = 1;
  const recording = createSingleSnapshot(scene);
  const logEntry = {
    at: 'test',
    level: 'info' as const,
    source: 'test',
    message: 'test',
    data: { time: 1 },
  };
  try {
    const sceneWrite = writeSceneSnapshot(paths, scene);
    const recordingWrite = writeRunRecording(paths, 'run', recording);
    const logWrite = appendRuntimeLog(paths, logEntry);
    scene.metadata.time = 99;
    recording.initial.scenario.metadata.time = 99;
    logEntry.data.time = 99;
    await sceneWrite;
    const archivePath = await recordingWrite;
    await logWrite;
    expect(JSON.parse(await readFile(paths.snapshotFile, 'utf8')).metadata.time).toBe(1);
    const archive = JSON.parse(await readFile(archivePath, 'utf8'));
    expect(materializeSnapshot(decodeSnapshotArchive(archive)).metadata.time).toBe(1);
    expect(JSON.parse(await readFile(paths.logFile, 'utf8')).data.time).toBe(1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
