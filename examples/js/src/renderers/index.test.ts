import {
  AnyProtocolMessageSchema,
  type ProtocolValue,
  type SimulatorToRendererMessage,
  type StateSyncRequest,
} from '@tensnap/protocol';
import { describe, expect, it } from 'vitest';
import { getJsExampleDefinition, getJsExampleDefinitions } from './index';

const emptyStateSync: StateSyncRequest = {
  request_id: 'sync-1',
  model_id: 'test-model',
  parameters: [],
  actions: [],
  envs: [],
  charts: [],
  monitors: [],
};

describe('JS example sessions', () => {
  for (const definition of getJsExampleDefinitions()) {
    it(`${definition.id} opens, syncs, and steps through @tensnap/js`, async () => {
      const messages: SimulatorToRendererMessage[] = [];
      const session = definition.createSession();
      session.attach((message) => {
        messages.push(message);
      }, `test-${definition.id}`);

      await session.open(`test-${definition.id}`);

      expect(messages).toContainEqual(expect.objectContaining({ type: 'simulator_info' }));

      messages.length = 0;
      await session.dispatch({
        type: 'state_sync',
        payload: { ...emptyStateSync, model_id: definition.id },
      });

      expect(messages.some((message) => message.type === 'state_sync_begin')).toBe(true);
      expect(messages.some((message) => message.type === 'action_create')).toBe(true);
      expect(messages.some((message) => message.type === 'chart_create')).toBe(true);
      expect(messages.some((message) => message.type === 'env_create')).toBe(true);
      expect(messages.some((message) => message.type === 'item_create')).toBe(true);
      expect(messages.some((message) => message.type === 'state_sync_end')).toBe(true);
      for (const message of messages) expect(AnyProtocolMessageSchema.safeParse(message).success).toBe(true);

      messages.length = 0;
      await session.dispatch({ type: 'action_invoke', payload: { id: 'step', request_id: 'step-1' } });

      expect(messages.some((message) => message.type === 'metadata_update')).toBe(true);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'action_result',
          payload: expect.objectContaining({ id: 'step' }),
        }),
      );
      for (const message of messages) expect(AnyProtocolMessageSchema.safeParse(message).success).toBe(true);

      await session.close();
    });
  }

  it('accepted runtime parameter changes do not echo param_update for schelling', async () => {
    const messages: SimulatorToRendererMessage[] = [];
    const session = getJsExampleDefinition('schelling').createSession();
    session.attach((message) => {
      messages.push(message);
    }, 'test-schelling-param-change');

    await session.open('test-schelling-param-change');

    messages.length = 0;
    await session.dispatch({
      type: 'param_change',
      payload: { id: 'similarityThreshold', value: 0.55 },
    });

    expect(messages.some((message) => message.type === 'param_update')).toBe(false);

    await session.close();
  });

  it('accepted runtime parameter changes do not echo param_update for wolf-sheep', async () => {
    const messages: SimulatorToRendererMessage[] = [];
    const session = getJsExampleDefinition('wolf-sheep').createSession();
    session.attach((message) => {
      messages.push(message);
    }, 'test-wolf-sheep-param-change');

    await session.open('test-wolf-sheep-param-change');

    messages.length = 0;
    await session.dispatch({
      type: 'param_change',
      payload: { id: 'showEnergy', value: true },
    });

    expect(messages.some((message) => message.type === 'param_update')).toBe(false);

    await session.close();
  });

  it('uses binding-owned checkpoint encoding and declarative restore in schelling', async () => {
    const messages: SimulatorToRendererMessage[] = [];
    const session = getJsExampleDefinition('schelling').createSession();
    session.attach((message) => {
      messages.push(message);
    }, 'test-schelling-restore');
    await session.open('test-schelling-restore');
    await session.dispatch({
      type: 'state_sync',
      payload: { ...emptyStateSync, model_id: 'schelling' },
    });

    const initialAgents = messages.find((message) => {
      if (message.type !== 'item_create') return false;
      const payload = message.payload as { env_id: string; layer_id: string };
      return payload.env_id === 'main' && payload.layer_id === 'agents';
    });
    expect(initialAgents?.type).toBe('item_create');
    const items = (initialAgents?.payload as { items: Array<Record<string, ProtocolValue>> }).items;

    messages.length = 0;
    await session.dispatch({ type: 'scene_capture', payload: { request_id: 'capture-schelling' } });
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'scene_capture_result',
      payload: expect.objectContaining({
        request_id: 'capture-schelling',
        checkpoint: expect.objectContaining({ encoding: 'application/msgpack' }),
      }),
    }));

    messages.length = 0;
    await session.dispatch({
      type: 'scene_restore',
      payload: {
        request_id: 'restore-schelling',
        model_id: 'schelling',
        state_schema_version: '1',
        time: 12,
        envs: [{
          id: 'main',
          type: '2d',
          layers: [{
            layer_id: 'agents',
            layer_type: 'agent',
            metadata: { width: 50, height: 50 },
            items: items.slice(0, 2),
          }, {
            layer_id: 'grid',
            layer_type: 'grid',
            metadata: { width: 50, height: 50 },
          }],
        }],
      },
    });

    expect(messages[0]).toEqual({ type: 'scene_restore_begin', payload: { request_id: 'restore-schelling' } });
    expect(messages[messages.length - 1]).toEqual({ type: 'scene_restore_end', payload: { request_id: 'restore-schelling', status: 'ok' } });
    expect(messages).toContainEqual({ type: 'metadata_update', payload: { time: 12 } });
    expect(messages.some((message) => message.type.startsWith('chart_'))).toBe(false);
    expect(messages.some((message) => message.type === 'monitor_create')).toBe(false);
    expect(messages.some((message) => message.type === 'monitor_update')).toBe(true);
    await session.close();
  });

  it('restores the complete declarative culture grid in axelrod', async () => {
    const messages: SimulatorToRendererMessage[] = [];
    const session = getJsExampleDefinition('axelrod').createSession();
    session.attach((message) => {
      messages.push(message);
    }, 'test-axelrod-restore');
    await session.open('test-axelrod-restore');
    await session.dispatch({
      type: 'state_sync',
      payload: { ...emptyStateSync, model_id: 'axelrod' },
    });
    const initialAgents = messages.find((message) => {
      if (message.type !== 'item_create') return false;
      const payload = message.payload as { env_id: string; layer_id: string };
      return payload.env_id === 'main' && payload.layer_id === 'culture';
    });
    expect(initialAgents?.type).toBe('item_create');
    const items = (initialAgents?.payload as { items: Array<Record<string, ProtocolValue>> }).items;

    messages.length = 0;
    await session.dispatch({
      type: 'scene_restore',
      payload: {
        request_id: 'restore-axelrod',
        model_id: 'axelrod',
        state_schema_version: '1',
        time: 4,
        envs: [{
          id: 'main',
          type: '2d',
          layers: [{
            layer_id: 'culture',
            layer_type: 'agent',
            metadata: { width: 40, height: 40, total_updates: 0 },
            items,
          }],
        }],
      },
    });

    expect(messages[messages.length - 1]).toEqual({ type: 'scene_restore_end', payload: { request_id: 'restore-axelrod', status: 'ok' } });
    expect(messages).toContainEqual({ type: 'metadata_update', payload: { time: 4 } });
    expect(messages.some((message) => message.type.startsWith('chart_'))).toBe(false);
    expect(messages.some((message) => message.type === 'monitor_create')).toBe(false);
    expect(messages.some((message) => message.type === 'monitor_update')).toBe(true);
    await session.close();
  });
});
