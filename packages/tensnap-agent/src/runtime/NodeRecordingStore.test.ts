import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, it, expect } from 'vitest';
import { RecordingStoreReader, RecordingStoreWriter } from '@tensnap/core/persistence';
import { Scenario } from '@tensnap/core/scenario';
import { NodeRecordingStore } from './NodeRecordingStore';
const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'tensnap-store-'));
  directories.push(path);
  return path;
}
function input(scenario: Scenario, frame: number, time = frame) {
  const message = { type: 'metadata_update' as const, payload: { time } };
  scenario.apply(message);
  return {
    scene: scenario.dump(),
    timestamp: frame,
    location: {
      kind: 'recording' as const,
      sourceId: 's',
      revision: frame,
      frame,
      modelTime: time,
      actionRequestId: `r${frame % 2}`,
    },
    frame: {
      index: frame,
      timestamp: frame,
      kind: 'action' as const,
      messages: [message],
      controls: [],
    },
  };
}
it('reads fixed generations and locates nonmonotonic time/request boundaries through bounded pages', async () => {
  const backend = new NodeRecordingStore(await directory());
  const writer = await RecordingStoreWriter.create(backend, { id: 's', mode: 'full-history' });
  const scenario = new Scenario();
  for (let i = 0; i < 140; i++) await writer.append(input(scenario, i, i % 3));
  const pinned = await RecordingStoreReader.open(backend, { cacheBytes: 4096 });
  await writer.append(input(scenario, 140, -5));
  expect(pinned.root.lastFrame).toBe(139);
  expect(await pinned.select({ time: 1, match: 'last' })).toMatchObject({ frame: 139 });
  expect(await pinned.select({ time: 1, match: 'first' })).toMatchObject({ frame: 1 });
  expect(await pinned.select({ requestId: 'r0', match: 'last' })).toMatchObject({ frame: 138 });
  expect(await pinned.select({ time: 0.5, match: 'before' })).toMatchObject({
    frame: 138,
    modelTime: 0,
  });
  expect(await pinned.select({ time: 0.5, match: 'after' })).toMatchObject({
    frame: 1,
    modelTime: 1,
  });
  expect(
    (await pinned.query(139, { selector: { kind: 'metadata' }, fields: ['/time'] })).items[0]
      .fields![0].value,
  ).toBe(1);
  expect(pinned.metrics.peakCacheBytes).toBeLessThanOrEqual(4096);
  await writer.collect();
  expect((await pinned.readFrame(139)).scene.metadata.time).toBe(1);
  await writer.close();
  await pinned.close();
  const latest = await RecordingStoreReader.open(backend);
  expect(await latest.recover()).toMatchObject({
    complete: true,
    committedRange: { from: 0, to: 140 },
  });
  await latest.close();
});
it('keeps the committed prefix when atomic root publication fails and reports failed collection', async () => {
  let fail = false;
  const backend = new NodeRecordingStore(await directory(), (stage) => {
    if (fail && stage === 'root') {
      fail = false;
      throw new Error('injected rename interruption');
    }
  });
  const writer = await RecordingStoreWriter.create(backend, { id: 'fault', mode: 'full-history' });
  const scenario = new Scenario();
  await writer.append(input(scenario, 0));
  fail = true;
  await expect(writer.append(input(scenario, 1))).rejects.toThrow(/interruption/);
  const interrupted = await RecordingStoreReader.open(backend);
  expect(await interrupted.recover()).toMatchObject({
    status: 'interrupted',
    committedRange: { from: 0, to: 0 },
    complete: false,
  });
  await interrupted.close();
  await expect(writer.close()).rejects.toThrow(/interruption/);
  const recovered = await RecordingStoreReader.open(backend);
  expect(await recovered.recover()).toMatchObject({
    status: 'failed',
    committedRange: { from: 0, to: 0 },
    uncommittedRange: { from: 1, to: 1 },
  });
  await recovered.close();
});
it('owns queued inputs, bounds slow-writer backlog, and rejects concurrent writers', async () => {
  let unblock!: () => void;
  let blocked = false;
  const gate = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const backend = new NodeRecordingStore(await directory(), async () => {
    if (blocked) await gate;
  });
  const writer = await RecordingStoreWriter.create(backend, {
    id: 'slow',
    mode: 'full-history',
    maxPendingSegments: 1,
  });
  await expect(
    RecordingStoreWriter.create(backend, { id: 'other', mode: 'full-history' }),
  ).rejects.toThrow(/writer/);
  const scenario = new Scenario();
  await writer.append(input(scenario, 0));
  blocked = true;
  const owned = input(scenario, 1);
  const work = writer.append(owned);
  owned.scene.metadata.time = 999;
  await expect(writer.append(input(scenario, 2))).rejects.toThrow(/budget/);
  unblock();
  await work.catch(() => {});
  expect(writer.status.pendingBytes).toBe(0);
  await expect(writer.close()).rejects.toThrow(/budget/);
});
it('detects committed object corruption without jumping across the damaged boundary', async () => {
  const path = await directory(),
    backend = new NodeRecordingStore(path);
  const writer = await RecordingStoreWriter.create(backend, {
    id: 'corrupt',
    mode: 'full-history',
  });
  const scenario = new Scenario();
  await writer.append(input(scenario, 0));
  await writer.append(input(scenario, 1));
  await writer.close();
  const reader = await RecordingStoreReader.open(backend);
  const root = reader.root;
  await reader.close();
  const db = new DatabaseSync(join(path, 'objects.sqlite'));
  const row = db
    .prepare('SELECT bytes FROM objects WHERE key=?')
    .get(`objects/${root.streamStart.hash}`)!;
  const bytes = Uint8Array.from(row.bytes as Uint8Array);
  bytes[0] ^= 255;
  db.prepare('UPDATE objects SET bytes=? WHERE key=?').run(
    bytes,
    `objects/${root.streamStart.hash}`,
  );
  db.close();
  const damaged = await RecordingStoreReader.open(backend);
  expect(await damaged.recover()).toMatchObject({ complete: false, recoverablePrefix: undefined });
  expect((await damaged.recover()).errors.length).toBeGreaterThan(0);
  await damaged.close();
});

it('rebuilds a missing derived index from immutable descriptors without changing history', async () => {
  const path = await directory(),
    backend = new NodeRecordingStore(path);
  const writer = await RecordingStoreWriter.create(backend, {
    id: 'rebuild',
    mode: 'full-history',
  });
  const scenario = new Scenario();
  for (let i = 0; i < 4; i++) await writer.append(input(scenario, i, [3, 1, 3, -1][i]));
  await writer.close();
  const db = new DatabaseSync(join(path, 'index.sqlite'));
  db.exec('DELETE FROM boundaries WHERE frame = 0');
  db.close();
  const damaged = await RecordingStoreReader.open(backend);
  expect(await damaged.recover()).toMatchObject({ complete: false, recoverablePrefix: undefined });
  await damaged.close();
  const { rebuildRecordingStoreIndex } = await import('@tensnap/core/persistence');
  await rebuildRecordingStoreIndex(backend);
  const reader = await RecordingStoreReader.open(backend);
  expect(await reader.recover()).toMatchObject({
    complete: true,
    committedRange: { from: 0, to: 3 },
  });
  expect(await reader.select({ time: 3, match: 'last' })).toMatchObject({ frame: 2 });
  await reader.close();
  backend.close();
});

it('exports a nonzero origin with full chart history and reads ranges without rescanning each prefix', async () => {
  const backend = new NodeRecordingStore(await directory());
  const writer = await RecordingStoreWriter.create(backend, { id: 'source', mode: 'full-history' });
  const scenario = new Scenario();
  scenario.apply({ type: 'chart_create', payload: { id: 'c', label: 'C' } });
  for (let i = 0; i < 12; i++) {
    const update = {
      type: 'chart_update' as const,
      payload: { updates: [{ id: 'c', time: i, value: i }] },
    };
    scenario.apply(update);
    const boundary = input(scenario, i);
    boundary.frame.messages.push(update as never);
    await writer.append(boundary);
  }
  await writer.close();
  const reader = await RecordingStoreReader.open(backend, { cacheBytes: 128 });
  const target = new NodeRecordingStore(await directory());
  const output = await RecordingStoreWriter.create(target, { id: 'range', mode: 'full-history' });
  await reader.exportRange(output, 5, 11);
  await output.close();
  const copy = await RecordingStoreReader.open(target, { cacheBytes: 128 });
  expect((await copy.readFrame(11)).scene.charts[0].data).toHaveLength(12);
  const before = copy.metrics.objectsRead;
  for await (const frame of copy.range(5, 11))
    expect(frame.scene.charts[0].data.length).toBe(frame.source.frame! + 1);
  expect(copy.metrics.objectsRead - before).toBeLessThan(40);
  await copy.close();
  await reader.close();
  backend.close();
  target.close();
});

it.each(['objects/', 'segments/', 'index', 'root'])(
  'keeps a readable committed prefix on a %s write failure',
  async (stage) => {
    let fail = false;
    const backend = new NodeRecordingStore(await directory(), (_stage, key) => {
      if (fail && key.startsWith(stage)) {
        fail = false;
        throw new Error('write fault');
      }
    });
    const writer = await RecordingStoreWriter.create(backend, {
      id: 'fault',
      mode: 'full-history',
    });
    const scenario = new Scenario();
    await writer.append(input(scenario, 0));
    fail = true;
    await expect(writer.append(input(scenario, 1))).rejects.toThrow('write fault');
    const reader = await RecordingStoreReader.open(backend);
    expect(await reader.recover()).toMatchObject({
      complete: false,
      recoverablePrefix: { from: 0, to: 0 },
    });
    await reader.close();
    await writer.close().catch(() => {});
    backend.close();
  },
);
