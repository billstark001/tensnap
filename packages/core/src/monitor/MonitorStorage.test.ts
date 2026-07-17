import { describe, expect, it, vi } from 'vitest';
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

  it('publishes only the changed monitor and keeps prior snapshots stable', () => {
    const monitors = new MonitorStorage();
    monitors.create({ id: 'health', label: 'Health' });
    monitors.create({ id: 'population', label: 'Population' });
    monitors.update({ id: 'health', value: { ready: false } });
    const before = monitors.getSnapshot('health')!;
    const healthListener = vi.fn();
    const populationListener = vi.fn();
    const collectionListener = vi.fn();
    monitors.subscribe('health', healthListener);
    monitors.subscribe('population', populationListener);
    monitors.subscribeAll(collectionListener);

    monitors.update({ id: 'health', value: { ready: true }, revision: 2 });

    expect(healthListener).toHaveBeenCalledOnce();
    expect(populationListener).not.toHaveBeenCalled();
    expect(collectionListener).not.toHaveBeenCalled();
    expect(before.value).toEqual({ ready: false });
    expect(monitors.getSnapshot('health')).toMatchObject({ value: { ready: true }, revision: 2 });
    expect(monitors.getRevision('health')).toBeGreaterThan(0);
  });

  it('isolates a 4 MiB monitor payload from unrelated 120 Hz observers', () => {
    const monitors = new MonitorStorage();
    monitors.create({ id: 'hot', label: 'Hot' });
    monitors.create({ id: 'cold', label: 'Cold' });
    const hotListener = vi.fn();
    const coldListener = vi.fn();
    const collectionListener = vi.fn();
    monitors.subscribe('hot', hotListener);
    monitors.subscribe('cold', coldListener);
    monitors.subscribeAll(collectionListener);

    const largeCustomData = 'x'.repeat(4 * 1024 * 1024);
    monitors.update({ id: 'hot', value: { largeCustomData, tick: 0 } });
    for (let tick = 1; tick <= 120; tick += 1) {
      monitors.update({ id: 'hot', value: { tick } });
    }

    expect(monitors.getSnapshot('hot')?.value).toEqual({ tick: 120 });
    expect(hotListener).toHaveBeenCalledTimes(121);
    expect(coldListener).not.toHaveBeenCalled();
    expect(collectionListener).not.toHaveBeenCalled();
  });
});
