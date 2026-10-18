// @vitest-environment node
import { assert, expect, it } from 'vitest';
import {
  ProtocolCodec,
  type ProtocolEncoding,
  type RendererToSimulatorMessage,
} from '@tensnap/protocol';
import type {
  ISimulatorTransport,
  TransportConnectionState,
  TransportEventHandler,
  TransportEventMap,
} from '../transport';
import { RendererSession } from './RendererSession';

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
    on: <K extends keyof TransportEventMap>(
      _type: K,
      _handler: TransportEventHandler<TransportEventMap[K]>,
    ) => {},
    off: <K extends keyof TransportEventMap>(
      _type: K,
      _handler?: TransportEventHandler<TransportEventMap[K]>,
    ) => {},
    send: (message) => sent.push(message),
  };
}

function announce(
  session: RendererSession,
  instanceId = 'test-instance',
  capabilities: string[] = [],
): void {
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

it.each(['json', 'msgpack'] as const)(
  'restores archived checkpoints through a strict %s codec for every history policy',
  async (encoding) => {
    for (const data of ['AQ==', Uint8Array.of(1)]) {
      for (const chartPolicy of ['replace', 'truncate', 'preserve'] as const) {
        const sent: RendererToSimulatorMessage[] = [];
        const codec = new ProtocolCodec({ validation: { level: 'error' } });
        const session = new RendererSession();
        const transport = createTransport(sent);
        transport.send = (message) => {
          const decoded = codec.decode(codec.encode(message, encoding));
          expect(decoded.type).toBe(message.type);
          sent.push(message);
        };
        session.attachTransport(transport);
        announce(session, 'test-instance', ['scene.restore.checkpoint']);
        session.scenario.load({
          ...session.scenario.dump(),
          charts: [
            { id: 'history', label: 'History', metadataDict: {}, data: [{ time: 1, v: 2 }] },
          ],
        });
        const frame = await session.captureFrame();
        frame.modelIdentity = { model_id: 'test-model' };
        frame.checkpoint = { model_id: 'test-model', encoding: 'raw', data };
        frame.checkpointStatus = 'captured';
        frame.consistency = 'aligned';
        frame.source.modelTime = 1;
        const currentCharts = [
          {
            id: 'history',
            label: 'History',
            metadataDict: {},
            data: [
              { time: 1, v: 2 },
              { time: 7, v: 8 },
            ],
          },
        ];
        session.scenario.load({ ...session.scenario.dump(), charts: currentCharts });
        const restore = session.restoreFrame(frame, { mode: 'checkpoint', chartPolicy });
        if (!sent.length) throw new Error(JSON.stringify(await restore));
        const request = sent[sent.length - 1];
        assert(request.type === 'scene_restore');
        const payload = request.payload as { request_id: string; checkpoint: object };
        expect(Object.keys(payload.checkpoint).sort()).toEqual(['data', 'encoding']);
        expect(payload).not.toHaveProperty('time');
        expect(frame.checkpoint.model_id).toBe('test-model');
        expect(session.scenario.dump().charts).toEqual(currentCharts);
        session.handleIncoming(
          codec.decode(
            codec.encode(
              { type: 'scene_restore_begin', payload: { request_id: payload.request_id } },
              encoding,
            ),
          ),
        );
        session.handleIncoming(
          codec.decode(
            codec.encode(
              {
                type: 'scene_restore_end',
                payload: { request_id: payload.request_id, status: 'ok' },
              },
              encoding,
            ),
          ),
        );
        expect(await restore).toMatchObject({ modelStatus: 'restored' });
        expect(session.scenario.dump().charts[0].data).toHaveLength(
          chartPolicy === 'preserve' ? 2 : 1,
        );
      }
    }
  },
);
