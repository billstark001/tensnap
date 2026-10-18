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

it.each([1, 2, 3, 4, 5, 6])(
  'survives process termination at immutable write/root stage %i',
  async (stage) => {
    const { spawn } = await import('node:child_process');
    const { once } = await import('node:events');
    const { createRequire } = await import('node:module');
    const path = await directory();
    const child = spawn(
      process.execPath,
      [
        '--import',
        createRequire(import.meta.url).resolve('tsx'),
        new URL('./fixtures/store-interruption.ts', import.meta.url).pathname,
        path,
        String(stage),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    try {
      await new Promise<void>((resolve, reject) => {
        let output = '';
        const timer = setTimeout(
          () => reject(new Error(`Child did not reach fault stage: ${stderr}`)),
          8000,
        );
        child.stdout.on('data', (chunk) => {
          output += chunk;
          if (output.includes('interrupt-here')) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once('exit', () => {
          clearTimeout(timer);
          reject(new Error(`Unexpected fixture exit: ${stderr}`));
        });
      });
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
      const backend = new NodeRecordingStore(path);
      const reader = await RecordingStoreReader.open(backend);
      expect(await reader.recover()).toMatchObject({
        status: 'interrupted',
        complete: false,
        recoverablePrefix: { from: 0, to: 0 },
      });
      expect((await reader.readFrame(0)).scene.assets).toEqual([]);
      await reader.close();
      backend.close();
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  },
  12000,
);

it('preserves normalized log timestamps when raw simulator events omit their clock', async () => {
  const backend = new NodeRecordingStore(await directory());
  const writer = await RecordingStoreWriter.create(backend, { id: 'logs', mode: 'full-history' });
  const scenario = new Scenario();
  await writer.append(input(scenario, 0));
  const messages = [
    { type: 'log' as const, payload: { message: 'hello' } },
    { type: 'error' as const, payload: { code: 'probe', message: 'failure' } },
  ];
  for (const message of messages) scenario.apply(message);
  const boundary = input(scenario, 1);
  boundary.frame.messages.push(...(messages as never[]));
  const expected = structuredClone([...scenario.logs]);
  await writer.append(boundary);
  await writer.close();
  const reader = await RecordingStoreReader.open(backend);
  expect((await reader.readFrame(1)).scene.logs).toEqual(expected);
  await reader.close();
  backend.close();
});

it('bounds encoded payload storage before writing a new object and counts metadata separately from heap', async () => {
  const backend = new NodeRecordingStore(await directory());
  const scenario = new Scenario();
  const writer = await RecordingStoreWriter.create(backend, {
    id: 'budget',
    mode: 'full-history',
    maxStoredBytes: 12000,
  });
  await writer.append(input(scenario, 0));
  let failed = false;
  for (let frame = 1; frame < 40; frame++) {
    try {
      await writer.append(input(scenario, frame));
    } catch (error) {
      expect(String(error)).toMatch(/budget/);
      failed = true;
      break;
    }
  }
  expect(failed).toBe(true);
  let bytes = 0;
  for await (const key of backend.list())
    if (key !== 'writer') bytes += (await backend.read(key)).length;
  expect(bytes).toBeLessThanOrEqual(12000);
  await writer.close().catch(() => {});
  const reader = await RecordingStoreReader.open(backend);
  expect((await reader.recover()).complete).toBe(false);
  await reader.close();
  backend.close();
});

it('owns an admitted slow write even when its caller reuses the scene input', async () => {
  let unblock!: () => void;
  const gate = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  let blocked = false;
  const backend = new NodeRecordingStore(await directory(), async () => {
    if (blocked) await gate;
  });
  const writer = await RecordingStoreWriter.create(backend, { id: 'owned', mode: 'full-history' });
  const scenario = new Scenario();
  await writer.append(input(scenario, 0));
  blocked = true;
  const frame = input(scenario, 1),
    work = writer.append(frame);
  frame.scene.metadata.time = 999;
  unblock();
  await work;
  await writer.close();
  const reader = await RecordingStoreReader.open(backend);
  expect(
    (await reader.query(1, { selector: { kind: 'metadata' }, fields: ['/time'] })).items[0]
      .fields![0].value,
  ).toBe(1);
  await reader.close();
  backend.close();
});

it('rebuilds a lost index database and stops recovery at a missing committed middle segment', async () => {
  const path = await directory(),
    backend = new NodeRecordingStore(path);
  const writer = await RecordingStoreWriter.create(backend, {
    id: 'index-loss',
    mode: 'full-history',
  });
  const scenario = new Scenario();
  for (let i = 0; i < 3; i++) await writer.append(input(scenario, i));
  await writer.close();
  backend.close();
  for (const suffix of ['', '-wal', '-shm'])
    await rm(join(path, `index.sqlite${suffix}`), { force: true });
  const { rebuildRecordingStoreIndex } = await import('@tensnap/core/persistence');
  await rebuildRecordingStoreIndex(backend);
  let reader = await RecordingStoreReader.open(backend);
  expect((await reader.recover()).complete).toBe(true);
  await reader.close();
  const { decodeMessagePack } = await import('@tensnap/protocol');
  const descriptor = decodeMessagePack<{ ref: { hash: string } }>(
    await backend.read('segments/0000000000000001'),
  );
  await backend.remove(`objects/${descriptor.ref.hash}`);
  reader = await RecordingStoreReader.open(backend);
  expect(await reader.recover()).toMatchObject({
    complete: false,
    recoverablePrefix: { from: 0, to: 0 },
    errors: [{ frame: 1 }],
  });
  // The independent end-state remains usable; recovery never calls the damaged history complete.
  expect((await reader.readFrame(2)).scene.metadata.time).toBe(2);
  await reader.close();
  backend.close();
});

it('rejects an oversized atomic frame while preserving the previous prefix and observed failure position', async () => {
  const backend = new NodeRecordingStore(await directory());
  const writer = await RecordingStoreWriter.create(backend, {
    id: 'oversized',
    mode: 'full-history',
    maxSegmentBytes: 1024,
  });
  const scenario = new Scenario();
  await writer.append(input(scenario, 0));
  scenario.apply({ type: 'metadata_update', payload: { large: 'x'.repeat(2048) } });
  await expect(writer.append(input(scenario, 1))).rejects.toThrow(/Atomic frame/);
  await writer.close().catch(() => {});
  const reader = await RecordingStoreReader.open(backend);
  expect(await reader.recover()).toMatchObject({
    complete: false,
    committedRange: { from: 0, to: 0 },
    uncommittedRange: { from: 1, to: 1 },
  });
  await reader.close();
  backend.close();
});

it('atomically reclaims a dead writer lease under concurrent admission', async () => {
  const path = await directory(),
    a = new NodeRecordingStore(path),
    b = new NodeRecordingStore(path);
  const { encodeMessagePack } = await import('@tensnap/protocol');
  await a.put('writer', encodeMessagePack({ pid: 9999999, token: 'dead' }));
  const outcomes = await Promise.allSettled([a.acquireWriter(), b.acquireWriter()]);
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
  for (const outcome of outcomes) if (outcome.status === 'fulfilled') await outcome.value();
  a.close();
  b.close();
});

it('skips unchanged frame prefixes for complete history reads', async () => {
  const path = await directory(),
    backend = new NodeRecordingStore(path);
  const writer = await RecordingStoreWriter.create(backend, {
    id: 'streams',
    mode: 'full-history',
  });
  const scenario = new Scenario();
  for (let frame = 0; frame < 256; frame++) await writer.append(input(scenario, frame));
  await writer.close();
  const reader = await RecordingStoreReader.open(backend, { cacheBytes: 128 });
  expect((await reader.readFrame(255)).scene.metadata.time).toBe(255);
  expect(reader.metrics.objectsRead).toBeLessThanOrEqual(3);
  await reader.close();
  backend.close();
});

it('detects a hole in the derived stream index without silently returning incomplete chart history', async () => {
  const path = await directory(),
    backend = new NodeRecordingStore(path);
  const writer = await RecordingStoreWriter.create(backend, {
    id: 'stream-gap',
    mode: 'full-history',
  });
  const scenario = new Scenario();
  scenario.apply({ type: 'chart_create', payload: { id: 'c', label: 'C' } });
  for (let frame = 0; frame < 30; frame++) {
    const boundary = input(scenario, frame);
    if (frame === 10 || frame === 20) {
      const update = {
        type: 'chart_update' as const,
        payload: { updates: [{ id: 'c', time: frame, value: frame }] },
      };
      scenario.apply(update);
      boundary.scene = scenario.dump();
      boundary.frame.messages.push(update as never);
    }
    await writer.append(boundary);
  }
  await writer.close();
  const db = new DatabaseSync(join(path, 'index.sqlite'));
  db.exec('DELETE FROM streams WHERE frame = 10');
  db.close();
  const reader = await RecordingStoreReader.open(backend);
  await expect(reader.readFrame(29)).rejects.toThrow(/stream index.*gap/);
  expect(await reader.recover()).toMatchObject({
    complete: false,
    recoverablePrefix: { from: 0, to: 9 },
  });
  await reader.close();
  backend.close();
});
