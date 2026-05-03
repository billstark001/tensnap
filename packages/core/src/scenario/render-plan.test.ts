import { describe, expect, it } from 'vitest';
import { collectRenderData, createRenderPlan, getRenderBuildKey } from './render-plan';
import type { ScenarioEnvironmentState } from './types';

function createEnvironment(layers: Array<Record<string, unknown>>): ScenarioEnvironmentState {
  return {
    id: 'env-1',
    type: '2d',
    layers: new Map(layers.map((layer) => [layer.id as string, {
      dependencyLayerIds: {},
      metadata: {},
      ...layer,
    } as any])),
    dependencyGraph: new Map(),
  };
}

describe('render plan', () => {
  it('derives graph interaction and trajectory config from dependency layers', () => {
    const agentStorage = { kind: 'agent-storage' };
    const edgeStorage = { kind: 'edge-storage' };
    const trajectoryStorage = { kind: 'trajectory-storage' };

    const environment = createEnvironment([
      {
        id: 'agents',
        layerType: 'agent',
        metadata: {},
        storage: agentStorage,
      },
      {
        id: 'edges',
        layerType: 'edge',
        metadata: { link_distance: 42 },
        storage: edgeStorage,
        dependencyLayerIds: { agent: 'agents' },
      },
      {
        id: 'trails',
        layerType: 'trajectory',
        metadata: {},
        storage: trajectoryStorage,
        dependencyLayerIds: { agent: 'agents' },
      },
    ]);

    const plan = createRenderPlan(environment);

    expect(plan.fitPadding).toBe(0.05);
    expect(plan.edgeLayers[0]).toMatchObject({
      layerId: 'edges',
      agentLayerId: 'agents',
      config: { link_distance: 42 },
    });
    expect(plan.trajectoryLayers[0]).toMatchObject({
      layerId: 'trails',
      agentLayerId: 'agents',
      coordOffset: 'float',
      worldBounds: undefined,
      zIndex: 30,
    });
    expect(plan.agentLayers[0]).toMatchObject({
      layerId: 'agents',
      coordOffset: 'float',
      originMode: 'center',
      usesGraphInteraction: true,
      sceneBounds: undefined,
      zIndex: 40,
    });
  });

  it('prefers registered scene bounds and includes storage identity in build keys', () => {
    const sharedStorage = { kind: 'agent-storage' };
    const environment = createEnvironment([
      {
        id: 'agents',
        layerType: 'agent',
        metadata: { coord_offset: 'int' },
        storage: sharedStorage,
      },
      {
        id: 'grid',
        layerType: 'grid',
        metadata: { width: 10, height: 12 },
        storage: { kind: 'grid-storage' },
      },
      {
        id: 'trails',
        layerType: 'trajectory',
        metadata: {},
        storage: { kind: 'trajectory-storage' },
        dependencyLayerIds: { agent: 'agents' },
      },
    ]);

    const plan = createRenderPlan(environment);
    const originalKey = getRenderBuildKey(environment);

    expect(plan.sceneBounds).toEqual({ width: 10, height: 12 });
    expect(plan.fitPadding).toBe(0);
    expect(plan.trajectoryLayers[0]).toMatchObject({
      coordOffset: 'int',
      worldBounds: { width: 10, height: 12 },
    });

    environment.layers.set('agents', {
      ...(environment.layers.get('agents') as any),
      storage: { kind: 'replacement-agent-storage' },
    });

    expect(getRenderBuildKey(environment)).not.toBe(originalKey);
  });

  it('collects snapshot render data and preserves per-layer coord offset', () => {
    const aggregated = collectRenderData({
      id: 'main',
      type: '2d',
      layers: [
        {
          id: 'agents-int',
          layerType: 'agent',
          metadata: { coord_offset: 'int' },
          dependencyLayerIds: {},
          storageSnapshot: { agents: [{ id: 'a', x: 0, y: 0 }], trajectories: [] },
        },
        {
          id: 'agents-float',
          layerType: 'agent',
          metadata: { coord_offset: 'float' },
          dependencyLayerIds: {},
          storageSnapshot: { agents: [{ id: 'b', x: 1, y: 1 }], trajectories: [] },
        },
      ],
    });

    expect(aggregated.agentLayers).toHaveLength(2);
    expect(aggregated.agentLayers.map((layer) => ({ id: layer.id, coordOffset: layer.coordOffset }))).toEqual([
      { id: 'agents-int', coordOffset: 'int' },
      { id: 'agents-float', coordOffset: 'float' },
    ]);
  });

  it('does not treat trajectory stroke width as environment width in collected render data', () => {
    const aggregated = collectRenderData({
      id: 'main',
      type: '2d',
      layers: [
        {
          id: 'grid',
          layerType: 'grid',
          metadata: { width: 40, height: 40 },
          dependencyLayerIds: {},
          storageSnapshot: {},
        },
        {
          id: 'trails',
          layerType: 'trajectory',
          metadata: { width: 3, color: '#f59e0b' },
          dependencyLayerIds: {},
          storageSnapshot: {
            config: { length: 5, width: 3, color: '#f59e0b' },
            configs: [],
            trajectories: [],
          },
        },
      ],
    });

    expect(aggregated.width).toBe(40);
    expect(aggregated.height).toBe(40);
  });
});