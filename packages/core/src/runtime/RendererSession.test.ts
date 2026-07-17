import type { ISimulatorTransport, TransportConnectionState, TransportEventHandler, TransportEventMap } from '../transport';
import type { ProtocolEncoding, RendererToSimulatorMessage } from '@tensnap/protocol';
import { describe, expect, it, vi } from 'vitest';
import { RendererSession, type RendererSessionCommitDetail } from './RendererSession';
import { materializeSnapshot, type Snapshot } from '../snapshot';

function createTransport(sent: RendererToSimulatorMessage[]): ISimulatorTransport {
  return {
    connectionId: 'test://renderer-session',
    transportKind: 'test',
    encoding: 'json' as ProtocolEncoding,
    connectionState: 'open' as TransportConnectionState,
    isConnected: true,
    connect: async () => {},
    disconnect: () => {},
    destroy: () => {},
    on: <K extends keyof TransportEventMap>(_type: K, _handler: TransportEventHandler<TransportEventMap[K]>) => {},
    off: <K extends keyof TransportEventMap>(_type: K, _handler?: TransportEventHandler<TransportEventMap[K]>) => {},
    send: (message) => sent.push(message),
  };
}

function announce(session: RendererSession, instanceId = 'test-instance', capabilities: string[] = []): void {
  session.handleIncoming({
    type: 'simulator_info',
    payload: {
      protocol_version: '0.3',
      binding: { name: 'test-binding', version: '0.3.0' },
      model: { id: 'test-model' },
      instance_id: instanceId,
      capabilities,
    },
  });
}

describe('RendererSession', () => {
  it('normalizes malformed handshake capabilities before UI consumers observe them', () => {
    const session = new RendererSession();
    session.handleIncoming({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'older-binding', version: '0.3.0' },
        model: { id: 'test-model' },
        instance_id: 'test-instance',
        capabilities: null as unknown as string[],
      },
    });

    expect(session.simulatorInfo?.capabilities).toEqual([]);
  });

  it('commits a state-sync replay once at the end boundary', () => {
    const session = new RendererSession();
    const commits: RendererSessionCommitDetail[] = [];
    session.addEventListener('commit', (event) => {
      commits.push((event as CustomEvent<RendererSessionCommitDetail>).detail);
    });

    session.attachTransport(createTransport([]));
    announce(session);
    const requestId = session.requestStateSync();
    session.handleIncoming({ type: 'state_sync_begin', payload: { request_id: requestId, model_id: 'test-model', instance_id: 'test-instance', mode: 'replace' } });
    session.handleIncoming({ type: 'env_create', payload: { id: 'main', type: '2d' } });
    session.handleIncoming({ type: 'metadata_update', payload: { time: 4 } });

    expect(commits).toHaveLength(0);
    expect(session.scenario.getEnvironment('main')).toBeUndefined();

    session.handleIncoming({ type: 'state_sync_end', payload: { request_id: requestId, state_revision: '1' } });

    expect(commits).toEqual([
      expect.objectContaining({
        origin: 'state-sync',
        messages: [
          expect.objectContaining({ type: 'state_sync_begin' }),
          expect.objectContaining({ type: 'env_create' }),
          expect.objectContaining({ type: 'metadata_update' }),
          expect.objectContaining({ type: 'state_sync_end' }),
        ],
      }),
    ]);
  });

  it('releases the transaction gate before flushing actions queued during state sync', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);
    const requestId = session.requestStateSync('sync-with-queued-action');
    session.run.requestAction('step');

    session.handleIncoming({ type: 'state_sync_begin', payload: { request_id: requestId, model_id: 'test-model', instance_id: 'test-instance', mode: 'replace' } });
    session.handleIncoming({ type: 'state_sync_end', payload: { request_id: requestId, state_revision: '1' } });

    expect(sent).toContainEqual(expect.objectContaining({
      type: 'action_invoke',
      payload: expect.objectContaining({ id: 'step' }),
    }));
  });

  it('treats a requested state sync as an active transaction before begin', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session, 'test-instance', ['scene.restore.projected']);

    session.requestStateSync('sync-1');

    expect(() => session.requestStateSync('sync-2')).toThrow(/protocol transaction/);
    expect(() => session.requestSceneRestore({ time: 2 })).toThrow(/protocol transaction/);
    expect(sent).toHaveLength(1);
  });

  it('clears a pending state sync after a correlated simulator error', () => {
    const session = new RendererSession();
    session.attachTransport(createTransport([]));
    announce(session);

    const requestId = session.requestStateSync('sync-1');
    session.handleIncoming({ type: 'error', payload: { code: 'busy', message: 'Try again.', request_id: requestId } });

    expect(() => session.requestStateSync('sync-2')).not.toThrow();
  });

  it('clears a pending scene restore after a correlated simulator error', () => {
    const session = new RendererSession();
    session.attachTransport(createTransport([]));
    announce(session, 'test-instance', ['scene.restore.projected']);

    const requestId = session.requestSceneRestore({ time: 2 });
    session.handleIncoming({ type: 'error', payload: { code: 'busy', message: 'Try again.', request_id: requestId } });

    expect(() => session.requestSceneRestore({ time: 3 })).not.toThrow();
  });

  it('requires topology capability when projected restore changes layer dependencies', () => {
    const session = new RendererSession();
    session.attachTransport(createTransport([]));
    announce(session, 'test-instance', ['scene.restore.projected']);
    session.scenario.apply({ type: 'env_create', payload: { id: 'world', type: '2d' } });
    session.scenario.apply({ type: 'env_layer_create', payload: { env_id: 'world', layer_id: 'agents-a', layer_type: 'agent' } });
    session.scenario.apply({ type: 'env_layer_create', payload: { env_id: 'world', layer_id: 'agents-b', layer_type: 'agent' } });
    session.scenario.apply({
      type: 'env_layer_create',
      payload: { env_id: 'world', layer_id: 'edges', layer_type: 'edge', dependency_layer_ids: { agent: 'agents-a' } },
    });

    expect(() => session.requestSceneRestore({
      envs: [{
        id: 'world', type: '2d', layers: [
          { layer_id: 'agents-a', layer_type: 'agent' },
          { layer_id: 'agents-b', layer_type: 'agent' },
          { layer_id: 'edges', layer_type: 'edge', dependency_layer_ids: { agent: 'agents-b' } },
        ],
      }],
    })).toThrow('topology');
  });

  it('forgets identity before a project source is replaced', () => {
    const firstMessages: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(firstMessages));
    announce(session);
    const firstSync = session.requestStateSync('first-sync');
    session.handleIncoming({ type: 'state_sync_begin', payload: { request_id: firstSync, model_id: 'test-model', instance_id: 'test-instance', mode: 'replace' } });
    session.handleIncoming({ type: 'state_sync_end', payload: { request_id: firstSync, state_revision: '1' } });

    session.detachTransport();
    session.resetSimulatorIdentity();
    const secondMessages: RendererToSimulatorMessage[] = [];
    session.attachTransport(createTransport(secondMessages));
    session.handleIncoming({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'test-binding', version: '0.3.0' },
        model: { id: 'replacement-model' },
        instance_id: 'replacement-instance',
        capabilities: [],
      },
    });

    expect(session.identityStatus).toBe('matching');
    expect(() => session.requestStateSync('replacement-sync')).not.toThrow();
    expect(secondMessages).toContainEqual(expect.objectContaining({
      type: 'state_sync',
      payload: expect.objectContaining({ model_id: 'replacement-model' }),
    }));
  });

  it('blocks state sync when a persisted project identity does not match the handshake', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.setExpectedSimulatorIdentity({
      model_id: 'saved-model',
      state_schema_version: '1',
      instance_id: 'saved-instance',
    });
    session.attachTransport(createTransport(sent));
    session.handleIncoming({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'test-binding', version: '0.3.0' },
        model: { id: 'other-model', state_schema_version: '1' },
        instance_id: 'other-instance',
        capabilities: [],
      },
    });

    expect(session.identityStatus).toBe('model-mismatch');
    expect(() => session.requestStateSync('blocked-sync')).toThrow(/does not match/);
    expect(sent).toEqual([]);
    session.handleIncoming({ type: 'metadata_update', payload: { time: 99 } });
    expect(session.scenario.metadata.time).toBeUndefined();
  });

  it('treats a persisted state-schema mismatch as a model mismatch', () => {
    const session = new RendererSession();
    session.setExpectedSimulatorIdentity({ model_id: 'test-model', state_schema_version: 'old-schema' });
    session.handleIncoming({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'test-binding', version: '0.3.0' },
        model: { id: 'test-model', state_schema_version: 'new-schema' },
        instance_id: 'test-instance',
        capabilities: [],
      },
    });

    expect(session.identityStatus).toBe('model-mismatch');
  });

  it('correlates checkpoint capture results without committing a scene mutation', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    const captures: unknown[] = [];
    const commits: RendererSessionCommitDetail[] = [];
    session.addEventListener('scene:capture', (event) => {
      captures.push((event as CustomEvent<{ result: unknown }>).detail.result);
    });
    session.addEventListener('commit', (event) => {
      commits.push((event as CustomEvent<RendererSessionCommitDetail>).detail);
    });
    session.attachTransport(createTransport(sent));
    announce(session, 'test-instance', ['scene.restore.checkpoint']);

    const requestId = session.requestSceneCapture('capture-1');
    expect(requestId).toBe('capture-1');
    expect(sent).toContainEqual({ type: 'scene_capture', payload: { request_id: 'capture-1' } });

    session.handleIncoming({
      type: 'scene_capture_result',
      payload: {
        request_id: 'capture-1',
        model_id: 'test-model',
        checkpoint: { encoding: 'application/octet-stream', data: new Uint8Array([1, 2]) },
      },
    });

    expect(captures).toEqual([expect.objectContaining({ request_id: 'capture-1' })]);
    expect(commits).toHaveLength(0);
    expect(() => session.requestSceneCapture('capture-2')).not.toThrow();
  });

  it('settles capture failures rejected by session validation and releases the transaction', async () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session, 'test-instance', ['scene.restore.checkpoint']);

    const capture = session.captureScene();
    const requestId = (sent[sent.length - 1]?.payload as { request_id: string }).request_id;
    session.handleIncoming({
      type: 'scene_capture_result',
      payload: {
        request_id: requestId,
        model_id: 'other-model',
        checkpoint: { encoding: 'application/octet-stream', data: new Uint8Array([1]) },
      },
    });

    await expect(capture).rejects.toThrow(/different model or state schema/);
    expect(session.identityStatus).toBe('matching');
    expect(() => session.requestSceneCapture('capture-after-rejection')).not.toThrow();
  });

  it('times out scene operations, rejects their Promise, and releases the command gate', async () => {
    vi.useFakeTimers();
    try {
      const sent: RendererToSimulatorMessage[] = [];
      const session = new RendererSession({ transactionTimeoutMs: 25 });
      session.attachTransport(createTransport(sent));
      announce(session, 'test-instance', ['scene.restore.checkpoint']);

      const capture = session.captureScene();
      const rejection = expect(capture).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(25);

      await rejection;
      expect(() => session.requestSceneCapture('capture-after-timeout')).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rolls back an active request when transport send fails synchronously', async () => {
    const sent: RendererToSimulatorMessage[] = [];
    let failNextSend = true;
    const session = new RendererSession();
    session.attachTransport({
      ...createTransport(sent),
      send: (message) => {
        if (failNextSend) {
          failNextSend = false;
          throw new Error('send failed');
        }
        sent.push(message);
      },
    });
    announce(session, 'test-instance', ['scene.restore.checkpoint']);

    await expect(session.captureScene()).rejects.toThrow('send failed');
    expect(() => session.requestSceneCapture('capture-after-send-failure')).not.toThrow();
    expect(sent).toContainEqual({ type: 'scene_capture', payload: { request_id: 'capture-after-send-failure' } });
  });

  it('sends asset_sync through the same optimistic control path', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);

    session.handleIncoming({
      type: 'asset_metadata',
      payload: { assets: [{ id: 'sprite', hash: 'a', mime: 'image/png', size: 1 }] },
    });

    expect(sent).toEqual([{ type: 'asset_sync', payload: { assets: {} } }]);
  });

  it('publishes outbound actions before a synchronous transport can respond', () => {
    const session = new RendererSession();
    let outboundPublished = false;
    session.addEventListener('outbound', () => {
      outboundPublished = true;
    });
    session.attachTransport({
      ...createTransport([]),
      send: () => {
        expect(outboundPublished).toBe(true);
      },
    });
    announce(session);

    session.run.requestAction('step');
  });

  it('owns one action-metrics window across synchronous dispatch and completion', () => {
    const session = new RendererSession();
    const metrics: unknown[] = [];
    session.addEventListener('action:metrics', (event) => {
      metrics.push((event as CustomEvent).detail.metrics);
    });
    session.attachTransport({
      ...createTransport([]),
      send: (message) => {
        if (message.type !== 'action_invoke') return;
        const payload = message.payload as { id: string; request_id: string };
        session.handleIncoming({
          type: 'action_result',
          payload: { id: payload.id, request_id: payload.request_id, timings: { simulate_ms: 2 } },
        });
      },
    });
    announce(session);

    session.beginActionMetrics('step');
    session.run.requestAction('step');

    expect(metrics).toEqual([
      null,
      expect.objectContaining({
        runtime: { tps: expect.any(Number), mspt: expect.any(Number) },
        simulator: expect.objectContaining({ simulate_ms: 2 }),
      }),
    ]);
  });

  it('echoes parameter changes locally without fabricating a simulator param_sync', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);
    session.scenario.apply({ type: 'param_create', payload: { id: 'density', label: 'Density', type: 'number', value: 1 } });
    const optimistic: unknown[] = [];
    session.scenario.addEventListener('param:optimistic', (event) => {
      optimistic.push((event as CustomEvent).detail);
    });

    session.startRecording();
    session.setParameter('density', 3);
    const snapshot = session.stopRecording()!;

    expect(sent).toContainEqual({ type: 'param_change', payload: { id: 'density', value: 3 } });
    expect(session.scenario.getParameter('density')?.value).toBe(3);
    expect(optimistic).toEqual([{ id: 'density', value: 3 }]);
    expect(snapshot.frames[0]?.controls).toEqual([{ type: 'param_change', payload: { id: 'density', value: 3 } }]);
    expect(snapshot.frames[0]?.messages.some((message) => message.type === 'param_sync')).toBe(false);
  });

  it('starts run recording before the first dispatch and completes a seekable snapshot', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    const completed: Snapshot[] = [];
    session.addEventListener('recording:complete', (event) => {
      completed.push((event as CustomEvent<{ snapshot: Snapshot }>).detail.snapshot);
    });
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 1, record: { maxSteps: 10, maxBytes: 1_000_000 } });
    const tickId = (sent[0].payload as { request_id: string }).request_id;
    session.handleIncoming({ type: 'metadata_update', payload: { time: 1 } });
    session.handleIncoming({ type: 'action_result', payload: { id: 'step', request_id: tickId } });

    expect(completed).toHaveLength(1);
    expect(completed[0].frames).toHaveLength(1);
    expect(materializeSnapshot(completed[0]).metadata.time).toBe(1);
  });

  it('requires restore capabilities and commits a chart-free restore only on ok', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session, 'test-instance', ['scene.restore.projected']);

    expect(() => session.requestSceneRestore({ time: 2, checkpoint: { encoding: 'raw', data: 'AQ==' } })).toThrow(/checkpoint/);
    const requestId = session.requestSceneRestore({ time: 2 });
    expect(sent[sent.length - 1]).toEqual(expect.objectContaining({ type: 'scene_restore' }));

    session.handleIncoming({ type: 'scene_restore_begin', payload: { request_id: requestId } });
    session.handleIncoming({ type: 'metadata_update', payload: { time: 2 } });
    expect(session.scenario.metadata.time).toBeUndefined();
    session.handleIncoming({ type: 'scene_restore_end', payload: { request_id: requestId, status: 'ok' } });
    expect(session.scenario.metadata.time).toBe(2);
  });

  it('rejects chart messages inside a scene restore transaction without mutating live state', () => {
    const session = new RendererSession();
    session.attachTransport(createTransport([]));
    announce(session, 'test-instance', ['scene.restore.projected']);
    const requestId = session.requestSceneRestore({ time: 3 });
    session.handleIncoming({ type: 'scene_restore_begin', payload: { request_id: requestId } });
    session.handleIncoming({ type: 'chart_create', payload: { id: 'forbidden', label: 'Forbidden' } });
    session.handleIncoming({ type: 'scene_restore_end', payload: { request_id: requestId, status: 'ok' } });

    expect(session.scenario.charts.getGroup('forbidden')).toBeUndefined();
    expect(session.scenario.metadata.time).toBeUndefined();
  });

  it('rejects an invalid restore transaction and requires replacement sync before mutations', async () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session, 'test-instance', ['scene.restore.projected']);
    session.scenario.apply({ type: 'param_create', payload: { id: 'density', label: 'Density', type: 'number', value: 1 } });

    const restore = session.restoreScene({ request_id: 'restore-invalid-chart', time: 3 });
    session.handleIncoming({ type: 'scene_restore_begin', payload: { request_id: 'restore-invalid-chart' } });
    session.handleIncoming({ type: 'chart_create', payload: { id: 'forbidden', label: 'Forbidden' } });

    await expect(restore).rejects.toThrow(/Chart messages are forbidden/);
    expect(session.identityStatus).toBe('sync-required');
    expect(() => session.setParameter('density', 2)).toThrow(/replacement state sync/);

    const syncId = session.requestStateSync('recover-sync');
    session.handleIncoming({ type: 'state_sync_begin', payload: { request_id: syncId, model_id: 'test-model', instance_id: 'test-instance', mode: 'replace' } });
    session.handleIncoming({ type: 'state_sync_end', payload: { request_id: syncId, state_revision: '2' } });
    expect(session.identityStatus).toBe('matching');
  });
});
