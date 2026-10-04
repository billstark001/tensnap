import { describe, it, expect, vi } from 'vitest';
import { Scenario } from './Scenario';
import { AgentStorage, BackgroundStorage, BaseStorage } from '../environment/storages';
import { EdgeStorage } from '../environment/storages/EdgeStorage';
import { TrajectoryStorage } from '../environment/storages/TrajectoryStorage';
import { registerLayerType } from './layer-registry';

// ── Helpers ───────────────────────────────────────────────────────────────────

function msg(type: string, payload: unknown) {
  return { type, payload } as any;
}

function setupEnvAndAgentLayer(s: Scenario, envId = 'env1', layerId = 'layer1') {
  s.apply(msg('env_create', { id: envId, type: '2d' }));
  s.apply(msg('env_layer_create', { env_id: envId, layer_id: layerId, layer_type: 'agent' }));
}

function setupEnvAndEdgeLayer(
  s: Scenario,
  envId = 'env1',
  edgeLayerId = 'items',
  agentLayerId = 'agents',
) {
  s.apply(msg('env_create', { id: envId, type: '2d' }));
  s.apply(msg('env_layer_create', { env_id: envId, layer_id: agentLayerId, layer_type: 'agent' }));
  s.apply(
    msg('env_layer_create', {
      env_id: envId,
      layer_id: edgeLayerId,
      layer_type: 'edge',
      dependency_layer_ids: { agent: agentLayerId },
    }),
  );
}

function setupEnvAndTrajectoryLayer(
  s: Scenario,
  envId = 'env1',
  agentLayerId = 'items',
  trajectoryLayerId = 'trails',
) {
  s.apply(msg('env_create', { id: envId, type: '2d' }));
  s.apply(msg('env_layer_create', { env_id: envId, layer_id: agentLayerId, layer_type: 'agent' }));
  s.apply(
    msg('env_layer_create', {
      env_id: envId,
      layer_id: trajectoryLayerId,
      layer_type: 'trajectory',
      dependency_layer_ids: { agent: agentLayerId },
      metadata: { length: 3, color: '#f00' },
    }),
  );
}

// ── Environment / Layer lifecycle ─────────────────────────────────────────────

describe('Scenario – environment and layer lifecycle', () => {
  it('env_create registers a new environment', () => {
    const s = new Scenario();
    s.apply(msg('env_create', { id: 'env1', type: '2d' }));
    expect(s.environments.has('env1')).toBe(true);
  });

  it('env_create rejects an existing environment until it is deleted', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'layer1',
        items: [{ id: 'stale' }],
      }),
    );

    expect(() => s.apply(msg('env_create', { id: 'env1', type: 'uniform' }))).toThrow(
      /env_create already exists/,
    );
    expect(s.environments.get('env1')!.layers.has('layer1')).toBe(true);
    s.apply(msg('env_delete', { id: 'env1' }));
    s.apply(msg('env_create', { id: 'env1', type: 'uniform' }));

    const environment = s.environments.get('env1')!;
    expect(environment.type).toBe('uniform');
    expect(environment.layers.size).toBe(0);
  });

  it('a duplicate env_create leaves the existing environment intact', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    const environment = s.environments.get('env1')!;

    expect(() => s.apply(msg('env_create', { id: 'env1', type: 'uniform' }))).toThrow(
      /env_create already exists/,
    );

    expect(s.environments.get('env1')).toBe(environment);
    expect(environment.type).toBe('2d');
    expect(environment.layers.has('layer1')).toBe(true);
  });

  it('env_layer_create registers a layer in the environment', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    const env = s.environments.get('env1')!;
    expect(env.layers.has('layer1')).toBe(true);
    expect(env.layers.get('layer1')!.layerType).toBe('agent');
  });

  it('env_layer_create for agent type creates AgentStorage', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    const layer = s.environments.get('env1')!.layers.get('layer1')!;
    expect(layer.storage).toBeInstanceOf(AgentStorage);
  });

  it('env_layer_create for edge type creates EdgeStorage', () => {
    const s = new Scenario();
    setupEnvAndEdgeLayer(s);
    const layer = s.environments.get('env1')!.layers.get('items')!;
    expect(layer.storage).toBeInstanceOf(EdgeStorage);
  });

  it('env_layer_create for trajectory type creates TrajectoryStorage', () => {
    const s = new Scenario();
    setupEnvAndTrajectoryLayer(s);
    const layer = s.environments.get('env1')!.layers.get('trails')!;
    expect(layer.storage).toBeInstanceOf(TrajectoryStorage);
    expect(layer.dependencyLayerIds).toEqual({ agent: 'items' });
  });

  it('recreates layer storage only after an explicit delete', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);

    const env = s.environments.get('env1')!;
    const originalLayer = env.layers.get('layer1')!;
    const originalStorage = originalLayer.storage as AgentStorage;

    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'layer1',
        items: [{ id: 'a1', x: 1, y: 2 }],
      }),
    );

    expect(() =>
      s.apply(
        msg('env_layer_create', {
          env_id: 'env1',
          layer_id: 'layer1',
          layer_type: 'agent',
          metadata: { coord_offset: 'float' },
        }),
      ),
    ).toThrow(/env_layer_create already exists/);
    expect(env.layers.get('layer1')).toBe(originalLayer);
    s.apply(msg('env_layer_delete', { env_id: 'env1', layer_id: 'layer1' }));
    s.apply(
      msg('env_layer_create', {
        env_id: 'env1',
        layer_id: 'layer1',
        layer_type: 'agent',
        metadata: { coord_offset: 'float' },
      }),
    );

    const refreshedLayer = env.layers.get('layer1')!;
    expect(refreshedLayer).not.toBe(originalLayer);
    expect(refreshedLayer.storage).not.toBe(originalStorage);
    expect(refreshedLayer.metadata).toEqual({ coord_offset: 'float' });
    expect((refreshedLayer.storage as AgentStorage).getAgentCount()).toBe(0);

    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'layer1',
        items: [{ id: 'a2', x: 3, y: 4 }],
      }),
    );

    expect((refreshedLayer.storage as AgentStorage).getData().agents.has('a1')).toBe(false);
    expect((refreshedLayer.storage as AgentStorage).getData().agents.get('a2')).toMatchObject({
      x: 3,
      y: 4,
    });
  });

  it('env_layer_update reuses storage', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    const layer = s.environments.get('env1')!.layers.get('layer1')!;
    const storage = layer.storage;

    s.apply(
      msg('env_layer_update', {
        env_id: 'env1',
        layer_id: 'layer1',
        metadata: { coord_offset: 'float' },
      }),
    );

    expect(s.environments.get('env1')!.layers.get('layer1')).toBe(layer);
    expect(layer.storage).toBe(storage);
    expect(layer.metadata).toEqual({ coord_offset: 'float' });
  });

  it('rejects duplicate source layers without disturbing dependents', () => {
    const s = new Scenario();
    setupEnvAndTrajectoryLayer(s);

    expect(() =>
      s.apply(
        msg('env_layer_create', {
          env_id: 'env1',
          layer_id: 'items',
          layer_type: 'agent',
        }),
      ),
    ).toThrow(/env_layer_create already exists/);
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'items',
        items: [{ id: 'a1', x: 1, y: 2 }],
      }),
    );

    const trajectories = s.environments.get('env1')!.layers.get('trails')!
      .storage as TrajectoryStorage;
    expect(trajectories.dump().trajectories[0]?.points).toEqual([
      { x: 1, y: 2, time: 0, color: '#f00' },
    ]);
  });

  it('env_layer_update does not mutate dependencyLayerIds', () => {
    const s = new Scenario();
    setupEnvAndTrajectoryLayer(s);

    s.apply(
      msg('env_layer_update', {
        env_id: 'env1',
        layer_id: 'trails',
        metadata: { dependency_layer_ids: { agent: 'other-items' }, length: 5 },
      } as any),
    );

    const layer = s.environments.get('env1')!.layers.get('trails')!;
    expect(layer.dependencyLayerIds).toEqual({ agent: 'items' });
    expect(layer.metadata).toMatchObject({ length: 5, color: '#f00' });
    expect(layer.metadata).not.toHaveProperty('dependency_layer_ids');
  });

  it('env_layer_delete removes the layer', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    s.apply(msg('env_layer_delete', { env_id: 'env1', layer_id: 'layer1' }));
    expect(s.environments.get('env1')!.layers.has('layer1')).toBe(false);
  });

  it('env_delete removes the environment', () => {
    const s = new Scenario();
    s.apply(msg('env_create', { id: 'env1', type: '2d' }));
    s.apply(msg('env_delete', { id: 'env1' }));
    expect(s.environments.has('env1')).toBe(false);
  });
});

// ── Agent CRUD ────────────────────────────────────────────────────────────────

describe('Scenario – item_create / item_update / item_delete', () => {
  it('item_create populates AgentStorage', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'layer1',
        items: [
          { id: 'a1', x: 10, y: 20 },
          { id: 'a2', x: 30, y: 40 },
        ],
      }),
    );
    const storage = s.environments.get('env1')!.layers.get('layer1')!.storage as AgentStorage;
    expect(storage.getData().agents.size).toBe(2);
    expect(storage.getData().agents.get('a1')).toMatchObject({ x: 10, y: 20 });
  });

  it('item_update changes agent fields', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    s.apply(
      msg('item_create', { env_id: 'env1', layer_id: 'layer1', items: [{ id: 'a1', x: 0 }] }),
    );
    s.apply(
      msg('item_update', { env_id: 'env1', layer_id: 'layer1', items: [{ id: 'a1', x: 99 }] }),
    );
    const storage = s.environments.get('env1')!.layers.get('layer1')!.storage as AgentStorage;
    expect(storage.getData().agents.get('a1')?.x).toBe(99);
  });

  it('item_create rejects matching identities without removing unrelated items', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'layer1',
        items: [
          { id: 'a1', x: 1, y: 2, color: '#f00' },
          { id: 'a2', x: 3 },
        ],
      }),
    );

    expect(() =>
      s.apply(
        msg('item_create', {
          env_id: 'env1',
          layer_id: 'layer1',
          items: [{ id: 'a1', x: 10 }],
        }),
      ),
    ).toThrow(/item_create already exists/);

    const storage = s.environments.get('env1')!.layers.get('layer1')!.storage as AgentStorage;
    expect(storage.getAgent('a1')).toMatchObject({ id: 'a1', x: 1, y: 2 });
    s.apply(msg('item_delete', { env_id: 'env1', layer_id: 'layer1', items: ['a1'] }));
    s.apply(
      msg('item_create', { env_id: 'env1', layer_id: 'layer1', items: [{ id: 'a1', x: 10 }] }),
    );
    expect(storage.getAgent('a1')).toEqual({ id: 'a1', x: 10 });
    expect(storage.getAgent('a2')).toMatchObject({ id: 'a2', x: 3 });
  });

  it('item_update merges fields for an existing identity', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'layer1',
        items: [{ id: 'a1', x: 1, y: 2 }],
      }),
    );

    s.apply(
      msg('item_update', {
        env_id: 'env1',
        layer_id: 'layer1',
        items: [{ id: 'a1', x: 10 }],
      }),
    );

    const storage = s.environments.get('env1')!.layers.get('layer1')!.storage as AgentStorage;
    expect(storage.getAgent('a1')).toMatchObject({ id: 'a1', x: 10, y: 2 });
  });

  it('item_delete removes the agent', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'layer1',
        items: [{ id: 'a1' }, { id: 'a2' }],
      }),
    );
    s.apply(msg('item_delete', { env_id: 'env1', layer_id: 'layer1', items: ['a1'] }));
    const storage = s.environments.get('env1')!.layers.get('layer1')!.storage as AgentStorage;
    expect(storage.getData().agents.has('a1')).toBe(false);
    expect(storage.getData().agents.has('a2')).toBe(true);
  });

  it('item_create emits item:create event', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    const listener = vi.fn();
    s.addEventListener('item:create', listener);
    s.apply(msg('item_create', { env_id: 'env1', layer_id: 'layer1', items: [{ id: 'a1' }] }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('item_create populates an agent layer through the generic route', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'layer1',
        items: [{ id: 'a1', x: 10, y: 20 }],
      }),
    );
    const storage = s.environments.get('env1')!.layers.get('layer1')!.storage as AgentStorage;
    expect(storage.getData().agents.get('a1')).toMatchObject({ x: 10, y: 20 });
  });

  it('item_delete accepts primitive keys for single-key layers', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'layer1',
        items: [{ id: 'a1' }, { id: 'a2' }],
      }),
    );

    s.apply(
      msg('item_delete', {
        env_id: 'env1',
        layer_id: 'layer1',
        items: ['a1'],
      }),
    );

    const storage = s.environments.get('env1')!.layers.get('layer1')!.storage as AgentStorage;
    expect(storage.getData().agents.has('a1')).toBe(false);
    expect(storage.getData().agents.has('a2')).toBe(true);
  });

  it('item_delete rejects mixed primitive and object keys', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    const diagnostics: Array<{ message: string }> = [];
    s.addEventListener('diagnostic', (event) =>
      diagnostics.push((event as CustomEvent<{ message: string }>).detail),
    );
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'layer1',
        items: [{ id: 'a1' }, { id: 'a2' }],
      }),
    );

    s.apply(
      msg('item_delete', {
        env_id: 'env1',
        layer_id: 'layer1',
        items: ['a1', { id: 'a2' }],
      } as { env_id: string; layer_id: string; items: Array<string | { id: string }> }),
    );

    const storage = s.environments.get('env1')!.layers.get('layer1')!.storage as AgentStorage;
    expect(storage.getData().agents.has('a1')).toBe(true);
    expect(storage.getData().agents.has('a2')).toBe(true);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('cannot mix') }),
      ]),
    );
  });

  it('agent updates append points into dependent trajectory layers', () => {
    const s = new Scenario();
    setupEnvAndTrajectoryLayer(s);
    s.apply(
      msg('item_create', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 0, y: 0 }] }),
    );
    s.apply(msg('metadata_update', { time: 5 }));
    s.apply(
      msg('item_update', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 1, y: 2 }] }),
    );

    const storage = s.environments.get('env1')!.layers.get('trails')!.storage as TrajectoryStorage;
    const points = storage.dump().trajectories[0]?.points ?? [];
    expect(points).toEqual([
      { x: 0, y: 0, time: 0, color: '#f00' },
      { x: 1, y: 2, time: 5, color: '#f00' },
    ]);
  });

  it('agent creates seed initial points into dependent trajectory layers', () => {
    const s = new Scenario();
    setupEnvAndTrajectoryLayer(s);
    s.apply(
      msg('item_create', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 0, y: 0 }] }),
    );

    const storage = s.environments.get('env1')!.layers.get('trails')!.storage as TrajectoryStorage;
    const points = storage.dump().trajectories[0]?.points ?? [];
    expect(points).toEqual([{ x: 0, y: 0, time: 0, color: '#f00' }]);
  });

  it('deleting then recreating an agent identity clears its previous trajectory', () => {
    const s = new Scenario();
    setupEnvAndTrajectoryLayer(s);
    s.apply(
      msg('item_create', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 0, y: 0 }] }),
    );
    s.apply(
      msg('item_update', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 1, y: 1 }] }),
    );

    s.apply(msg('item_delete', { env_id: 'env1', layer_id: 'items', items: ['a1'] }));
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'items',
        items: [{ id: 'a1', x: 10, y: 10 }],
      }),
    );

    const storage = s.environments.get('env1')!.layers.get('trails')!.storage as TrajectoryStorage;
    expect(storage.dump().trajectories[0]?.points).toEqual([
      { x: 10, y: 10, time: 0, color: '#f00' },
    ]);
  });

  it('trajectory layers backfill existing agent positions when created after agent items', () => {
    const s = new Scenario();
    s.apply(msg('env_create', { id: 'env1', type: '2d' }));
    s.apply(msg('env_layer_create', { env_id: 'env1', layer_id: 'items', layer_type: 'agent' }));
    s.apply(
      msg('item_create', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 0, y: 0 }] }),
    );
    s.apply(
      msg('env_layer_create', {
        env_id: 'env1',
        layer_id: 'trails',
        layer_type: 'trajectory',
        dependency_layer_ids: { agent: 'items' },
        metadata: { length: 3, color: '#f00' },
      }),
    );

    const storage = s.environments.get('env1')!.layers.get('trails')!.storage as TrajectoryStorage;
    const points = storage.dump().trajectories[0]?.points ?? [];
    expect(points).toEqual([{ x: 0, y: 0, time: 0, color: '#f00' }]);
  });

  it('generic item updates append points into dependent trajectory layers', () => {
    const s = new Scenario();
    setupEnvAndTrajectoryLayer(s);
    s.apply(
      msg('item_create', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 0, y: 0 }] }),
    );
    s.apply(msg('metadata_update', { time: 5 }));
    s.apply(
      msg('item_update', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 1, y: 2 }] }),
    );

    const storage = s.environments.get('env1')!.layers.get('trails')!.storage as TrajectoryStorage;
    const points = storage.dump().trajectories[0]?.points ?? [];
    expect(points).toEqual([
      { x: 0, y: 0, time: 0, color: '#f00' },
      { x: 1, y: 2, time: 5, color: '#f00' },
    ]);
  });

  it('agent deletes clear dependent trajectory items', () => {
    const s = new Scenario();
    setupEnvAndTrajectoryLayer(s);
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'trails',
        items: [{ id: 'a1', color: '#0f0' }],
      }),
    );
    s.apply(
      msg('item_create', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 0, y: 0 }] }),
    );
    s.apply(
      msg('item_update', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 1, y: 1 }] }),
    );
    s.apply(msg('item_delete', { env_id: 'env1', layer_id: 'items', items: ['a1'] }));

    const storage = s.environments.get('env1')!.layers.get('trails')!.storage as TrajectoryStorage;
    expect(storage.dump().configs).toEqual([]);
    expect(storage.dump().trajectories).toEqual([]);
  });

  it('retains a closed trajectory segment when an agent id is deleted and later reused', () => {
    const s = new Scenario();
    setupEnvAndTrajectoryLayer(s);
    s.apply(
      msg('env_layer_update', {
        env_id: 'env1',
        layer_id: 'trails',
        metadata: { on_agent_delete: 'retain' },
      }),
    );
    s.apply(
      msg('item_create', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 0, y: 0 }] }),
    );
    s.apply(msg('item_delete', { env_id: 'env1', layer_id: 'items', items: ['a1'] }));
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'items',
        items: [{ id: 'a1', x: 10, y: 10 }],
      }),
    );

    const storage = s.environments.get('env1')!.layers.get('trails')!.storage as TrajectoryStorage;
    expect(storage.dump().trajectories).toEqual([
      expect.objectContaining({
        id: 'a1',
        segments: [
          [{ x: 0, y: 0, time: 0, color: '#f00' }],
          [{ x: 10, y: 10, time: 0, color: '#f00' }],
        ],
      }),
    ]);
  });

  it('preserves trajectories across reconnect-style state-sync replay without appending points', () => {
    const s = new Scenario();
    setupEnvAndTrajectoryLayer(s);
    s.apply(
      msg('item_create', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 0, y: 0 }] }),
    );
    s.apply(msg('state_sync_begin', {}));
    s.apply(
      msg('item_update', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 5, y: 5 }] }),
    );
    s.apply(msg('state_sync_end', {}));

    const storage = s.environments.get('env1')!.layers.get('trails')!.storage as TrajectoryStorage;
    expect(storage.dump().trajectories[0]?.points).toEqual([
      { x: 0, y: 0, time: 0, color: '#f00' },
    ]);
  });

  it('clears trajectory points at state-sync begin when configured', () => {
    const s = new Scenario();
    setupEnvAndTrajectoryLayer(s);
    s.apply(
      msg('env_layer_update', {
        env_id: 'env1',
        layer_id: 'trails',
        metadata: { on_state_sync: 'clear' },
      }),
    );
    s.apply(
      msg('item_create', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 0, y: 0 }] }),
    );
    s.apply(msg('state_sync_begin', {}));
    s.apply(
      msg('item_update', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 5, y: 5 }] }),
    );
    s.apply(msg('state_sync_end', {}));

    const storage = s.environments.get('env1')!.layers.get('trails')!.storage as TrajectoryStorage;
    expect(storage.dump().trajectories).toEqual([]);
  });

  it('reconciles orphan trajectories once state-sync replay finishes', () => {
    const s = new Scenario();
    setupEnvAndTrajectoryLayer(s);
    s.apply(
      msg('item_create', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 0, y: 0 }] }),
    );
    const agents = s.environments.get('env1')!.layers.get('items')!.storage as AgentStorage;

    s.apply(msg('state_sync_begin', {}));
    agents.removeAgent('a1');
    s.apply(msg('state_sync_end', {}));

    const storage = s.environments.get('env1')!.layers.get('trails')!.storage as TrajectoryStorage;
    expect(storage.dump().trajectories).toEqual([]);
  });

  it('honours reset lifecycle defaults and preserves explicitly retained trajectory layers', () => {
    const clearScenario = new Scenario();
    setupEnvAndTrajectoryLayer(clearScenario);
    clearScenario.apply(
      msg('item_create', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 0, y: 0 }] }),
    );
    clearScenario.reset();
    expect(clearScenario.environments.size).toBe(0);

    const retainedScenario = new Scenario();
    setupEnvAndTrajectoryLayer(retainedScenario);
    retainedScenario.apply(
      msg('env_layer_update', {
        env_id: 'env1',
        layer_id: 'trails',
        metadata: { on_reset: 'preserve' },
      }),
    );
    retainedScenario.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'items',
        items: [{ id: 'a1', x: 0, y: 0 }],
      }),
    );
    retainedScenario.reset();

    const retainedLayer = retainedScenario.getEnvironment('env1')?.layers.get('trails');
    expect(retainedLayer?.storage).toBeInstanceOf(TrajectoryStorage);
    expect((retainedLayer?.storage as TrajectoryStorage).dump().trajectories[0]?.points).toEqual([
      { x: 0, y: 0, time: 0, color: '#f00' },
    ]);
  });

  it('routes dependent layer reactions through registered layer controllers', () => {
    const reactionSpy = vi.fn();

    registerLayerType({
      layer_type: 'test-probe',
      requiredDependencyLayerTypes: ['agent'],
      storageFactory: () => new BaseStorage<Record<string, unknown>, unknown>({}),
      controller: {
        onDependencyItemsChanged: (_context, change) => {
          if (change.kind !== 'update') {
            return;
          }
          reactionSpy(
            change.kind,
            change.sourceLayer.id,
            change.items.map((item) => item.id),
          );
        },
      },
    });

    const s = new Scenario();
    s.apply(msg('env_create', { id: 'env1', type: '2d' }));
    s.apply(msg('env_layer_create', { env_id: 'env1', layer_id: 'items', layer_type: 'agent' }));
    s.apply(
      msg('env_layer_create', {
        env_id: 'env1',
        layer_id: 'probe',
        layer_type: 'test-probe',
        dependency_layer_ids: { agent: 'items' },
      }),
    );

    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'items',
        items: [{ id: 'a1', x: 0, y: 0 }],
      }),
    );
    s.apply(
      msg('item_update', {
        env_id: 'env1',
        layer_id: 'items',
        items: [{ id: 'a1', x: 1, y: 2 }],
      }),
    );

    expect(reactionSpy).toHaveBeenCalledWith('update', 'items', ['a1']);
  });
});

// ── Edge CRUD ─────────────────────────────────────────────────────────────────

describe('Scenario – item_create / item_update / item_delete', () => {
  it('item_create populates EdgeStorage', () => {
    const s = new Scenario();
    setupEnvAndEdgeLayer(s);
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'items',
        items: [{ source: 'a', target: 'b' }],
      }),
    );
    const storage = s.environments.get('env1')!.layers.get('items')!.storage as EdgeStorage;
    expect(storage.getEdgeCount()).toBe(1);
    expect(storage.findEdge('a', 'b')).toBeDefined();
  });

  it('item_delete removes items by source/target pairs', () => {
    const s = new Scenario();
    setupEnvAndEdgeLayer(s);
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'items',
        items: [
          { source: 'a', target: 'b' },
          { source: 'c', target: 'd' },
        ],
      }),
    );
    s.apply(
      msg('item_delete', {
        env_id: 'env1',
        layer_id: 'items',
        items: [{ source: 'a', target: 'b' }],
      }),
    );
    const storage = s.environments.get('env1')!.layers.get('items')!.storage as EdgeStorage;
    expect(storage.getEdgeCount()).toBe(1);
    expect(storage.findEdge('c', 'd')).toBeDefined();
  });

  it('item_create populates an edge layer through the generic route', () => {
    const s = new Scenario();
    setupEnvAndEdgeLayer(s);
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'items',
        items: [{ source: 'a', target: 'b' }],
      }),
    );

    const storage = s.environments.get('env1')!.layers.get('items')!.storage as EdgeStorage;
    expect(storage.findEdge('a', 'b')).toBeDefined();
  });

  it('item_delete rejects primitive keys for multi-key layers', () => {
    const s = new Scenario();
    setupEnvAndEdgeLayer(s);
    const diagnostics: Array<{ message: string }> = [];
    s.addEventListener('diagnostic', (event) =>
      diagnostics.push((event as CustomEvent<{ message: string }>).detail),
    );
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'items',
        items: [{ source: 'a', target: 'b' }],
      }),
    );

    s.apply(
      msg('item_delete', {
        env_id: 'env1',
        layer_id: 'items',
        items: ['a'],
      }),
    );

    const storage = s.environments.get('env1')!.layers.get('items')!.storage as EdgeStorage;
    expect(storage.findEdge('a', 'b')).toBeDefined();
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('object keys') }),
      ]),
    );
  });
});

// ── Chart create semantics ───────────────────────────────────────────────────

describe('Scenario – chart_create', () => {
  it('requires an explicit delete before recreating a chart', () => {
    const s = new Scenario();
    s.apply(msg('chart_create', { id: 'population', label: 'Population' }));
    s.apply(msg('chart_update', { updates: [{ id: 'population', value: 3 }] }));
    expect(s.charts.getGroup('population')?.data).toHaveLength(1);

    expect(() =>
      s.apply(msg('chart_create', { id: 'population', label: 'Reset population' })),
    ).toThrow(/chart_create already exists/);
    expect(s.charts.getGroup('population')?.data).toHaveLength(1);
    s.apply(msg('chart_delete', { kind: 'group', id: 'population' }));
    s.apply(msg('chart_create', { id: 'population', label: 'Reset population' }));

    expect(s.charts.getGroup('population')?.label).toBe('Reset population');
    expect(s.charts.getGroup('population')?.data).toEqual([]);
  });

  it('duplicate chart_create preserves existing metadata and history', () => {
    const s = new Scenario();
    s.apply(msg('chart_create', { id: 'population', label: 'Population' }));
    s.apply(msg('chart_update', { updates: [{ id: 'population', value: 3 }] }));

    expect(() =>
      s.apply(msg('chart_create', { id: 'population', label: 'Updated population' })),
    ).toThrow(/chart_create already exists/);

    expect(s.charts.getGroup('population')?.label).toBe('Population');
    expect(s.charts.getGroup('population')?.data).toHaveLength(1);
  });
});

describe('Scenario – protocol identity rules', () => {
  it('preserves v0.2 create replacement when legacy rules are selected', () => {
    const s = new Scenario({ mutationRules: 'legacy' });
    setupEnvAndAgentLayer(s);
    s.apply(
      msg('item_create', { env_id: 'env1', layer_id: 'layer1', items: [{ id: 'a1', x: 1 }] }),
    );
    s.apply(
      msg('item_create', { env_id: 'env1', layer_id: 'layer1', items: [{ id: 'a1', x: 2 }] }),
    );
    const storage = s.environments.get('env1')!.layers.get('layer1')!.storage as AgentStorage;
    expect(storage.getAgent('a1')).toEqual({ id: 'a1', x: 2 });
    s.apply(msg('env_create', { id: 'env1', type: 'uniform' }));
    expect(s.environments.get('env1')?.layers.size).toBe(0);
  });

  it('rejects duplicate action and parameter creates and missing updates', () => {
    const s = new Scenario();
    const action = { id: 'step', label: 'Step' };
    const parameter = { id: 'speed', type: 'number', label: 'Speed', value: 1 };
    s.apply(msg('action_create', action));
    s.apply(msg('param_create', parameter));

    expect(() => s.apply(msg('action_create', { ...action, label: 'Other' }))).toThrow(
      /action_create already exists/,
    );
    expect(() => s.apply(msg('action_update', { id: 'missing', label: 'Missing' }))).toThrow(
      /action_update does not exist/,
    );
    expect(() => s.apply(msg('param_create', { ...parameter, value: 2 }))).toThrow(
      /param_create already exists/,
    );
    expect(() => s.apply(msg('param_update', { ...parameter, id: 'missing' }))).toThrow(
      /param_update does not exist/,
    );
    expect(s.actions.get('step')?.label).toBe('Step');
    expect(s.parameters.get('speed')?.value).toBe(1);
  });

  it('rejects missing layer updates and duplicate or missing item identities before mutating a batch', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    expect(() =>
      s.apply(
        msg('env_layer_update', {
          env_id: 'env1',
          layer_id: 'missing',
          metadata: {},
        }),
      ),
    ).toThrow(/env_layer_update does not exist/);
    expect(() =>
      s.apply(
        msg('item_create', {
          env_id: 'env1',
          layer_id: 'layer1',
          items: [{ id: 'a1' }, { id: 'a1' }],
        }),
      ),
    ).toThrow(/item_create repeats an identity/);

    const storage = s.environments.get('env1')!.layers.get('layer1')!.storage as AgentStorage;
    expect(storage.getAgentCount()).toBe(0);
    s.apply(
      msg('item_create', { env_id: 'env1', layer_id: 'layer1', items: [{ id: 'a1', x: 1 }] }),
    );
    expect(() =>
      s.apply(
        msg('item_create', {
          env_id: 'env1',
          layer_id: 'layer1',
          items: [{ id: 'a2' }, { id: 'a1' }],
        }),
      ),
    ).toThrow(/item_create already exists/);
    expect(storage.getAgent('a2')).toBeUndefined();
    expect(() =>
      s.apply(
        msg('item_update', {
          env_id: 'env1',
          layer_id: 'layer1',
          items: [
            { id: 'a1', x: 2 },
            { id: 'missing', x: 2 },
          ],
        }),
      ),
    ).toThrow(/item_update does not exist/);
    expect(storage.getAgent('a1')?.x).toBe(1);
  });

  it('keeps numeric and string agent identities distinct in one batch', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'layer1',
        items: [
          { id: 1, x: 1 },
          { id: '1', x: 2 },
        ],
      }),
    );
    const storage = s.environments.get('env1')!.layers.get('layer1')!.storage as AgentStorage;
    expect(storage.getAgent(1)?.x).toBe(1);
    expect(storage.getAgent('1')?.x).toBe(2);
    expect(() =>
      s.apply(
        msg('item_update', {
          env_id: 'env1',
          layer_id: 'layer1',
          items: [
            { id: 1, x: 3 },
            { id: 1, x: 4 },
          ],
        }),
      ),
    ).toThrow(/item_update repeats an identity/);
    expect(storage.getAgent(1)?.x).toBe(1);
  });

  it('validates composite edge keys before changing a mixed update batch', () => {
    const scenario = new Scenario();
    setupEnvAndEdgeLayer(scenario);
    scenario.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'items',
        items: [{ source: 'a', target: 'b', width: 1 }],
      }),
    );
    const storage = scenario.environments.get('env1')!.layers.get('items')!.storage as EdgeStorage;

    expect(() =>
      scenario.apply(
        msg('item_update', {
          env_id: 'env1',
          layer_id: 'items',
          items: [
            { source: 'a', target: 'b', width: 2 },
            { source: 'b', target: 'a', width: 3 },
          ],
        }),
      ),
    ).toThrow(/item_update does not exist/);
    expect(storage.findEdge('a', 'b')?.width).toBe(1);

    expect(() =>
      scenario.apply(
        msg('item_create', {
          env_id: 'env1',
          layer_id: 'items',
          items: [
            { source: 'b', target: 'a' },
            { source: 'a', target: 'b' },
          ],
        }),
      ),
    ).toThrow(/item_create already exists/);
    expect(storage.findEdge('b', 'a')).toBeUndefined();
  });
});

// ── Parameter handling ────────────────────────────────────────────────────────

describe('Scenario – param_create with sanitization', () => {
  it('stores parameter after param_create', () => {
    const s = new Scenario();
    s.apply(
      msg('param_create', {
        id: 'p1',
        type: 'number',
        label: 'P1',
        value: 5,
        min: 0,
        max: 10,
        step: 1,
      }),
    );
    expect(s.parameters.has('p1')).toBe(true);
  });

  it('sanitizes number parameter range (fills sensible step when 0)', () => {
    const s = new Scenario();
    // value=5, no min/max/step provided — range should be estimated
    s.apply(msg('param_create', { id: 'p1', type: 'number', label: '', value: 5 }));
    const p = s.parameters.get('p1') as any;
    expect(typeof p.min).toBe('number');
    expect(typeof p.max).toBe('number');
    expect(typeof p.step).toBe('number');
    expect(p.step).toBeGreaterThan(0);
  });

  it('sanitizes enum parameter: resets value if not in options', () => {
    const s = new Scenario();
    s.apply(
      msg('param_create', {
        id: 'e1',
        type: 'enum',
        label: '',
        value: 'missing',
        options: ['a', 'b', 'c'],
      }),
    );
    const p = s.parameters.get('e1') as any;
    expect(p.options).toContain(p.value);
  });

  it('sanitizes boolean parameter: coerces string to boolean', () => {
    const s = new Scenario();
    s.apply(msg('param_create', { id: 'b1', type: 'boolean', label: '', value: 'false' }));
    const p = s.parameters.get('b1') as any;
    expect(p.value).toBe(false);
  });

  it('sanitizes string parameter: coerces number to string', () => {
    const s = new Scenario();
    s.apply(msg('param_create', { id: 's1', type: 'string', label: '', value: 42 }));
    const p = s.parameters.get('s1') as any;
    expect(typeof p.value).toBe('string');
    expect(p.value).toBe('42');
  });

  it('param_sync updates value and re-sanitizes enum', () => {
    const s = new Scenario();
    s.apply(
      msg('param_create', { id: 'e1', type: 'enum', label: '', value: 'a', options: ['a', 'b'] }),
    );
    // sync to a valid value
    s.apply(msg('param_sync', { id: 'e1', value: 'b' }));
    expect((s.parameters.get('e1') as any).value).toBe('b');
  });

  it('param_sync with invalid enum value is reset to first option', () => {
    const s = new Scenario();
    s.apply(
      msg('param_create', { id: 'e1', type: 'enum', label: '', value: 'a', options: ['a', 'b'] }),
    );
    s.apply(msg('param_sync', { id: 'e1', value: 'invalid' }));
    expect((s.parameters.get('e1') as any).value).toBe('a');
  });

  it('rejects invalid optimistic parameter values without mutating local state', () => {
    const s = new Scenario();
    s.apply(
      msg('param_create', { id: 'e1', type: 'enum', label: '', value: 'a', options: ['a', 'b'] }),
    );

    expect(() => s.applyOptimisticParameterChange('e1', 'missing')).toThrow('Invalid value');
    expect((s.parameters.get('e1') as any).value).toBe('a');
  });

  it('param_delete removes parameter', () => {
    const s = new Scenario();
    s.apply(msg('param_create', { id: 'p1', type: 'boolean', label: '', value: true }));
    s.apply(msg('param_delete', { id: 'p1' }));
    expect(s.parameters.has('p1')).toBe(false);
  });
});

// ── dump / load round-trip ────────────────────────────────────────────────────

describe('Scenario – dump / load', () => {
  it('dump/load round-trips environment and agent state', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'layer1',
        items: [{ id: 'a1', x: 5, y: 10 }],
      }),
    );

    const snap = s.dump();
    const s2 = new Scenario();
    s2.load(snap);

    const storage = s2.environments.get('env1')!.layers.get('layer1')!.storage as AgentStorage;
    expect(storage).toBeInstanceOf(AgentStorage);
    expect(storage.getData().agents.get('a1')).toMatchObject({ x: 5, y: 10 });
  });

  it('dump/load round-trips edge state', () => {
    const s = new Scenario();
    setupEnvAndEdgeLayer(s);
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'items',
        items: [{ source: 'a', target: 'b' }],
      }),
    );

    const snap = s.dump();
    const s2 = new Scenario();
    s2.load(snap);

    const storage = s2.environments.get('env1')!.layers.get('items')!.storage as EdgeStorage;
    expect(storage).toBeInstanceOf(EdgeStorage);
    expect(storage.getEdgeCount()).toBe(1);
    expect(storage.findEdge('a', 'b')).toBeDefined();
  });

  it('dump/load round-trips trajectory state', () => {
    const s = new Scenario();
    setupEnvAndTrajectoryLayer(s);
    s.apply(
      msg('item_create', {
        env_id: 'env1',
        layer_id: 'trails',
        items: [{ id: 'a1', color: '#0f0' }],
      }),
    );
    s.apply(
      msg('item_create', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 1, y: 2 }] }),
    );
    s.apply(
      msg('item_update', { env_id: 'env1', layer_id: 'items', items: [{ id: 'a1', x: 2, y: 3 }] }),
    );

    const snap = s.dump();
    const s2 = new Scenario();
    s2.load(snap);

    const storage = s2.environments.get('env1')!.layers.get('trails')!.storage as TrajectoryStorage;
    expect(storage.dump().configs).toEqual([{ id: 'a1', color: '#0f0' }]);
    expect(storage.dump().trajectories).toHaveLength(1);
  });

  it('dump/load round-trips parameters', () => {
    const s = new Scenario();
    s.apply(msg('param_create', { id: 'p1', type: 'boolean', label: 'P1', value: true }));
    const snap = s.dump();
    const s2 = new Scenario();
    s2.load(snap);
    expect(s2.parameters.get('p1')).toMatchObject({ id: 'p1', value: true });
  });

  it('dump/load round-trips metadata', () => {
    const s = new Scenario();
    s.apply(msg('metadata_update', { title: 'test', time: 42 }));
    const snap = s.dump();
    const s2 = new Scenario();
    s2.load(snap);
    expect(s2.metadata).toMatchObject({ title: 'test', time: 42 });
  });

  it('loads pre-monitor snapshots as an empty monitor collection', () => {
    const s = new Scenario();
    const legacySnapshot = s.dump() as unknown as Record<string, unknown>;
    delete legacySnapshot.monitors;

    expect(() => new Scenario().load(legacySnapshot as any)).not.toThrow();
  });
});

// ── reset ─────────────────────────────────────────────────────────────────────

describe('Scenario – reset', () => {
  it('clears all state after reset', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    s.apply(msg('item_create', { env_id: 'env1', layer_id: 'layer1', items: [{ id: 'a1' }] }));
    s.apply(msg('param_create', { id: 'p1', type: 'boolean', label: '', value: true }));
    s.reset();
    expect(s.environments.size).toBe(0);
    expect(s.parameters.size).toBe(0);
  });

  it('emits reset event', () => {
    const s = new Scenario();
    const listener = vi.fn();
    s.addEventListener('reset', listener);
    s.reset();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ── createStateSyncMessage ────────────────────────────────────────────────────

describe('Scenario – createStateSyncMessage', () => {
  it('includes current environments and layers', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    const msg2 = s.createStateSyncMessage('model-1', 'sync-1');
    expect(msg2.type).toBe('state_sync');
    const envList = msg2.payload.envs;
    expect(envList).toHaveLength(1);
    expect(envList[0].layers).toHaveLength(1);
    expect(envList[0].layers[0].layer_type).toBe('agent');
  });

  it('includes the supplied request id for sync correlation', () => {
    const s = new Scenario();
    const msg2 = s.createStateSyncMessage('model-1', 'sync-1');
    expect(msg2.payload.request_id).toBe('sync-1');
  });

  it('does not expose live parameter objects through the sync request', () => {
    const scenario = new Scenario();
    scenario.apply(msg('param_create', { id: 'rate', type: 'number', label: 'Rate', value: 1 }));
    const request = scenario.createStateSyncMessage('model-1', 'sync-1');
    request.payload.parameters[0].value = 99;
    expect(scenario.getParameter('rate')?.value).toBe(1);
  });

  it('includes a request id for action correlation', () => {
    const s = new Scenario();
    const msg2 = s.createActionInvokeMessage('start', 'action-1', { continuous: true });
    expect(msg2.payload).toEqual({ id: 'start', continuous: true, request_id: 'action-1' });
  });
});

describe('Scenario – background assets', () => {
  it('clears invalidated assets and ignores late old data', async () => {
    const scenario = new Scenario();
    scenario.apply(msg('env_create', { id: 'env', type: '2d' }));
    scenario.apply(
      msg('env_layer_create', {
        env_id: 'env',
        layer_id: 'background',
        layer_type: 'background',
        metadata: { background: { asset_id: 'image' } },
      }),
    );
    const storage = scenario.getEnvironment('env')!.layers.get('background')!
      .storage as BackgroundStorage;
    const metadata = (hash: string) =>
      msg('asset_metadata', { assets: [{ id: 'image', hash, mime: 'image/png', size: 3 }] });
    const data = (hash: string) =>
      msg('asset_data', {
        id: 'image',
        hash,
        mime: 'image/png',
        data: new Uint8Array([1, 2, 3]),
      });

    scenario.apply(metadata('one'));
    scenario.apply(data('one'));
    await Promise.resolve();
    expect(storage.getData()?.kind).toBe('image');

    scenario.apply(metadata('two'));
    expect(storage.getData()).toBeNull();
    scenario.apply(data('one'));
    await Promise.resolve();
    expect(storage.getData()).toBeNull();
    scenario.apply(data('two'));
    await Promise.resolve();
    expect(storage.getData()?.kind).toBe('image');

    scenario.apply(msg('asset_delete', { ids: ['image'] }));
    expect(storage.getData()).toBeNull();
  });

  it('rebinds asset backgrounds after snapshot load and owns layer metadata', async () => {
    const source = new Scenario();
    source.apply(msg('env_create', { id: 'env', type: '2d' }));
    source.apply(
      msg('env_layer_create', {
        env_id: 'env',
        layer_id: 'background',
        layer_type: 'background',
        metadata: { background: { asset_id: 'image' } },
      }),
    );
    source.apply(
      msg('asset_metadata', { assets: [{ id: 'image', hash: 'one', mime: 'image/png', size: 3 }] }),
    );
    source.apply(
      msg('asset_data', {
        id: 'image',
        hash: 'one',
        mime: 'image/png',
        data: new Uint8Array([1, 2, 3]),
      }),
    );
    await Promise.resolve();
    const snapshot = source.dump();
    const restored = new Scenario();
    restored.load(snapshot);
    const layer = restored.getEnvironment('env')!.layers.get('background')!;
    const storage = layer.storage as BackgroundStorage;
    expect(storage.getData()).toMatchObject({
      kind: 'image',
      url: restored.assets.getUrl('image'),
    });

    (snapshot.environments[0].layers[0].metadata.background as { asset_id: string }).asset_id =
      'different';
    expect(layer.metadata.background).toEqual({ asset_id: 'image' });
    source.reset();
    restored.reset();
  });
});
