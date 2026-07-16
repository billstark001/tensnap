import { describe, expect, it } from 'vitest';
import { Scenario } from '../scenario';
import { projectedRestoreChangesTopology, projectSnapshotForRestore } from './projected-restore';

describe('projectSnapshotForRestore', () => {
  it('exports only simulator-restorable layer state', () => {
    const projected = projectSnapshotForRestore({
      metadata: { time: 4 }, actions: [], parameters: [{ id: 'speed', label: 'Speed', type: 'number', value: 2 }], charts: [], monitors: [], logs: [], assets: [],
      environments: [{
        id: 'world', type: '2d', layers: [
          { id: 'grid', layerType: 'grid', metadata: { width: 4, height: 3 }, dependencyLayerIds: {}, storageSnapshot: { width: 4, height: 3 } },
          { id: 'agents', layerType: 'agent', metadata: {}, dependencyLayerIds: {}, storageSnapshot: { agents: [{ id: 'a', x: 1, y: 2, data: { ready: true } }] } },
          { id: 'trails', layerType: 'trajectory', metadata: {}, dependencyLayerIds: { agent: 'agents' }, storageSnapshot: { configs: [{ id: 'a', length: 10 }], trajectories: [{ id: 'a', points: [{ x: 1, y: 2 }] }] } },
        ],
      }],
    });
    expect(projected).toEqual({
      time: 4,
      parameters: [{ id: 'speed', value: 2 }],
      envs: [{ id: 'world', type: '2d', layers: [
        { layer_id: 'grid', layer_type: 'grid', metadata: { width: 4, height: 3 } },
        { layer_id: 'agents', layer_type: 'agent', metadata: {}, items: [{ id: 'a', x: 1, y: 2, data: { ready: true } }] },
        { layer_id: 'trails', layer_type: 'trajectory', dependency_layer_ids: { agent: 'agents' }, metadata: {}, items: [{ id: 'a', length: 10 }] },
      ] }],
    });
  });

  it('rejects custom layers without a lossless item exporter', () => {
    expect(() => projectSnapshotForRestore({
      metadata: {}, actions: [], parameters: [], charts: [], monitors: [], logs: [], assets: [],
      environments: [{ id: 'world', type: 'uniform', layers: [{ id: 'custom', layerType: 'sample.custom', metadata: {}, dependencyLayerIds: {}, storageSnapshot: {} }] }],
    })).toThrow('cannot be projected');
  });

  it('rejects duplicate built-in item keys and invalid dependency topology', () => {
    const base = {
      metadata: {}, actions: [], parameters: [], charts: [], monitors: [], logs: [], assets: [],
      environments: [{
        id: 'world', type: '2d' as const, layers: [
          { id: 'agents', layerType: 'agent', metadata: {}, dependencyLayerIds: {}, storageSnapshot: { agents: [{ id: 'a' }, { id: 'a' }] } },
        ],
      }],
    };
    expect(() => projectSnapshotForRestore(base)).toThrow('duplicate item key');

    expect(() => projectSnapshotForRestore({
      ...base,
      environments: [{
        id: 'world', type: '2d', layers: [
          { id: 'agents', layerType: 'agent', metadata: {}, dependencyLayerIds: {}, storageSnapshot: { agents: [] } },
          { id: 'edges', layerType: 'edge', metadata: {}, dependencyLayerIds: { agent: 'missing' }, storageSnapshot: { edges: [] } },
        ],
      }],
    })).toThrow('missing or non-agent layer');
  });

  it('compares the complete projected topology without accepting duplicate identities', () => {
    const scenario = new Scenario();
    scenario.apply({ type: 'env_create', payload: { id: 'world', type: '2d' } });
    scenario.apply({ type: 'env_layer_create', payload: { env_id: 'world', layer_id: 'agents', layer_type: 'agent' } });
    scenario.apply({ type: 'env_layer_create', payload: { env_id: 'world', layer_id: 'grid', layer_type: 'grid' } });

    expect(projectedRestoreChangesTopology(scenario, [{
      id: 'world',
      type: '2d',
      layers: [
        { layer_id: 'grid', layer_type: 'grid', metadata: {} },
        { layer_id: 'agents', layer_type: 'agent', metadata: {} },
      ],
    }])).toBe(false);

    expect(projectedRestoreChangesTopology(scenario, [])).toBe(true);
    expect(projectedRestoreChangesTopology(scenario, [{
      id: 'world',
      type: '2d',
      layers: [
        { layer_id: 'agents', layer_type: 'agent', metadata: {} },
        { layer_id: 'agents', layer_type: 'agent', metadata: {} },
      ],
    }])).toBe(true);
  });
});
