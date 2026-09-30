import { Scenario } from '@tensnap/core';
import type { RandomWalkAgent } from './random-walk';

export function createAgentScenario(agents: readonly RandomWalkAgent[], worldSize: number): Scenario {
  const scenario = new Scenario();
  scenario.apply({ type: 'env_create', payload: { id: 'main', type: '2d' } });
  scenario.apply({
    type: 'env_layer_create',
    payload: {
      env_id: 'main',
      layer_id: 'agents',
      layer_type: 'agent',
      metadata: { width: worldSize, height: worldSize, coord_offset: 'float' },
    },
  });
  scenario.apply({ type: 'item_create', payload: { env_id: 'main', layer_id: 'agents', items: structuredClone(agents) as unknown as Array<Record<string, never>> } });
  return scenario;
}
