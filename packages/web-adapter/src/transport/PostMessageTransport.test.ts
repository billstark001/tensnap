import { describe, expect, it, vi } from 'vitest';
import type { AnyProtocolMessage } from '@tensnap/core';
import { ScenarioRegistry } from '@tensnap/js';
import { defineActions, defineCharts, defineEnvironment, defineLayer, defineParameters, defineScenario } from '@tensnap/js/bindings';
import { SimulatorSession } from '@tensnap/js/runtime';
import { createPostMessageSimulatorHost } from '@tensnap/js/transport';
import { createLinkedEndpoints } from './endpoints';
import { InMemoryTransport } from './InMemoryTransport';
import { createPostMessageTransport } from './PostMessageTransport';

describe('browser-side transports', () => {
  it('replays a declarative scenario over postMessage state sync', async () => {
    const scenario = defineScenario({
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
    });
    const registry = ScenarioRegistry.from(scenario);

    const { renderer, simulator } = createLinkedEndpoints();
    const transport = createPostMessageTransport({ endpoint: renderer, connectionId: 'conn-1' });
    const host = createPostMessageSimulatorHost({
      endpoint: simulator,
      session: registry.createSession(),
      connectionId: 'conn-1',
    });

    const messages: AnyProtocolMessage[] = [];
    transport.on('message', (message) => {
      messages.push(message);
    });

    await transport.connect();
    transport.send({
      type: 'state_sync',
      payload: {
        request_id: 'req-1',
        parameters: [],
        actions: [],
        envs: [],
        charts: [],
      },
    });

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

    await host.destroy();
    transport.destroy();
  });

  it('buffers onConnect messages in the in-memory transport until open', async () => {
    const onMessage = vi.fn();
    const transport = new InMemoryTransport({
      async onConnect(send) {
        send({ type: 'metadata_update', payload: { time: 1 } });
      },
      onMessage,
      onDisconnect() {},
    }, 'inmemory-test');

    const messages: AnyProtocolMessage[] = [];
    transport.on('message', (message) => {
      messages.push(message);
    });

    await transport.connect();

    expect(transport.isConnected).toBe(true);
    expect(messages).toEqual([
      { type: 'metadata_update', payload: { time: 1 } },
    ]);

    transport.send({ type: 'action_start', payload: { id: 'step' } });
    expect(onMessage).toHaveBeenCalledWith({ type: 'action_start', payload: { id: 'step' } });
  });

  it('routes action_start to the simulator session and returns action_end', async () => {
    const onActionStart = vi.fn(async (payload, session: SimulatorSession) => {
      await session.emitter.actionEnd({ id: payload.id, continue: false });
    });

    const { renderer, simulator } = createLinkedEndpoints();
    const transport = createPostMessageTransport({ endpoint: renderer, connectionId: 'conn-2' });
    const host = createPostMessageSimulatorHost({
      endpoint: simulator,
      session: new SimulatorSession({ onActionStart }),
      connectionId: 'conn-2',
    });

    const messages: AnyProtocolMessage[] = [];
    transport.on('message', (message) => {
      messages.push(message);
    });

    await transport.connect();
    transport.send({
      type: 'action_start',
      payload: { id: 'step' },
    });

    await vi.waitFor(() => {
      expect(onActionStart).toHaveBeenCalledTimes(1);
      expect(messages).toContainEqual({
        type: 'action_end',
        payload: { id: 'step', continue: false },
      });
    });

    await host.destroy();
    transport.destroy();
  });
});