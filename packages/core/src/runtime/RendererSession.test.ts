import type { ISimulatorTransport, TransportConnectionState, TransportEventHandler, TransportEventMap } from '../transport';
import type { ProtocolEncoding, RendererToSimulatorMessage } from '@tensnap/protocol';
import { describe, expect, it } from 'vitest';
import { RendererSession, type RendererSessionCommitDetail } from './RendererSession';

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

describe('RendererSession', () => {
  it('commits a state-sync replay once at the end boundary', () => {
    const session = new RendererSession();
    const commits: RendererSessionCommitDetail[] = [];
    session.addEventListener('commit', (event) => {
      commits.push((event as CustomEvent<RendererSessionCommitDetail>).detail);
    });

    session.attachTransport(createTransport([]));
    const requestId = session.requestStateSync();
    session.handleIncoming({ type: 'state_sync_begin', payload: { request_id: requestId } });
    session.handleIncoming({ type: 'env_create', payload: { id: 'main', type: '2d' } });
    session.handleIncoming({ type: 'metadata_update', payload: { time: 4 } });

    expect(commits).toHaveLength(0);
    expect(session.scenario.getEnvironment('main')).toBeDefined();

    session.handleIncoming({ type: 'state_sync_end', payload: { request_id: requestId } });

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

  it('sends asset_sync through the same optimistic control path', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));

    session.handleIncoming({
      type: 'asset_meta',
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

    session.run.requestAction('step');
  });
});
