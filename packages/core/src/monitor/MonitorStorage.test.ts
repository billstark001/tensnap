import { describe, expect, it } from 'vitest';
import { Scenario } from '../scenario';
import { MonitorStorage } from './MonitorStorage';

describe('MonitorStorage', () => {
  it('keeps one replace-only current value and round-trips it through Scenario snapshots', () => {
    const monitors = new MonitorStorage();
    monitors.create({ id: 'health', label: 'Health', render_hint: 'table' });
    monitors.update({ id: 'health', value: { susceptible: 10 }, revision: '1' });
    monitors.update({ id: 'health', value: { susceptible: 9 }, revision: '2' });

    expect(monitors.get('health')).toMatchObject({ value: { susceptible: 9 }, revision: '2' });
    expect(() => monitors.create({ id: 'health', label: 'Duplicate' })).toThrow(/already exists/);
    expect(() => monitors.update({ id: 'missing', value: null })).toThrow(/does not exist/);

    const scenario = new Scenario();
    scenario.apply({ type: 'monitor_create', payload: { id: 'health', label: 'Health' } });
    scenario.apply({ type: 'monitor_update', payload: { id: 'health', value: ['ok'], revision: 3 } });
    const restored = new Scenario();
    restored.load(scenario.dump());
    expect(restored.monitors.get('health')).toMatchObject({ value: ['ok'], revision: 3 });
  });
});
