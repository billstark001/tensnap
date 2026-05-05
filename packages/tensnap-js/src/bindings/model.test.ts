import type {
  AnyProtocolMessage,
  AssetSyncPayload,
  SimulatorToRendererMessage,
  StateSyncRequest,
} from '@tensnap/core';
import { describe, expect, it } from 'vitest';
import {
  defineCharts,
  defineExample,
  defineEnvironment,
  defineLayer,
  defineModel,
  defineParameters,
} from './index';

const emptyStateSync: StateSyncRequest = {
  parameters: [],
  actions: [],
  envs: [],
  charts: [],
};

describe('defineModel', () => {
  it('creates a declarative session with lifecycle defaults and parameter refresh', async () => {
    const binding = defineExample({
      id: 'test-binding',
      name: 'Test Binding',
      description: 'test',
    }, {
      defaults: { speed: 1 },
      parameters: (config) => defineParameters({
        id: 'speed',
        type: 'number',
        label: 'Speed',
        value: config.speed,
        min: 1,
        max: 5,
        step: 1,
        allowRuntimeChange: true,
      }),
      environments: [
        defineEnvironment({
          id: 'main',
          type: '2d',
          layers: [defineLayer({ layerId: 'agents', layerType: 'agent' })],
        }),
      ],
      charts: defineCharts({ id: 'count', label: 'Count', color: '#2563eb' }),
      create(config) {
        return { tick: 0, speed: config.speed };
      },
      getConfig(model) {
        return { speed: model.speed };
      },
      async sync(model, ctx) {
        await ctx.setTime(model.tick);
        await ctx.syncItems('main', 'agents', [{ id: 'agent-1', x: model.tick, y: 0 }]);
        await ctx.setChartValues({ count: model.tick }, model.tick);
      },
      async step(model, ctx) {
        model.tick += model.speed;
        await ctx.setTime(model.tick);
        await ctx.syncItems('main', 'agents', [{ id: 'agent-1', x: model.tick, y: 0 }]);
        await ctx.setChartValues({ count: model.tick }, model.tick);
        return model.tick < 3;
      },
      async reset(model, ctx) {
        model.tick = 0;
        await ctx.sync();
        await ctx.clearAllCharts();
      },
      async onParameterChange(model, payload, ctx) {
        if (payload.id !== 'speed' || typeof payload.value !== 'number') {
          return;
        }
        model.speed = payload.value;
        await ctx.refreshParameters(payload.id);
      },
    });

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
      payload: { id: 'speed', value: 2 },
    });

    expect(messages).toContainEqual({
      type: 'param_update',
      payload: expect.objectContaining({ id: 'speed', value: 2 }),
    });

    messages.length = 0;
    await session.dispatch({
      type: 'action_start',
      payload: { id: 'start', continuous: true },
    });

    expect(messages).toContainEqual({
      type: 'action_end',
      payload: { id: 'start', continue: true },
    });
    expect(messages.some((message) => message.type === 'item_update')).toBe(true);

    messages.length = 0;
    await session.dispatch({ type: 'state_sync', payload: emptyStateSync });

    expect(messages.some((message) => message.type === 'state_sync_begin')).toBe(true);
    expect(messages.some((message) => message.type === 'chart_create')).toBe(true);
    expect(messages.some((message) => message.type === 'state_sync_end')).toBe(true);

    await session.close();
  });

  it('publishes assets and serves missing data during asset_sync', async () => {
    const binding = defineModel({
      create() {
        return { published: false };
      },
      async sync(model, ctx) {
        if (model.published) {
          return;
        }
        model.published = true;
        await ctx.publishAsset('asset-1', 'text/plain', new TextEncoder().encode('hello'), 'Greeting');
      },
    });

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
});