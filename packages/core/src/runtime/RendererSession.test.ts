import type { ISimulatorTransport, TransportConnectionState, TransportEventHandler, TransportEventMap } from '../transport';
import type { ProtocolEncoding, RendererToSimulatorMessage } from '@tensnap/protocol';
import { describe, expect, it } from 'vitest';
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
});
