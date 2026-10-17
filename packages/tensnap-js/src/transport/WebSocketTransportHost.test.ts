import {
  closeWebSocket,
  normalizeWebSocketData,
  waitForWebSocketOpen,
} from '@tensnap/network/node';
import * as network from '@tensnap/network/node';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { once } from 'node:events';
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
  type WebSocketTransportHost,
} from './WebSocketTransportHost';

async function connectClient(
  url: string,
  onMessage?: (data: WebSocket.RawData, isBinary: boolean) => void,
): Promise<WebSocket> {
  const client = new WebSocket(url);
  if (onMessage) client.on('message', onMessage);
  await waitForWebSocketOpen(client);
  return client;
}

describe('WebSocketTransportHost', () => {
  const hosts: WebSocketTransportHost[] = [];

  afterEach(async () => {
    await Promise.all(hosts.splice(0).map((host) => host.close()));
  });

  it.each(['factory', 'identity', 'attach', 'open'] as const)(
    'closes a failed %s initialization without unhandled cleanup rejections',
    async (stage) => {
      const failure = new Error('initialization failed');
      const session = new SimulatorSession({
        simulatorInfo: {
          protocol_version: '0.3',
          binding: { name: 'fixture', version: '0.3.0' },
          model: { id: 'fixture' },
          instance_id: 'fixture',
          capabilities: [],
        },
        onConnect: () => {
          throw failure;
        },
      });
      const cleanup = vi.spyOn(session, 'close');
      if (stage === 'attach')
        vi.spyOn(session, 'attach').mockImplementation(() => {
          throw failure;
        });
      const report = vi.fn(() => {
        throw new Error('diagnostic failed');
      });
      const host = createWebSocketTransportHost({
        ip_family: 'ipv4',
        sessionFactory: () => {
          if (stage === 'factory') throw failure;
          return session;
        },
        connectionIdFactory: () => {
          if (stage === 'identity') throw failure;
          return 'fixture';
        },
        onValidationError: report,
      });
      hosts.push(host);
      await host.ready;
      const client = new WebSocket(host.url!);
      await once(client, 'close');
      await vi.waitFor(() => expect(report).toHaveBeenCalledWith(failure));
      expect(cleanup).toHaveBeenCalledTimes(stage === 'factory' ? 0 : 1);
      expect(session.isConnected).toBe(false);
    },
  );

  it('shares shutdown, rejects late connections and disconnects each session once', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onDisconnect = vi.fn(() => gate);
    const factory = vi.fn(
      () =>
        new SimulatorSession({
          simulatorInfo: {
            protocol_version: '0.3',
            binding: { name: 'fixture', version: '0.3.0' },
            model: { id: 'fixture' },
            instance_id: 'fixture',
            capabilities: [],
          },
          onDisconnect,
        }),
    );
    const host = createWebSocketTransportHost({ ip_family: 'ipv4', sessionFactory: factory });
    hosts.push(host);
    await host.ready;
    const url = host.url!;
    const client = await connectClient(url);
    const first = host.close();
    expect(host.close()).toBe(first);
    let completed = false;
    void first.then(() => {
      completed = true;
    });
    try {
      await vi.waitFor(() => expect(onDisconnect).toHaveBeenCalledOnce());
      const late = new WebSocket(url);
      try {
        await expect(waitForWebSocketOpen(late)).rejects.toThrow();
      } finally {
        await closeWebSocket(late);
      }
      expect(factory).toHaveBeenCalledOnce();
      expect(completed).toBe(false);
    } finally {
      release();
      await first;
      await closeWebSocket(client);
    }
    expect(onDisconnect).toHaveBeenCalledOnce();
    expect(host.url).toBeUndefined();
    expect(host.urls).toEqual([]);
  });

  it('can close an external listener before it starts listening', async () => {
    const http = createServer();
    const websocket = new WebSocketServer({ server: http });
    const host = createWebSocketTransportHost({
      server: websocket,
      sessionFactory: () => {
        throw new Error('unused');
      },
    });
    hosts.push(host);
    const ready = expect(host.ready).rejects.toThrow(/closed before listening/);
    await host.close();
    await ready;
    expect(websocket.listenerCount('listening')).toBe(0);
    expect(websocket.listenerCount('error')).toBe(0);
    expect(http.listening).toBe(false);
  });

  it('skips byte counting when no frame observer is installed', async () => {
    const count = vi.spyOn(network, 'webSocketByteLength');
    const session = new SimulatorSession({
      simulatorInfo: {
        protocol_version: '0.3',
        binding: { name: 'fixture', version: '0.3.0' },
        model: { id: 'fixture' },
        instance_id: 'fixture',
        capabilities: [],
      },
      onParamChange: async (_payload, current) => {
        await current.emitter.metadataUpdate({ time: 1 });
      },
    });
    const host = createWebSocketTransportHost({ ip_family: 'ipv4', sessionFactory: () => session });
    hosts.push(host);
    try {
      await host.ready;
      const client = await connectClient(host.url!);
      const response = once(client, 'message');
      client.send(JSON.stringify({ type: 'param_change', payload: { id: 'speed', value: 1 } }));
      await response;
      expect(count).not.toHaveBeenCalled();
      await closeWebSocket(client);
    } finally {
      count.mockRestore();
    }
  });

  it('releases managed listeners even when WebSocket server cleanup fails', async () => {
    const host = createWebSocketTransportHost({
      ip_family: 'ipv4',
      sessionFactory: () => {
        throw new Error('unused');
      },
    });
    await host.ready;
    const port = Number(new URL(host.url!).port);
    const close = vi.spyOn(host.server, 'close').mockImplementation((callback) => {
      callback?.(new Error('server close failed'));
    });
    try {
      await expect(host.close()).rejects.toThrow('server close failed');
      const replacement = await network.listenIPServers(createServer, { host: '127.0.0.1', port });
      await network.closeIPServers(replacement);
    } finally {
      close.mockRestore();
      await new Promise<void>((resolve) => host.server.close(() => resolve()));
    }
  });

  it('publishes one ephemeral port for both auto endpoints', async () => {
    const host = createWebSocketTransportHost({
      serverOptions: { host: 'localhost', port: 0 },
      sessionFactory: () =>
        new SimulatorSession({
          simulatorInfo: {
            protocol_version: '0.3',
            binding: { name: 'fixture', version: '0.3.0' },
            model: { id: 'same-model' },
            instance_id: 'same-instance',
            capabilities: [],
          },
        }),
    });
    hosts.push(host);
    await host.ready;
    expect(new Set(host.urls.map((url) => new URL(url).port)).size).toBe(1);
    for (const url of host.urls) {
      const frames: AnyProtocolMessage[] = [];
      const client = await connectClient(url, (data, binary) =>
        frames.push(decodeProtocolMessage(normalizeWebSocketData(data, binary))),
      );
      await vi.waitFor(() =>
        expect(frames[0]).toMatchObject({
          type: 'simulator_info',
          payload: { model: { id: 'same-model' } },
        }),
      );
      client.close();
      await once(client, 'close');
    }
  });

  it('uses the actual IPv6 endpoint even if an IPv4 service owns the same port', async (context) => {
    const other = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(other, 'listening');
    const address = other.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const ipv6 = new WebSocketServer({ host: '::1', port: address.port });
    try {
      await once(ipv6, 'listening');
    } catch (error) {
      await new Promise<void>((resolve) => other.close(() => resolve()));
      if (
        ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EADDRINUSE'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      ) {
        context.skip();
        return;
      }
      throw error;
    }
    let foreignConnections = 0;
    other.on('connection', () => foreignConnections++);
    const host = createWebSocketTransportHost({
      server: ipv6,
      sessionFactory: () =>
        new SimulatorSession({
          simulatorInfo: {
            protocol_version: '0.3',
            binding: { name: 'fixture', version: '0.3.0' },
            model: { id: 'intended' },
            instance_id: 'intended',
            capabilities: [],
          },
        }),
    });
    hosts.push(host);
    try {
      await host.ready;
      expect(new URL(host.url!).hostname).toBe('[::1]');
      const client = await connectClient(host.url!);
      expect(foreignConnections).toBe(0);
      client.close();
      await once(client, 'close');
    } finally {
      await new Promise<void>((resolve) => other.close(() => resolve()));
    }
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

      await host.ready;

      const messages: AnyProtocolMessage[] = [];
      const client = await connectClient(host.url!, (data, isBinary) => {
        messages.push(decodeProtocolMessage(normalizeWebSocketData(data, isBinary)));
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

      await host.ready;

      const messages: AnyProtocolMessage[] = [];
      const client = await connectClient(host.url!, (data, isBinary) => {
        messages.push(decodeProtocolMessage(normalizeWebSocketData(data, isBinary)));
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
