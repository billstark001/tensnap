import { expect, it, vi } from 'vitest';
import { Scenario } from './Scenario';
import { ScenarioInspector } from './ScenarioInspector';
import { createAgentInspectionView } from './inspection-view';
import type { AgentStorage, EdgeStorage, TrajectoryStorage } from '../environment';

it('projects an owned ego graph with only its edges, trajectories and referenced assets', async () => {
  const scenario = new Scenario();
  scenario.apply({ type: 'env_create', payload: { id: 'world', type: '2d' } });
  scenario.apply({
    type: 'env_layer_create',
    payload: { env_id: 'world', layer_id: 'agents', layer_type: 'agent' },
  });
  for (const [id, type] of [
    ['edges', 'edge'],
    ['trails', 'trajectory'],
  ] as const)
    scenario.apply({
      type: 'env_layer_create',
      payload: {
        env_id: 'world',
        layer_id: id,
        layer_type: type,
        dependency_layer_ids: { agent: 'agents' },
      },
    });
  scenario.apply({
    type: 'env_layer_create',
    payload: {
      env_id: 'world',
      layer_id: 'background',
      layer_type: 'background',
      metadata: { background: { asset_id: 'background' } },
    },
  });
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
  await scenario.assets.receiveData('background', 'svg-hash', 'image/svg+xml', svg);
  await scenario.assets.receiveData(
    'unused',
    'unused-hash',
    'text/plain',
    new TextEncoder().encode('unrelated'),
  );
  scenario.apply({
    type: 'item_create',
    payload: {
      env_id: 'world',
      layer_id: 'agents',
      items: [0, 1, 2, 3].map((id) => ({ id, x: id * 10, y: id })),
    },
  });
  scenario.apply({
    type: 'item_create',
    payload: {
      env_id: 'world',
      layer_id: 'edges',
      items: [
        { source: 0, target: 1 },
        { source: 2, target: 3 },
      ],
    },
  });
  scenario.apply({
    type: 'item_update',
    payload: { env_id: 'world', layer_id: 'agents', items: [{ id: 0, x: 1 }] },
  });
  const dump = vi.spyOn(scenario, 'dump').mockImplementation(() => {
    throw new Error('Full dump forbidden');
  });
  const inspection = new ScenarioInspector(scenario).inspectLive({
    environmentId: 'world',
    layerId: 'agents',
    agentId: 0,
  })!;
  const view = createAgentInspectionView(scenario, inspection);
  expect(view.scene.assets).toEqual([
    { meta: expect.objectContaining({ id: 'background' }), data: svg },
  ]);
  const received = new Scenario();
  received.load(view.scene);
  const layers = received.getEnvironment('world')!.layers;
  expect(
    (layers.get('agents')!.storage as AgentStorage).dump().agents.map((agent) => agent.id),
  ).toEqual([0, 1]);
  expect((layers.get('edges')!.storage as EdgeStorage).dump().edges).toEqual([
    { source: 0, target: 1 },
  ]);
  expect(
    (layers.get('trails')!.storage as TrajectoryStorage)
      .dump()
      .trajectories.map((entry) => entry.id),
  ).toEqual([0, 1]);
  const projected = view.scene.environments[0].layers.find((layer) => layer.id === 'agents')!
    .storageSnapshot as { agents: { x: number }[] };
  projected.agents[0].x = 999;
  expect(
    (scenario.getEnvironment('world')!.layers.get('agents')!.storage as AgentStorage).getAgent(0)!
      .x,
  ).toBe(1);
  expect(
    createAgentInspectionView(scenario, inspection, new Map([['background', 'svg-hash']])).scene
      .assets,
  ).toEqual([{ meta: scenario.assets.getMeta('background') }]);
  expect(dump).not.toHaveBeenCalled();
});
