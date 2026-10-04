import { mkdtemp, rm } from 'node:fs/promises';
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
      await writeRuntimeControl(paths, control);
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
