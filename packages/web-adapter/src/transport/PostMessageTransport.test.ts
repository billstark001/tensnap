import { describe, expect, it, vi } from 'vitest';
import type { AnyProtocolMessage } from '@tensnap/protocol';
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
        data_list: [{ id: 'count', label: 'Count' }],
      }),
    });
    const registry = ScenarioRegistry.from(scenario);

    const { renderer, simulator } = createLinkedEndpoints();
    const transport = createPostMessageTransport({ endpoint: renderer, connectionId: 'conn-1' });
    const host = createPostMessageSimulatorHost({
      endpoint: simulator,
      session: registry.createSession({
        simulatorInfo: {
          protocol_version: '0.3',
          binding: { name: 'registry-test', version: '0.3.0' },
          model: { id: 'registry-model' },
          instance_id: 'registry-instance',
          capabilities: [],
        },
      }),
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
        model_id: 'registry-model',
        parameters: [],
        actions: [],
        envs: [],
        charts: [],
        monitors: [],
      },
    });

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

    await host.destroy();
    transport.destroy();
  });

  it('opens before forwarding simulator_info so its state-sync response is not dropped', async () => {
    const scenario = defineScenario({
      actions: defineActions({ id: 'step', label: 'Step', continuous: true }),
    });
    const registry = ScenarioRegistry.from(scenario);
    const { renderer, simulator } = createLinkedEndpoints();
    const transport = createPostMessageTransport({ endpoint: renderer, connectionId: 'handshake-order' });
    const host = createPostMessageSimulatorHost({
      endpoint: simulator,
      connectionId: 'handshake-order',
      session: registry.createSession({
        simulatorInfo: {
          protocol_version: '0.3',
          binding: { name: 'handshake-test', version: '0.3.0' },
          model: { id: 'handshake-model' },
          instance_id: 'handshake-instance',
          capabilities: [],
        },
      }),
    });

    const messages: AnyProtocolMessage[] = [];
    transport.on('message', (message) => {
      messages.push(message);
      if (message.type !== 'simulator_info') return;
      transport.send({
        type: 'state_sync',
        payload: {
          request_id: 'handshake-sync',
          model_id: 'handshake-model',
          parameters: [], actions: [], envs: [], charts: [], monitors: [],
        },
      });
    });

    await transport.connect();
    await vi.waitFor(() => {
      expect(transport.isConnected).toBe(true);
      expect(messages).toContainEqual(expect.objectContaining({ type: 'action_create', payload: expect.objectContaining({ id: 'step' }) }));
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

    transport.send({ type: 'action_invoke', payload: { id: 'step', request_id: 'action-1' } });
    expect(onMessage).toHaveBeenCalledWith({ type: 'action_invoke', payload: { id: 'step', request_id: 'action-1' } });
  });

  it('routes action_invoke to the simulator session and returns action_result', async () => {
    const onActionInvoke = vi.fn(async (payload, session: SimulatorSession) => {
      await session.emitter.actionResult({ id: payload.id, request_id: payload.request_id, should_continue: false });
    });

    const { renderer, simulator } = createLinkedEndpoints();
    const transport = createPostMessageTransport({ endpoint: renderer, connectionId: 'conn-2' });
    const host = createPostMessageSimulatorHost({
      endpoint: simulator,
      session: new SimulatorSession({
        simulatorInfo: {
          protocol_version: '0.3',
          binding: { name: 'session-test', version: '0.3.0' },
          model: { id: 'session-model' },
          instance_id: 'session-instance',
          capabilities: [],
        },
        onActionInvoke,
      }),
      connectionId: 'conn-2',
    });

    const messages: AnyProtocolMessage[] = [];
    transport.on('message', (message) => {
      messages.push(message);
    });

    await transport.connect();
    transport.send({
      type: 'action_invoke',
      payload: { id: 'step', request_id: 'action-1' },
    });

    await vi.waitFor(() => {
      expect(onActionInvoke).toHaveBeenCalledTimes(1);
      expect(messages).toContainEqual({
        type: 'action_result',
        payload: { id: 'step', request_id: 'action-1', should_continue: false },
      });
    });

    await host.destroy();
    transport.destroy();
  });
});
