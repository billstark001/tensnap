import type {
  AnyProtocolMessage,
  AssetSyncPayload,
  SimulatorToRendererMessage,
  StateSyncRequest,
} from '@tensnap/protocol';
import { describe, expect, it } from 'vitest';
import { modelBuilder } from './index';

const emptyStateSync: StateSyncRequest = {
  parameters: [],
  actions: [],
  envs: [],
  charts: [],
};

describe('modelBuilder', () => {
  it('creates a builder-driven session with lifecycle defaults and parameter refresh', async () => {
    const builder = modelBuilder({
      id: 'test-binding',
      name: 'Test Binding',
      description: 'test',
    }, {
      defaults: { speed: 1 },
      create(config) {
        return { tick: 0, speed: config.speed };
      },
      getConfig(model) {
        return { speed: model.speed };
      },
      time(model) {
        return model.tick;
      },
      step(model) {
        model.tick += model.speed;
        return model.tick < 3;
      },
      reset(model) {
        model.tick = 0;
      },
    });

    builder.numberParam('speed', {
      label: 'Speed',
      min: 1,
      max: 5,
      step: 1,
      get: (model) => model.speed,
      set(model, value) {
        model.speed = value;
      },
    });
    builder.env('main')
      .agentLayer('agents', {
        items: (model) => [{ id: 'agent-1', x: model.tick, y: 0 }],
      });
    builder.chart('count', {
      label: 'Count',
      color: '#2563eb',
      get: (model) => model.tick,
    });

    const binding = builder.build();
    const messages: AnyProtocolMessage[] = [];
    const session = binding.createSession();
    session.attach((message: SimulatorToRendererMessage) => {
      messages.push(message as AnyProtocolMessage);
    }, 'test-binding');

    await session.open('test-binding');

    expect(binding.id).toBe('test-binding');
    expect(messages.some((message) => message.type === 'action_create')).toBe(true);
    expect(messages.some((message) => message.type === 'item_create')).toBe(true);
    expect(messages.some((message) => message.type === 'metadata_update')).toBe(true);

    messages.length = 0;
    await session.dispatch({
      type: 'param_change',
      payload: { id: 'speed', value: 99 },
    });

    expect(messages).toContainEqual({
      type: 'param_update',
      payload: expect.objectContaining({ id: 'speed', value: 5 }),
    });

    messages.length = 0;
    await session.dispatch({
      type: 'action_start',
      payload: { id: 'start', continuous: true, tick_id: 'tick-1' },
    });

    expect(messages).toContainEqual({
      type: 'action_end',
      payload: expect.objectContaining({ id: 'start', tick_id: 'tick-1', continue: false }),
    });
    expect(messages.some((message) => message.type === 'item_update')).toBe(true);

    messages.length = 0;
    await session.dispatch({ type: 'state_sync', payload: emptyStateSync });

    expect(messages.some((message) => message.type === 'state_sync_begin')).toBe(true);
    expect(messages.some((message) => message.type === 'chart_create')).toBe(true);
    expect(messages.some((message) => message.type === 'state_sync_end')).toBe(true);

    await session.close();
  });

  it('publishes declared assets and serves missing data during asset_sync', async () => {
    const binding = modelBuilder({
      id: 'asset-binding',
      name: 'Asset Binding',
      description: 'Asset binding test.',
    }, {
      defaults: {},
      create() {
        return {};
      },
    })
      .asset('asset-1', {
        mime: 'text/plain',
        label: 'Greeting',
        data: 'hello',
      })
      .build();

    const messages: AnyProtocolMessage[] = [];
    const session = binding.createSession();
    session.attach((message: SimulatorToRendererMessage) => {
      messages.push(message as AnyProtocolMessage);
    }, 'asset-binding');

    await session.open('asset-binding');

    const assetMeta = messages.find((message) => message.type === 'asset_meta');
    expect(assetMeta).toBeTruthy();

    messages.length = 0;
    await session.dispatch({
      type: 'asset_sync',
      payload: { assets: {} } satisfies AssetSyncPayload,
    });

    expect(messages.some((message) => message.type === 'asset_data')).toBe(true);
    await session.close();
  });

  it('reset deletes previously synced items before replaying the reset state', async () => {
    const builder = modelBuilder({
      id: 'reset-binding',
      name: 'Reset Binding',
      description: 'Reset binding test.',
    }, {
      defaults: {},
      create() {
        return { tick: 0 };
      },
      time(model) {
        return model.tick;
      },
      step(model) {
        model.tick = 1;
      },
      reset(model) {
        model.tick = 0;
      },
    });

    builder.env('main')
      .agentLayer('agents', {
        items: (model) => [{ id: 'agent-1', x: model.tick, y: 0 }],
      });

    const messages: AnyProtocolMessage[] = [];
    const session = builder.build().createSession();
    session.attach((message: SimulatorToRendererMessage) => {
      messages.push(message as AnyProtocolMessage);
    }, 'reset-binding');

    await session.open('reset-binding');

    messages.length = 0;
    await session.dispatch({
      type: 'action_start',
      payload: { id: 'step', continuous: false },
    });

    expect(messages).toContainEqual({
      type: 'item_update',
      payload: expect.objectContaining({
        env_id: 'main',
        layer_id: 'agents',
      }),
    });

    messages.length = 0;
    await session.dispatch({
      type: 'action_start',
      payload: { id: 'reset', continuous: false },
    });

    const deleteIndex = messages.findIndex((message) => message.type === 'item_delete');
    const createIndex = messages.findIndex((message) => message.type === 'item_create');

    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(createIndex).toBeGreaterThan(deleteIndex);
    expect(messages[deleteIndex]).toEqual({
      type: 'item_delete',
      payload: {
        env_id: 'main',
        layer_id: 'agents',
        items: [{ id: 'agent-1' }],
      },
    });
    expect(messages[createIndex]).toEqual({
      type: 'item_create',
      payload: {
        env_id: 'main',
        layer_id: 'agents',
        items: [{ id: 'agent-1', x: 0, y: 0 }],
      },
    });

    await session.close();
  });

  it('declared layers send field-level updates only for changed existing items', async () => {
    const builder = modelBuilder({
      id: 'sync-items-binding',
      name: 'Sync Items Binding',
      description: 'Sync items binding test.',
    }, {
      defaults: {},
      create() {
        return { tick: 0, shouldMove: false };
      },
      step(model) {
        if (model.shouldMove) {
          model.tick += 1;
        }
        model.shouldMove = true;
      },
    });

    builder.env('main')
      .agentLayer('agents', {
        items: (model) => [
          { id: 'agent-1', x: model.tick, y: 0, color: 'red' },
          { id: 'agent-2', x: 10, y: 0, color: 'blue' },
        ],
      });

    const messages: AnyProtocolMessage[] = [];
    const session = builder.build().createSession();
    session.attach((message: SimulatorToRendererMessage) => {
      messages.push(message as AnyProtocolMessage);
    }, 'sync-items-binding');

    await session.open('sync-items-binding');

    messages.length = 0;
    await session.dispatch({
      type: 'action_start',
      payload: { id: 'step', continuous: false },
    });

    expect(messages.some((message) => message.type === 'item_update')).toBe(false);

    messages.length = 0;
    await session.dispatch({
      type: 'action_start',
      payload: { id: 'step', continuous: false },
    });

    expect(messages).toContainEqual({
      type: 'item_update',
      payload: {
        env_id: 'main',
        layer_id: 'agents',
        items: [{ id: 'agent-1', x: 1 }],
      },
    });

    await session.close();
  });
});
