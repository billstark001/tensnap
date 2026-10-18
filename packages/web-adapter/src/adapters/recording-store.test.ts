// @vitest-environment node
import 'fake-indexeddb/auto';
import { it, expect, vi, afterEach } from 'vitest';
import {
  RecordingStoreReader,
  RecordingStoreWriter,
  RecordingPlayback,
} from '@tensnap/core/persistence';
import { Scenario } from '@tensnap/core/scenario';
import { IndexedDBRecordingStore } from './recording-store';

function locks() {
  const held = new Map<string, number>();
  vi.stubGlobal('navigator', {
    locks: {
      async request(
        name: string,
        options: { mode: string; ifAvailable?: boolean },
        callback: (lock: object | null) => Promise<void>,
      ) {
        if (options.ifAvailable && held.has(name)) return callback(null);
        held.set(name, (held.get(name) ?? 0) + 1);
        try {
          await callback({ name });
        } finally {
          const count = held.get(name)! - 1;
          if (count) held.set(name, count);
          else held.delete(name);
        }
      },
      async query() {
        return { held: [...held.keys()].map((name) => ({ name })) };
      },
    },
  });
}
afterEach(() => vi.unstubAllGlobals());
it('uses native compound indexes, transactional roots, tab ownership and independent generation readers', async () => {
  locks();
  const owner = crypto.randomUUID(),
    backend = new IndexedDBRecordingStore(owner, 'run');
  const writer = await RecordingStoreWriter.create(backend, {
    id: 'run',
    mode: 'rolling',
    maxFrames: 2,
  });
  await expect(
    RecordingStoreWriter.create(new IndexedDBRecordingStore(owner, 'run'), {
      id: 'other',
      mode: 'full-history',
    }),
  ).rejects.toThrow(/writer/);
  const scene = new Scenario();
  for (let frame = 0; frame < 4; frame++) {
    scene.apply({ type: 'metadata_update', payload: { time: frame % 2 } });
    await writer.append({
      scene: scene.dump(),
      timestamp: frame,
      location: {
        kind: 'recording',
        sourceId: 'run',
        revision: frame,
        frame,
        modelTime: frame % 2,
        actionRequestId: `r${frame % 2}`,
      },
    });
  }
  const reader = await RecordingStoreReader.open(new IndexedDBRecordingStore(owner, 'run'));
  expect(await reader.select({ time: 1, match: 'first' })).toMatchObject({ frame: 1 });
  expect(await reader.select({ time: 1, match: 'last' })).toMatchObject({ frame: 3 });
  expect(await reader.select({ time: 0.5, match: 'before' })).toMatchObject({ frame: 2 });
  expect(await reader.select({ requestId: 'r1', match: 'last' })).toMatchObject({ frame: 3 });
  const playback = new RecordingPlayback(reader);
  await playback.seek(1);
  expect(playback.scenario.time).toBe(1);
  await playback.step();
  expect(playback.frame).toBe(2);
  const controller = new AbortController();
  controller.abort();
  await expect(playback.seek(3, controller.signal)).rejects.toThrow(/cancelled/);
  expect(playback.frame).toBe(2);
  scene.apply({ type: 'metadata_update', payload: { time: 8 } });
  await writer.append({
    scene: scene.dump(),
    timestamp: 4,
    location: { kind: 'recording', sourceId: 'run', revision: 4, frame: 4, modelTime: 8 },
  });
  await writer.collect();
  expect((await reader.readFrame(1)).scene.metadata.time).toBe(1);
  await playback.close();
  await writer.collect();
  await writer.close();
  const latest = await RecordingStoreReader.open(backend);
  await expect(latest.readFrame(1)).rejects.toThrow(/range|index/);
  expect(await latest.recover()).toMatchObject({
    complete: true,
    committedRange: { from: 2, to: 4 },
  });
  await latest.close();
  await expect(
    RecordingStoreReader.open(new IndexedDBRecordingStore('different-owner', 'run')),
  ).rejects.toThrow(/Missing/);
});
