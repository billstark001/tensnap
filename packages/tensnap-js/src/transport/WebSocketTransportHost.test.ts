import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import {
  decodeProtocolMessage,
  encodeProtocolMessage,
  type AnyProtocolMessage,
} from '@tensnap/protocol';
import {
  defineActions,
  defineCharts,
  defineEnvironment,
  defineLayer,
  defineParameters,
  defineScenario,
} from '../bindings';
import { ScenarioRegistry } from '../scenario';
import { SimulatorSession } from '../runtime';
import {
  createWebSocketTransportHost,
  normalizeWebSocketRawData,
  type WebSocketTransportHost,
} from './WebSocketTransportHost';

async function connectClient(
  url: string,
  onMessage?: (data: WebSocket.RawData, isBinary: boolean) => void,
): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const client = new WebSocket(url);
    if (onMessage) client.on('message', onMessage);
    client.once('open', () => resolve(client));
    client.once('error', reject);
  });
}

describe('WebSocketTransportHost', () => {
  const hosts: WebSocketTransportHost[] = [];

  afterEach(async () => {
    await Promise.all(hosts.splice(0).map((host) => host.close()));
  });

  it.each(['json', 'msgpack'] as const)(
    'replays state_sync over %s websocket frames',
    async (encoding) => {
      const registry = ScenarioRegistry.from(
        defineScenario({
          parameters: defineParameters({
            id: 'speed',
            type: 'number',
            label: 'Speed',
            value: 1,
            min: 0,
            max: 10,
            step: 1,
          }),
          actions: defineActions({ id: 'start', label: 'Start', continuous: true }),
          environments: [
            defineEnvironment({
              id: 'main',
              type: '2d',
              layers: [defineLayer({ layerId: 'agents', layerType: 'agent' })],
            }),
          ],
          charts: defineCharts({
            id: 'population',
            label: 'Population',
            data_list: [{ id: 'count', label: 'Count' }],
          }),
        }),
      );

      const host = createWebSocketTransportHost({
        serverOptions: { port: 0 },
        sessionFactory: () =>
          registry.createSession({
            simulatorInfo: {
              protocol_version: '0.3',
              binding: { name: 'registry-test', version: '0.3.0' },
              model: { id: 'registry-model' },
              instance_id: 'registry-instance',
              capabilities: [],
            },
          }),
        encoding,
        rendererMessageValidation: 'error',
        simulatorMessageValidation: 'error',
      });
      hosts.push(host);

      const messages: AnyProtocolMessage[] = [];
      const client = await connectClient(host.url!, (data, isBinary) => {
        messages.push(decodeProtocolMessage(normalizeWebSocketRawData(data, isBinary)));
      });

      client.send(
        encodeProtocolMessage(
          {
            type: 'state_sync',
            payload: {
              request_id: 'req-1',
              model_id: 'registry-model',
              parameters: [],
              actions: [],
              envs: [],
              charts: [],
              monitors: [],
            },
          },
          encoding,
        ),
      );

      await vi.waitFor(() => {
        expect(messages.map((message) => message.type)).toEqual([
          'simulator_info',
          'state_sync_begin',
          'param_create',
          'action_create',
          'env_create',
          'env_layer_create',
          'chart_create',
          'state_sync_end',
        ]);
      });

      client.close();
    },
  );

  it.each(['json', 'msgpack'] as const)(
    'routes successive %s renderer messages into the simulator session',
    async (encoding) => {
      const onActionInvoke = vi.fn(async (payload, session: SimulatorSession) => {
        await session.emitter.actionResult({
          id: payload.id,
          request_id: payload.request_id,
          should_continue: false,
        });
      });
      const onSimulatorMessage = vi.fn();
      const onRendererMessage = vi.fn();

      const host = createWebSocketTransportHost({
        serverOptions: { port: 0 },
        sessionFactory: () =>
          new SimulatorSession({
            simulatorInfo: {
              protocol_version: '0.3',
              binding: { name: 'session-test', version: '0.3.0' },
              model: { id: 'session-model' },
              instance_id: 'session-instance',
              capabilities: [],
            },
            onActionInvoke,
          }),
        encoding,
        rendererMessageValidation: 'error',
        simulatorMessageValidation: 'error',
        onSimulatorMessage,
        onRendererMessage,
      });
      hosts.push(host);

      const messages: AnyProtocolMessage[] = [];
      const client = await connectClient(host.url!, (data, isBinary) => {
        messages.push(decodeProtocolMessage(normalizeWebSocketRawData(data, isBinary)));
      });

      for (const request_id of ['action-1', 'action-2']) {
        client.send(
          encodeProtocolMessage(
            { type: 'action_invoke', payload: { id: 'step', request_id } },
            encoding,
          ),
        );
      }

      await vi.waitFor(() => {
        expect(onActionInvoke).toHaveBeenCalledTimes(2);
        for (const request_id of ['action-1', 'action-2']) {
          expect(messages).toContainEqual({
            type: 'action_result',
            payload: { id: 'step', request_id, should_continue: false },
          });
        }
        expect(onRendererMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'action_invoke' }),
          expect.any(Number),
        );
        expect(onSimulatorMessage).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'action_result' }),
          expect.any(Number),
        );
      });

      client.close();
    },
  );
});
