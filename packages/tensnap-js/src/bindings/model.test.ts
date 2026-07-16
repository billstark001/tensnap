import type {
  AnyProtocolMessage,
  AssetSyncPayload,
  SimulatorToRendererMessage,
  StateSyncRequest,
} from '@tensnap/protocol';
import { describe, expect, it, vi } from 'vitest';
import { modelBuilder } from './index';

function emptyStateSync(modelId: string, requestId = 'sync-1'): StateSyncRequest {
  return {
    request_id: requestId,
    model_id: modelId,
  parameters: [],
  actions: [],
  envs: [],
  charts: [],
    monitors: [],
  };
}

async function initialize(session: { dispatch(message: { type: 'state_sync'; payload: StateSyncRequest }): Promise<void> }, modelId: string): Promise<void> {
  await session.dispatch({ type: 'state_sync', payload: emptyStateSync(modelId) });
}

describe('modelBuilder', () => {
  it('maps declarations to exact canonical v0.3 metadata without optional-field aliases', () => {
    const binding = modelBuilder({
      id: 'exact-output',
      name: 'Exact Output',
      description: 'mapping fixture',
      stateSchemaVersion: '1',
    }, {
      defaults: { speed: 2 },
      create(config) {
        return { config, tick: 0 };
      },
      getConfig(model) {
        return model.config;
      },
    })
      .numberParam('speed', {
        get: (model) => model.config.speed,
        set(model, value) {
          model.config.speed = value;
        },
      })
      .monitor('tick', { get: (model) => model.tick })
      .action('move', {
        scope: 'agent',
        kwargs: [
          { name: 'distance', type: 'integer', required: true, min: 1 },
          { name: 'mode', type: 'enum', options: ['walk', 'run'], default: 'walk' },
        ],
        run() {},
      })
      .build();

    expect(binding.createScenario()).toEqual({
      parameters: [{
        id: 'speed',
        type: 'number',
        label: 'Speed',
        value: 2,
        allow_runtime_change: true,
      }],
      actions: [
        { id: 'start', label: 'Start', continuous: true },
        { id: 'step', label: 'Step', continuous: false },
        { id: 'stop', label: 'Stop', continuous: false },
        { id: 'reset', label: 'Reset', continuous: false },
        {
          id: 'move',
          label: 'Move',
          scope: 'agent',
          kwargs: [
            { name: 'distance', type: 'integer', required: true, min: 1 },
            { name: 'mode', type: 'enum', options: ['walk', 'run'], default: 'walk' },
          ],
        },
      ],
      environments: [],
      charts: [],
      monitors: [{ id: 'tick', label: 'Tick' }],
    });
  });

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
    await initialize(session, 'test-binding');

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
      type: 'param_sync',
      payload: { id: 'speed', value: 5 },
    });

    messages.length = 0;
    await session.dispatch({
      type: 'param_change',
      payload: { id: 'speed', value: 3 },
    });
    expect(messages.some((message) => message.type === 'param_sync')).toBe(false);
    expect(messages.some((message) => message.type === 'param_update')).toBe(false);

    messages.length = 0;
    await session.dispatch({
      type: 'action_invoke',
      payload: { id: 'start', continuous: true, request_id: 'tick-1' },
    });

    expect(messages).toContainEqual({
      type: 'action_result',
      payload: expect.objectContaining({ id: 'start', request_id: 'tick-1', should_continue: false }),
    });
    expect(messages.some((message) => message.type === 'item_update')).toBe(true);

    messages.length = 0;
    await session.dispatch({ type: 'state_sync', payload: emptyStateSync('test-binding', 'sync-2') });

    expect(messages.some((message) => message.type === 'state_sync_begin')).toBe(true);
    expect(messages.some((message) => message.type === 'chart_create')).toBe(true);
    expect(messages.some((message) => message.type === 'state_sync_end')).toBe(true);

    await session.close();
  });

  it('updates enum option definitions without syncing accepted values', async () => {
    const builder = modelBuilder({
      id: 'enum-binding',
      name: 'Enum Binding',
      description: 'dynamic enum options test',
    }, {
      defaults: {},
      create() {
        return { mode: 'a', options: ['a', 'b'] };
      },
    });

    builder.enumParam('mode', {
      get: (model) => model.mode,
      options: (model) => model.options,
      set(model, value) {
        model.mode = value;
        if (value === 'b') {
          model.options = ['b', 'c'];
        }
      },
    });

    const messages: AnyProtocolMessage[] = [];
    const session = builder.build().createSession();
    session.attach((message: SimulatorToRendererMessage) => {
      messages.push(message as AnyProtocolMessage);
    }, 'enum-binding');

    await session.open('enum-binding');
    await initialize(session, 'enum-binding');

    messages.length = 0;
    await session.dispatch({
      type: 'param_change',
      payload: { id: 'mode', value: 'b' },
    });

    expect(messages.some((message) => message.type === 'param_sync')).toBe(false);
    expect(messages).toContainEqual({
      type: 'param_update',
      payload: expect.objectContaining({
        id: 'mode',
        value: 'b',
        options: ['b', 'c'],
      }),
    });

    messages.length = 0;
    await session.dispatch({
      type: 'param_change',
      payload: { id: 'mode', value: 'a' },
    });

    expect(messages).toContainEqual({
      type: 'param_sync',
      payload: { id: 'mode', value: 'b' },
    });

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
    await initialize(session, 'asset-binding');

    const assetMetadata = messages.find((message) => message.type === 'asset_metadata');
    expect(assetMetadata).toBeTruthy();

    messages.length = 0;
    await session.dispatch({
      type: 'asset_sync',
      payload: { assets: {} } satisfies AssetSyncPayload,
    });

    expect(messages.some((message) => message.type === 'asset_data')).toBe(true);
    await session.close();
  });

  it('declares background and trajectory layers', async () => {
    const builder = modelBuilder({
      id: 'layer-coverage-binding',
      name: 'Layer Coverage Binding',
      description: 'built-in layer coverage test',
    }, {
      defaults: {},
      create() {
        return {};
      },
    });

    builder.env('main')
      .backgroundLayer('background', {
        metadata: { background: 'asset://map', interpolation: 'nearest' },
      })
      .agentLayer('agents', {
        items: () => [{ id: 'agent-1', x: 0, y: 0 }],
      })
      .trajectoryLayer('trails', {
        dependencyLayerIds: { agent: 'agents' },
        metadata: { length: 20 },
      });

    const messages: AnyProtocolMessage[] = [];
    const session = builder.build().createSession();
    session.attach((message: SimulatorToRendererMessage) => {
      messages.push(message as AnyProtocolMessage);
    }, 'layer-coverage-binding');

    await session.open('layer-coverage-binding');
    await initialize(session, 'layer-coverage-binding');

    expect(messages).toContainEqual({
      type: 'env_layer_create',
      payload: expect.objectContaining({
        env_id: 'main',
        layer_id: 'background',
        layer_type: 'background',
      }),
    });
    expect(messages).toContainEqual({
      type: 'env_layer_create',
      payload: expect.objectContaining({
        env_id: 'main',
        layer_id: 'trails',
        layer_type: 'trajectory',
        dependency_layer_ids: { agent: 'agents' },
      }),
    });

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
    await initialize(session, 'reset-binding');

    messages.length = 0;
    await session.dispatch({
      type: 'action_invoke',
      payload: { id: 'step', continuous: false, request_id: 'action-1' },
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
      type: 'action_invoke',
      payload: { id: 'reset', continuous: false, request_id: 'action-2' },
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
    await initialize(session, 'sync-items-binding');

    messages.length = 0;
    await session.dispatch({
      type: 'action_invoke',
      payload: { id: 'step', continuous: false, request_id: 'action-1' },
    });

    expect(messages.some((message) => message.type === 'item_update')).toBe(false);

    messages.length = 0;
    await session.dispatch({
      type: 'action_invoke',
      payload: { id: 'step', continuous: false, request_id: 'action-2' },
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

  it('validates action scope, targets, and kwargs before running model code', async () => {
    const run = vi.fn();
    const binding = modelBuilder({
      id: 'action-validation',
      name: 'Action Validation',
      description: 'action validation fixture',
    }, {
      defaults: {},
      create() {
        return { agents: [{ id: 'a-1', x: 0, y: 0 }] };
      },
    })
      .env('main')
      .agentLayer('agents', { items: (model) => model.agents })
      .done()
      .action('move', {
        scope: 'agent',
        sync: false,
        kwargs: [
          { name: 'distance', type: 'integer', required: true, min: 1 },
          { name: 'mode', type: 'enum', options: ['walk', 'run'], default: 'walk' },
        ],
        run,
      })
      .build();
    const messages: AnyProtocolMessage[] = [];
    const session = binding.createSession();
    session.attach((message: SimulatorToRendererMessage) => {
      messages.push(message as AnyProtocolMessage);
    });
    await session.open();
    await initialize(session, 'action-validation');

    messages.length = 0;
    await session.dispatch({
      type: 'action_invoke',
      payload: { id: 'move', request_id: 'wrong-target', target: { type: 'agent', env_id: 'main', layer_id: 'agents', agent_id: 'missing' }, kwargs: { distance: 1 } },
    });
    expect(run).not.toHaveBeenCalled();
    expect(messages).toContainEqual({
      type: 'action_result',
      payload: { id: 'move', request_id: 'wrong-target', error: expect.objectContaining({ code: 'invalid_target' }) },
    });

    messages.length = 0;
    await session.dispatch({
      type: 'action_invoke',
      payload: { id: 'move', request_id: 'wrong-kwargs', target: { type: 'agent', env_id: 'main', layer_id: 'agents', agent_id: 'a-1' }, kwargs: { distance: 1.5 } },
    });
    expect(run).not.toHaveBeenCalled();
    expect(messages).toContainEqual({
      type: 'action_result',
      payload: { id: 'move', request_id: 'wrong-kwargs', error: expect.objectContaining({ code: 'invalid_kwargs' }) },
    });

    messages.length = 0;
    await session.dispatch({
      type: 'action_invoke',
      payload: { id: 'move', request_id: 'move-1', target: { type: 'agent', env_id: 'main', layer_id: 'agents', agent_id: 'a-1' }, kwargs: { distance: 2 } },
    });
    expect(run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ kwargs: { distance: 2, mode: 'walk' } }),
    );
    expect(messages).toContainEqual({
      type: 'action_result',
      payload: { id: 'move', request_id: 'move-1', should_continue: false },
    });
    await session.close();
  });

  it('advertises and exercises monitor and opt-in scene capabilities', async () => {
    let initCount = 0;
    let stopCount = 0;
    const binding = modelBuilder({
      id: 'scene-binding',
      name: 'Scene Binding',
      description: 'scene capability fixture',
      stateSchemaVersion: '1',
    }, {
      defaults: {},
      create() {
        return { tick: 0 };
      },
      init() {
        initCount += 1;
      },
      stop() {
        stopCount += 1;
      },
      sceneRestore: {
        mode: 'compose',
        restoreTime(model, time) {
          model.tick = time;
        },
      },
      restoreCheckpoint(model, checkpoint) {
        model.tick = checkpoint instanceof Uint8Array ? checkpoint[0]! : 0;
      },
      captureCheckpoint(model) {
        return new Uint8Array([model.tick]);
      },
      time(model) {
        return model.tick;
      },
    })
      .env('main')
      .agentLayer('agents', { items: () => [] })
      .done()
      .monitor('tick', { get: (model) => model.tick, renderHint: 'text' })
      .build();
    const messages: AnyProtocolMessage[] = [];
    const session = binding.createSession();
    session.attach((message: SimulatorToRendererMessage) => {
      messages.push(message as AnyProtocolMessage);
    });
    await session.open();

    expect(messages).toContainEqual({
      type: 'simulator_info',
      payload: expect.objectContaining({
        model: expect.objectContaining({ state_schema_version: '1' }),
        capabilities: expect.arrayContaining(['monitor', 'scene.restore.projected', 'scene.restore.checkpoint']),
      }),
    });

    await initialize(session, 'scene-binding');
    expect(initCount).toBe(1);
    expect(messages).toContainEqual({ type: 'monitor_create', payload: { id: 'tick', label: 'Tick', render_hint: 'text' } });
    expect(messages).toContainEqual({ type: 'monitor_update', payload: { id: 'tick', value: 0 } });

    messages.length = 0;
    await session.dispatch({ type: 'action_invoke', payload: { id: 'stop', request_id: 'stop-1' } });
    expect(stopCount).toBe(1);
    expect(messages).toContainEqual({ type: 'action_result', payload: { id: 'stop', request_id: 'stop-1', should_continue: false } });

    messages.length = 0;
    await session.dispatch({ type: 'action_invoke', payload: { id: 'reset', request_id: 'reset-1' } });
    expect(initCount).toBe(1);
    expect(messages).toContainEqual({ type: 'action_result', payload: { id: 'reset', request_id: 'reset-1', should_continue: false } });

    messages.length = 0;
    await session.dispatch({ type: 'scene_capture', payload: { request_id: 'capture-1' } });
    expect(messages).toContainEqual({
      type: 'scene_capture_result',
      payload: expect.objectContaining({
        request_id: 'capture-1',
        model_id: 'scene-binding',
        state_schema_version: '1',
        checkpoint: expect.objectContaining({ encoding: 'application/octet-stream', data: new Uint8Array([0]) }),
      }),
    });

    messages.length = 0;
    await session.dispatch({ type: 'scene_restore', payload: { request_id: 'restore-1', model_id: 'scene-binding', state_schema_version: '1', time: 7 } });
    expect(messages[0]).toEqual({ type: 'scene_restore_begin', payload: { request_id: 'restore-1' } });
    expect(messages[messages.length - 1]).toEqual({ type: 'scene_restore_end', payload: { request_id: 'restore-1', status: 'ok' } });
    expect(messages).toContainEqual({ type: 'metadata_update', payload: { time: 7 } });
    expect(messages.some((message) => message.type === 'chart_create' || message.type === 'chart_update')).toBe(false);

    messages.length = 0;
    await session.dispatch({
      type: 'scene_restore',
      payload: {
        request_id: 'restore-invalid',
        model_id: 'scene-binding',
        state_schema_version: '1',
        envs: [{
          id: 'main',
          type: '2d',
          layers: [{ layer_id: 'agents', layer_type: 'agent', items: [{ id: 'duplicate' }, { id: 'duplicate' }] }],
        }],
      },
    });
    expect(messages).toEqual([
      { type: 'scene_restore_begin', payload: { request_id: 'restore-invalid' } },
      {
        type: 'scene_restore_end',
        payload: {
          request_id: 'restore-invalid',
          status: 'rejected',
          error: expect.objectContaining({ code: 'invalid_scene_restore' }),
        },
      },
    ]);

    messages.length = 0;
    await session.dispatch({
      type: 'scene_restore',
      payload: { request_id: 'restore-stale', model_id: 'scene-binding', expected_instance_id: 'stale', time: 1 },
    });
    expect(messages).toEqual([
      { type: 'scene_restore_begin', payload: { request_id: 'restore-stale' } },
      {
        type: 'scene_restore_end',
        payload: {
          request_id: 'restore-stale',
          status: 'rejected',
          error: expect.objectContaining({ code: 'instance_mismatch' }),
        },
      },
    ]);

    await session.close();
    session.attach((message: SimulatorToRendererMessage) => {
      messages.push(message as AnyProtocolMessage);
    });
    await session.open();
    await initialize(session, 'scene-binding');
    expect(initCount).toBe(1);
    await session.close();
  });

  it('restores projected model state declaratively with complete layer CUD', async () => {
    const binding = modelBuilder({
      id: 'declarative-restore',
      name: 'Declarative Restore',
      description: 'complete CUD fixture',
    }, {
      defaults: { speed: 1 },
      create(config) {
        return {
          speed: config.speed,
          time: 1,
          agents: new Map([
            ['a', { id: 'a', x: 0, y: 0 }],
            ['gone', { id: 'gone', x: 1, y: 0 }],
          ]),
        };
      },
      getConfig(model) {
        return { speed: model.speed };
      },
      time(model) {
        return model.time;
      },
      sceneRestore: {
        mode: 'compose',
        restoreTime(model, time) {
          model.time = time;
        },
      },
    })
      .numberParam('speed', {
        get: (model) => model.speed,
        set(model, value) {
          model.speed = value;
        },
      })
      .env('main')
      .agentLayer('agents', {
        items: (model) => [...model.agents.values()],
        restore: {
          itemIds(model) {
            return [...model.agents.keys()].map((id) => ({ id }));
          },
          create(model, item) {
            model.agents.set(item.id as string, { id: item.id as string, x: item.x as number, y: item.y as number });
          },
          update(model, _key, item) {
            model.agents.set(item.id as string, { id: item.id as string, x: item.x as number, y: item.y as number });
          },
          delete(model, key) {
            const id = (key as { id: string }).id;
            model.agents.delete(id);
          },
        },
      })
      .done()
      .build();

    const messages: AnyProtocolMessage[] = [];
    const session = binding.createSession();
    session.attach((message: SimulatorToRendererMessage) => {
      messages.push(message as AnyProtocolMessage);
    });
    await session.open();
    await initialize(session, 'declarative-restore');
    messages.length = 0;

    await session.dispatch({
      type: 'scene_restore',
      payload: {
        request_id: 'restore-cud',
        model_id: 'declarative-restore',
        time: 9,
        parameters: [{ id: 'speed', value: 3 }],
        envs: [{
          id: 'main',
          type: '2d',
          layers: [{
            layer_id: 'agents',
            layer_type: 'agent',
            items: [
              { id: 'a', x: 4, y: 5 },
              { id: 'new', x: 6, y: 7 },
            ],
          }],
        }],
      },
    });

    expect(messages[0]).toEqual({ type: 'scene_restore_begin', payload: { request_id: 'restore-cud' } });
    expect(messages[messages.length - 1]).toEqual({ type: 'scene_restore_end', payload: { request_id: 'restore-cud', status: 'ok' } });
    expect(messages).toContainEqual({ type: 'metadata_update', payload: { time: 9 } });
    expect(messages).toContainEqual({
      type: 'item_create',
      payload: expect.objectContaining({
        env_id: 'main',
        layer_id: 'agents',
        items: expect.arrayContaining([
          expect.objectContaining({ id: 'a', x: 4, y: 5 }),
          expect.objectContaining({ id: 'new', x: 6, y: 7 }),
        ]),
      }),
    });
    expect(messages.some((message) => message.type.startsWith('chart_'))).toBe(false);
    await session.close();
  });

  it('requires paired checkpoint hooks and a state schema version', () => {
    expect(() => modelBuilder({ id: 'capture-only', name: 'Capture', description: 'invalid fixture' }, {
      defaults: {},
      create() { return {}; },
      captureCheckpoint() { return new Uint8Array(); },
    }).build()).toThrow(/restoreCheckpoint/);

    expect(() => modelBuilder({ id: 'missing-schema', name: 'Schema', description: 'invalid fixture' }, {
      defaults: {},
      create() { return {}; },
      restoreCheckpoint() {},
      captureCheckpoint() { return new Uint8Array(); },
    }).build()).toThrow(/stateSchemaVersion/);
  });

  it('rejects a mismatched state-sync model without initializing the instance', async () => {
    let initialized = 0;
    const binding = modelBuilder({ id: 'strict-model', name: 'Strict', description: 'strict sync fixture' }, {
      defaults: {},
      create() { return {}; },
      init() { initialized += 1; },
    }).build();
    const messages: AnyProtocolMessage[] = [];
    const session = binding.createSession();
    session.attach((message: SimulatorToRendererMessage) => {
      messages.push(message as AnyProtocolMessage);
    });
    await session.open();
    messages.length = 0;

    await initialize(session, 'other-model');
    expect(initialized).toBe(0);
    expect(messages).toEqual([{
      type: 'error',
      payload: { code: 'model_mismatch', message: 'Expected model strict-model.', request_id: 'sync-1' },
    }]);
    await session.close();
  });
});
