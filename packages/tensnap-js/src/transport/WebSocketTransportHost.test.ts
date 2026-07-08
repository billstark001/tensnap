import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import {
  decodeProtocolMessage,
  encodeProtocolMessage,
  type AnyProtocolMessage,
} from '@tensnap/protocol';
import { defineActions, defineCharts, defineEnvironment, defineLayer, defineParameters, defineScenario } from '../bindings';
import { ScenarioRegistry } from '../scenario';
import { SimulatorSession } from '../runtime';
import {
  createWebSocketTransportHost,
  normalizeWebSocketRawData,
  type WebSocketTransportHost,
} from './WebSocketTransportHost';

async function connectClient(url: string): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const client = new WebSocket(url);
    client.once('open', () => resolve(client));
    client.once('error', reject);
  });
}

describe('WebSocketTransportHost', () => {
  const hosts: WebSocketTransportHost[] = [];

  afterEach(async () => {
    await Promise.all(hosts.splice(0).map((host) => host.close()));
  });

  it('replays a scenario registry over websocket state_sync', async () => {
    const registry = ScenarioRegistry.from(defineScenario({
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
        dataList: [{ id: 'count', label: 'Count' }],
      }),
    }));

    const host = createWebSocketTransportHost({
      serverOptions: { port: 0 },
      sessionFactory: () => registry.createSession(),
      encoding: 'json',
    });
    hosts.push(host);

    const client = await connectClient(host.url!);
    const messages: AnyProtocolMessage[] = [];
    client.on('message', (data, isBinary) => {
      messages.push(decodeProtocolMessage(normalizeWebSocketRawData(data, isBinary)));
    });

    client.send(encodeProtocolMessage({
      type: 'state_sync',
      payload: {
        request_id: 'req-1',
        parameters: [],
        actions: [],
        envs: [],
        charts: [],
      },
    }, 'json'));

    await vi.waitFor(() => {
      expect(messages.map((message) => message.type)).toEqual([
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
  });

  it('routes renderer messages into the simulator session', async () => {
    const onActionStart = vi.fn(async (payload, session: SimulatorSession) => {
      await session.emitter.actionEnd({ id: payload.id, continue: false });
    });

    const host = createWebSocketTransportHost({
      serverOptions: { port: 0 },
      sessionFactory: () => new SimulatorSession({ onActionStart }),
      encoding: 'json',
    });
    hosts.push(host);

    const client = await connectClient(host.url!);
    const messages: AnyProtocolMessage[] = [];
    client.on('message', (data, isBinary) => {
      messages.push(decodeProtocolMessage(normalizeWebSocketRawData(data, isBinary)));
    });

    client.send(encodeProtocolMessage({
      type: 'action_start',
      payload: { id: 'step' },
    }, 'json'));

    await vi.waitFor(() => {
      expect(onActionStart).toHaveBeenCalledTimes(1);
      expect(messages).toContainEqual({
        type: 'action_end',
        payload: { id: 'step', continue: false },
      });
    });

    client.close();
  });
});