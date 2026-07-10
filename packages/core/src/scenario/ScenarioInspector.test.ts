import { describe, expect, it } from 'vitest';
import { Scenario } from './Scenario';
import { ScenarioInspector } from './ScenarioInspector';

function message(type: string, payload: unknown) {
  return { type, payload } as any;
}

function createSpatialScenario(graph = false): Scenario {
  const scenario = new Scenario();
  scenario.apply(message('env_create', { id: 'world', type: '2d' }));
  scenario.apply(message('env_layer_create', {
    env_id: 'world', layer_id: 'agents', layer_type: 'agent', data: {
      width: 100,
      height: 100,
      ...(graph ? { uses_graph_interaction: true } : {}),
    },
  }));
  scenario.apply(message('env_layer_create', {
    env_id: 'world', layer_id: 'trails', layer_type: 'trajectory', dependency_layer_ids: { agent: 'agents' },
  }));
  scenario.apply(message('env_layer_create', {
    env_id: 'world', layer_id: 'edges', layer_type: 'edge', dependency_layer_ids: { agent: 'agents' },
  }));
  scenario.apply(message('item_create', {
    env_id: 'world', layer_id: 'agents', items: [
      { id: 'target', x: 5, y: 5 },
      { id: 'near', x: 7, y: 5 },
      { id: 'far', x: 30, y: 30 },
    ],
  }));
  scenario.apply(message('item_create', {
    env_id: 'world', layer_id: 'edges', items: [
      { source: 'target', target: 'near' },
      { source: 'target', target: 'far' },
    ],
  }));
  return scenario;
}

describe('ScenarioInspector', () => {
  it('resolves a stable ref at read time and builds a spatial neighbourhood snapshot', () => {
    const scenario = createSpatialScenario(true);
    const inspector = new ScenarioInspector(scenario);

    const inspection = inspector.inspect({ environmentId: 'world', layerId: 'agents', agentId: 'target' }, { radius: 3 });

    expect(inspection).toMatchObject({
      kind: 'graph',
      neighborCount: 2,
      viewport: expect.any(Object),
    });
    // An edge layer marks this as a graph scene, so inspection deliberately
    // exposes the ego graph rather than starting a second force layout.
    expect(inspection?.kind === 'graph' && inspection.neighbors.map((agent) => agent.id)).toEqual(['near', 'far']);
    expect(inspection?.kind === 'graph' && inspection.renderSnapshot.environments[0].layers
      .find((layer) => layer.id === 'agents')?.storageSnapshot).toMatchObject({
      agents: [{ id: 'target' }, { id: 'near' }, { id: 'far' }],
    });

    scenario.apply(message('item_update', {
      env_id: 'world', layer_id: 'agents', items: [{ id: 'target', x: 9, y: 8 }],
    }));
    const fresh = inspector.inspect({ environmentId: 'world', layerId: 'agents', agentId: 'target' });
    expect(fresh?.agent).toMatchObject({ x: 9, y: 8 });
  });

  it('uses a radius viewport and filters agents/edges for non-graph 2D scenes', () => {
    const scenario = createSpatialScenario();
    scenario.apply(message('env_layer_delete', { env_id: 'world', layer_id: 'edges' }));

    const inspection = new ScenarioInspector(scenario).inspect(
      { environmentId: 'world', layerId: 'agents', agentId: 'target' },
      { radius: 3 },
    );

    expect(inspection).toMatchObject({
      kind: 'spatial',
      neighborCount: 1,
      viewport: { x: 2.5, y: 2.5, width: 6, height: 6 },
    });
    expect(inspection?.kind === 'spatial' && inspection.edges).toEqual([]);
    expect(inspection?.kind === 'spatial' && inspection.renderSnapshot.environments[0].layers
      .find((layer) => layer.id === 'agents')?.storageSnapshot).toMatchObject({
      agents: [{ id: 'target' }, { id: 'near' }],
    });
  });

  it('reports no spatial context for uniform environments', () => {
    const scenario = new Scenario();
    scenario.apply(message('env_create', { id: 'uniform', type: 'uniform' }));
    scenario.apply(message('env_layer_create', { env_id: 'uniform', layer_id: 'agents', layer_type: 'agent' }));
    scenario.apply(message('item_create', { env_id: 'uniform', layer_id: 'agents', items: [{ id: 1 }] }));

    expect(new ScenarioInspector(scenario).inspect({ environmentId: 'uniform', layerId: 'agents', agentId: 1 }))
      .toMatchObject({ kind: 'none', reason: 'uniform-environment' });
  });

  it('avoids cloning a render snapshot for high-frequency live inspection', () => {
    const scenario = createSpatialScenario();
    const inspection = new ScenarioInspector(scenario).inspectLive(
      { environmentId: 'world', layerId: 'agents', agentId: 'target' },
      { radius: 3 },
    );

    expect(inspection).toMatchObject({ kind: 'spatial', neighborCount: 1 });
    expect(inspection).not.toHaveProperty('renderSnapshot');
  });

  it('uses the same coord offset as the rendered agent layer when centering a viewport', () => {
    const scenario = createSpatialScenario();
    scenario.apply(message('env_layer_delete', { env_id: 'world', layer_id: 'edges' }));
    const ref = { environmentId: 'world', layerId: 'agents', agentId: 'target' } as const;

    expect(new ScenarioInspector(scenario).inspectLive(ref, { radius: 3 }))
      .toMatchObject({ kind: 'spatial', viewport: { x: 2.5, y: 2.5, width: 6, height: 6 } });

    scenario.apply(message('env_layer_update', {
      env_id: 'world', layer_id: 'agents', data: { coord_offset: 'float' },
    }));
    expect(new ScenarioInspector(scenario).inspectLive(ref, { radius: 3 }))
      .toMatchObject({ kind: 'spatial', viewport: { x: 2, y: 2, width: 6, height: 6 } });
  });
});
