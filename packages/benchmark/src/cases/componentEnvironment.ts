import { Scenario } from '@tensnap/core';
import type { AgentRenderState, AgentStorage, EdgeStorage, TrajectoryStorage } from '@tensnap/core/environment';

export interface ComponentEnvironment {
  scenario: Scenario;
  agents: AgentStorage;
  edges?: EdgeStorage;
  trajectories?: TrajectoryStorage;
}

export function createComponentEnvironment(options: {
  agents: AgentRenderState[];
  width: number;
  height: number;
  display?: '2d' | 'uniform';
  grid?: boolean;
  edges?: Array<{ source: string; target: string }>;
  trajectory?: { length: number; width?: number; color?: string };
}): ComponentEnvironment {
  const scenario = new Scenario();
  const envType = options.display === 'uniform' ? 'uniform' : '2d';
  scenario.apply({ type: 'env_create', payload: { id: 'main', type: envType } });
  if (options.grid) {
    scenario.apply({
      type: 'env_layer_create',
      payload: { env_id: 'main', layer_id: 'grid', layer_type: 'grid', data: { width: options.width, height: options.height } },
    });
  }
  scenario.apply({
    type: 'env_layer_create',
    payload: {
      env_id: 'main', layer_id: 'agents', layer_type: 'agent',
      data: { width: options.width, height: options.height, coord_offset: options.grid ? 'int' : 'float' },
    },
  });
  scenario.apply({
    type: 'item_create',
    payload: { env_id: 'main', layer_id: 'agents', items: options.agents },
  });
  if (options.edges) {
    scenario.apply({
      type: 'env_layer_create',
      payload: {
        env_id: 'main', layer_id: 'edges', layer_type: 'edge',
        dependency_layer_ids: { agent: 'agents' },
      },
    });
    scenario.apply({
      type: 'item_create',
      payload: { env_id: 'main', layer_id: 'edges', items: options.edges },
    });
  }
  if (options.trajectory) {
    scenario.apply({
      type: 'env_layer_create',
      payload: {
        env_id: 'main', layer_id: 'trails', layer_type: 'trajectory',
        dependency_layer_ids: { agent: 'agents' }, data: options.trajectory,
      },
    });
    scenario.apply({
      type: 'item_create',
      payload: {
        env_id: 'main', layer_id: 'trails',
        items: options.agents.map((agent) => ({ id: agent.id })),
      },
    });
  }

  const env = scenario.environments.get('main')!;
  return {
    scenario,
    agents: env.layers.get('agents')!.storage as AgentStorage,
    edges: env.layers.get('edges')?.storage as EdgeStorage | undefined,
    trajectories: env.layers.get('trails')?.storage as TrajectoryStorage | undefined,
  };
}
