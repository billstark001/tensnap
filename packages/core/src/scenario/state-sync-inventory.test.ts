import { describe, expect, it } from 'vitest';
import { Scenario } from './Scenario';
import { createStateSyncInventoryFromSnapshot } from './state-sync-inventory';

describe('state sync inventory', () => {
  it('projects the same definitions from live state and a project snapshot', () => {
    const scenario = new Scenario();
    scenario.apply({ type: 'action_create', payload: { id: 'step', label: 'Step' } });
    scenario.apply({
      type: 'param_create',
      payload: { id: 'speed', type: 'number', label: 'Speed', value: 2 },
    });
    scenario.apply({ type: 'env_create', payload: { id: 'world', type: '2d' } });
    scenario.apply({
      type: 'env_layer_create',
      payload: { env_id: 'world', layer_id: 'agents', layer_type: 'agent' },
    });
    scenario.apply({
      type: 'chart_create',
      payload: {
        id: 'population',
        label: 'Population',
        data_list: [{ id: 'alive', label: 'Alive' }],
      },
    });
    scenario.apply({
      type: 'monitor_create',
      payload: { id: 'count', label: 'Count', render_hint: 'number' },
    });
    scenario.apply({ type: 'monitor_update', payload: { id: 'count', value: 3 } });

    const live = scenario.createStateSyncMessage('model', 'sync').payload;
    const saved = createStateSyncInventoryFromSnapshot(scenario.dump());

    expect(saved).toEqual({
      parameters: live.parameters,
      actions: live.actions,
      envs: live.envs,
      charts: live.charts,
      monitors: live.monitors,
    });
    expect(saved.charts).toEqual([{ id: 'alive', label: 'Alive' }]);
    expect(saved.monitors).toEqual([{ id: 'count', label: 'Count', render_hint: 'number' }]);
  });
});
