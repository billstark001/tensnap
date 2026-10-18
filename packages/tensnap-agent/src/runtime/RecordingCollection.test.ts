import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { it, expect } from 'vitest';
import { RendererSession, RecordingCollection, type CollectionConfig } from '@tensnap/core/runtime';
import { RecordingStoreWriter, RecordingStoreReader } from '@tensnap/core/persistence';
import type { ISimulatorTransport } from '@tensnap/core/transport';
import type { RendererToSimulatorMessage, ActionInvokePayload } from '@tensnap/protocol';
import { NodeRecordingStore } from './NodeRecordingStore';

const config: CollectionConfig = {
  version: 1,
  mode: 'full-history',
  maxStoredBytes: 8 * 1024 * 1024,
  liveHistory: { chartPoints: 2, logs: 2 },
  window: { before: 2, after: 3 },
  maxTriggers: 8,
  rules: [
    { id: 'threshold', kind: 'expression', source: 'monitors.health.count >= 2' },
    {
      id: 'changed',
      kind: 'change',
      query: { selector: { kind: 'monitor', id: 'health' }, fields: ['/value/count'] },
      cooldownFrames: 1,
    },
    { id: 'error', kind: 'action-error' },
  ],
  checkpoints: {
    policy: 'required',
    every: 2,
    onTrigger: true,
    maxCount: 10,
    maxBytes: 100,
    overflow: 'fail',
  },
};
function harness(failAt?: number) {
  const sent: RendererToSimulatorMessage[] = [];
  let time = 0;
  const session = new RendererSession({ run: { renderBarrier: { wait: () => {} } } });
  const transport: ISimulatorTransport = {
    connectionId: 'test',
    transportKind: 'test',
    encoding: 'json',
    connectionState: 'open',
    isConnected: true,
    connect: async () => {},
    disconnect() {},
    destroy() {},
    on() {},
    off() {},
    send(message) {
      sent.push(message);
      if (message.type === 'scene_capture')
        queueMicrotask(() =>
          session.handleIncoming({
            type: 'scene_capture_result',
            payload: {
              request_id: (message.payload as { request_id: string }).request_id,
              model_id: 'm',
              checkpoint: { encoding: 'raw', data: Uint8Array.of(time) },
            },
          }),
        );
      if (message.type === 'action_invoke')
        queueMicrotask(() => {
          const request = message.payload as ActionInvokePayload;
          time++;
          session.handleIncoming({
            type: 'monitor_update',
            payload: { id: 'health', value: { count: time } },
          });
          session.handleIncoming({ type: 'metadata_update', payload: { time } });
          session.handleIncoming({
            type: 'chart_update',
            payload: { updates: [{ id: 'population', time, value: time * 10 }] },
          });
          session.handleIncoming({
            type: 'action_result',
            payload: {
              id: request.id,
              request_id: request.request_id,
              ...(time === failAt
                ? { error: { code: 'fixture_failure', message: 'fixture failure' } }
                : {}),
            },
          });
        });
    },
  };
  session.attachTransport(transport);
  session.handleIncoming({
    type: 'simulator_info',
    payload: {
      protocol_version: '0.3',
      binding: { name: 'fixture', version: '0.3.0' },
      model: { id: 'm' },
      instance_id: 'i',
      capabilities: ['scene.restore.checkpoint'],
    },
  });
  session.scenario.apply({ type: 'monitor_create', payload: { id: 'health', label: 'Health' } });
  session.scenario.apply({
    type: 'monitor_update',
    payload: { id: 'health', value: { count: 0 } },
  });
  session.scenario.apply({
    type: 'chart_create',
    payload: { id: 'population', label: 'Population' },
  });
  return { session, sent };
}
it('collects trigger windows and scheduled aligned checkpoints while bounding live charts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tensnap-collection-'));
  const backend = new NodeRecordingStore(directory);
  const { session, sent } = harness();
  try {
    const writer = await RecordingStoreWriter.create(backend, {
      id: 'collection',
      ...config,
      modelIdentity: { model_id: 'm' },
    });
    const collection = await RecordingCollection.start(session, writer, config);
    const run = session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 5 });
    await session.run.waitForSettled(run.id);
    await collection.close();
    expect(sent.filter((m) => m.type === 'action_invoke')).toHaveLength(5);
    expect(collection.status.error).toBeUndefined();
    expect(collection.progress).not.toHaveProperty('windows');
    expect(collection.progress.deduplication.cooldown).toBe(2);
    expect(session.scenario.charts.getGroup('population')!.data).toHaveLength(2);
    const reader = await RecordingStoreReader.open(backend);
    expect((await reader.readFrame(5)).scene.charts[0].data).toHaveLength(5);
    expect((await reader.readFrame(2)).checkpoint).toMatchObject({ data: Uint8Array.of(2) });
    const summary = (await reader.summary()) as {
      windows: Array<{ ruleId: string; state: string; actual: object }>;
    };
    expect(summary.windows.find((w) => w.ruleId === 'threshold')).toMatchObject({
      state: 'complete',
      actual: { from: 0, to: 5 },
    });
    expect(await reader.recover()).toMatchObject({ complete: true });
    await reader.close();
  } finally {
    backend.close();
    session.run.reset();
    await rm(directory, { recursive: true, force: true });
  }
});
it('preserves action failure and partial post-windows without dispatching replacement actions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tensnap-error-window-'));
  const backend = new NodeRecordingStore(directory);
  const { session, sent } = harness(2);
  try {
    const writer = await RecordingStoreWriter.create(backend, {
      id: 'failure',
      ...config,
      modelIdentity: { model_id: 'm' },
    });
    const collection = await RecordingCollection.start(session, writer, config);
    const run = session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 5 });
    expect(await session.run.waitForSettled(run.id)).toMatchObject({
      failedActions: 1,
      completedActions: 2,
      primaryFailure: 'action-error',
    });
    await collection.close();
    expect(sent.filter((m) => m.type === 'action_invoke')).toHaveLength(2);
    expect(collection.status.windows.find((w) => w.ruleId === 'error')).toMatchObject({
      frame: 2,
      state: 'partial',
      gaps: [{ from: 3, to: 5, reason: 'Run ended before post-window completed.' }],
    });
  } finally {
    backend.close();
    session.run.reset();
    await rm(directory, { recursive: true, force: true });
  }
});

it.each(['truncate', 'stop', 'fail'] as const)(
  'honors %s checkpoint overflow at the actual sampling boundary',
  async (overflow) => {
    const directory = await mkdtemp(join(tmpdir(), 'tensnap-checkpoint-budget-'));
    const backend = new NodeRecordingStore(directory);
    const { session, sent } = harness();
    const limited: CollectionConfig = {
      ...config,
      rules: [],
      checkpoints: { ...config.checkpoints, every: 1, maxBytes: 0, overflow },
    };
    try {
      const writer = await RecordingStoreWriter.create(backend, { id: 'budget', ...limited });
      if (overflow === 'fail' || overflow === 'stop') {
        await expect(RecordingCollection.start(session, writer, limited)).rejects.toThrow(/budget/);
        expect(sent.filter((m) => m.type === 'action_invoke')).toHaveLength(0);
      } else {
        const collection = await RecordingCollection.start(session, writer, limited);
        const run = session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 3 });
        await session.run.waitForSettled(run.id);
        await collection.close();
        expect(collection.status.checkpointTruncated).toBe(true);
        expect(sent.filter((m) => m.type === 'action_invoke')).toHaveLength(3);
      }
    } finally {
      backend.close();
      session.run.reset();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it('samples checkpoints without repeated stop hooks and labels the one real lifecycle boundary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tensnap-lifecycle-'));
  const backend = new NodeRecordingStore(directory);
  const { session, sent } = harness();
  session.scenario.apply({ type: 'action_create', payload: { id: 'stop', label: 'Stop' } });
  try {
    const writer = await RecordingStoreWriter.create(backend, {
      id: 'lifecycle',
      ...config,
      modelIdentity: { model_id: 'm' },
    });
    const collection = await RecordingCollection.start(session, writer, config);
    const run = session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 3 });
    await session.run.waitForSettled(run.id);
    await collection.close();
    expect(
      sent.filter(
        (m) => m.type === 'action_invoke' && (m.payload as ActionInvokePayload).id === 'step',
      ),
    ).toHaveLength(3);
    expect(
      sent.filter(
        (m) => m.type === 'action_invoke' && (m.payload as ActionInvokePayload).id === 'stop',
      ),
    ).toHaveLength(1);
    expect(collection.status.error).toBeUndefined();
    const reader = await RecordingStoreReader.open(backend);
    expect((await reader.readFrame(4)).source.actionRequestId).toBeDefined();
    expect(reader.root.lastFrame).toBe(4);
    await reader.close();
  } finally {
    backend.close();
    session.run.reset();
    await rm(directory, { recursive: true, force: true });
  }
});

it('fails explicitly on autonomous updates while a collection boundary is held', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tensnap-autonomous-'));
  const backend = new NodeRecordingStore(directory);
  const { session } = harness();
  try {
    const writer = await RecordingStoreWriter.create(backend, {
      id: 'autonomous',
      ...config,
      modelIdentity: { model_id: 'm' },
    });
    const collection = await RecordingCollection.start(session, writer, config);
    session.handleIncoming({ type: 'metadata_update', payload: { time: 1 } });
    session.handleIncoming({ type: 'metadata_update', payload: { time: 2 } });
    await expect(collection.close()).rejects.toThrow(/Autonomous/);
    expect(collection.status).toMatchObject({
      state: 'failed',
      committedFrame: 0,
      observedFrame: 1,
    });
  } finally {
    backend.close();
    session.run.reset();
    await rm(directory, { recursive: true, force: true });
  }
});

it('ignores duplicate action results during checkpoint holds without invalidating the captured scene', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tensnap-duplicate-result-'));
  const backend = new NodeRecordingStore(directory);
  const { session, sent } = harness();
  session.addEventListener('outbound', (event) => {
    const message = (event as CustomEvent<{ message: RendererToSimulatorMessage }>).detail.message;
    if (message.type !== 'scene_capture') return;
    const last = sent.filter((m) => m.type === 'action_invoke').at(-1);
    if (last) {
      const payload = last.payload as ActionInvokePayload;
      session.handleIncoming({
        type: 'action_result',
        payload: { id: payload.id, request_id: payload.request_id },
      });
    }
  });
  try {
    const writer = await RecordingStoreWriter.create(backend, {
      id: 'duplicates',
      ...config,
      modelIdentity: { model_id: 'm' },
    });
    const collection = await RecordingCollection.start(session, writer, config);
    const run = session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 3 });
    expect((await session.run.waitForSettled(run.id)).completedActions).toBe(3);
    await collection.close();
    expect(collection.status).toMatchObject({
      state: 'complete',
      observedFrame: 3,
      committedFrame: 3,
    });
  } finally {
    backend.close();
    session.run.reset();
    await rm(directory, { recursive: true, force: true });
  }
});

it('reports final-manifest failure as failed collection instead of completed evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tensnap-final-root-'));
  let fail = false;
  const backend = new NodeRecordingStore(directory, (stage) => {
    if (fail && stage === 'root') throw new Error('Final root failure');
  });
  const { session } = harness();
  try {
    const writer = await RecordingStoreWriter.create(backend, {
      id: 'final-root',
      ...config,
      modelIdentity: { model_id: 'm' },
    });
    const collection = await RecordingCollection.start(session, writer, config);
    fail = true;
    await expect(collection.close()).rejects.toThrow('Final root failure');
    expect(collection.progress).toMatchObject({
      state: 'failed',
      error: 'Final root failure',
      committedFrame: 0,
    });
  } finally {
    backend.close();
    session.run.reset();
    await rm(directory, { recursive: true, force: true });
  }
});

it('reuses checkpoint retention budgets after rolling boundaries are evicted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tensnap-rolling-checkpoints-'));
  const backend = new NodeRecordingStore(directory);
  const { session, sent } = harness();
  const rolling: CollectionConfig = {
    ...config,
    mode: 'rolling',
    maxFrames: 2,
    rules: [],
    checkpoints: {
      ...config.checkpoints,
      every: 1,
      onTrigger: false,
      maxCount: 3,
      maxBytes: 3,
      overflow: 'fail',
    },
  };
  try {
    const writer = await RecordingStoreWriter.create(backend, {
      id: 'rolling-checkpoints',
      ...rolling,
      modelIdentity: { model_id: 'm' },
    });
    const collection = await RecordingCollection.start(session, writer, rolling);
    const run = session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 6 });
    await session.run.waitForSettled(run.id);
    await collection.close();
    expect(collection.status).toMatchObject({ state: 'complete', checkpointTruncated: false });
    expect(sent.filter((m) => m.type === 'scene_capture')).toHaveLength(7);
    const reader = await RecordingStoreReader.open(backend);
    expect(reader.root).toMatchObject({ firstFrame: 4, lastFrame: 6, count: 3 });
    expect((await reader.readFrame(6)).checkpoint?.data).toEqual(Uint8Array.of(6));
    await reader.close();
  } finally {
    backend.close();
    session.run.reset();
    await rm(directory, { recursive: true, force: true });
  }
});
