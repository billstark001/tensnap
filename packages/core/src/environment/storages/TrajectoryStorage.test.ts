import { describe, expect, it, vi } from 'vitest';
import { TrajectoryStorage } from './TrajectoryStorage';
import { DEFAULT_TRAJECTORY_CONFIG } from '../utils/trajectory';

describe('TrajectoryStorage – config items', () => {
  it('upsertConfigs stores per-agent config items', () => {
    const storage = new TrajectoryStorage();
    storage.upsertConfigs([{ id: 'a1', color: '#0f0', width: 3 }]);
    expect(storage.dump().configs).toEqual([{ id: 'a1', color: '#0f0', width: 3 }]);
  });

  it('deleteItems removes config items and trajectories together', () => {
    const storage = new TrajectoryStorage();
    storage.upsertConfigs([{ id: 'a1', color: '#0f0' }]);
    storage.appendTrajectoryPoint('a1', { x: 1, y: 2, time: 0 });
    storage.deleteItems(['a1']);

    expect(storage.dump().configs).toEqual([]);
    expect(storage.dump().trajectories).toEqual([]);
  });
});

describe('TrajectoryStorage – trajectory updates', () => {
  it('appendTrajectoryPoint stores points and resolves default color in dump', () => {
    const storage = new TrajectoryStorage({ color: '#123456' });
    storage.appendTrajectoryPoint('a1', { x: 1, y: 2, time: 5 });
    expect(storage.dump().trajectories).toEqual([
      { id: 'a1', points: [{ x: 1, y: 2, time: 5, color: '#123456' }] },
    ]);
  });

  it('setConfig refreshes cached entry limits and widths', () => {
    const storage = new TrajectoryStorage({ length: 5, width: 2, color: '#00f' });
    storage.appendTrajectoryPoint('a1', { x: 0, y: 0, time: 0 });
    storage.setConfig({ length: 2, width: 4 });

    const entry = storage.getEntry('a1');
    expect(entry?.limit).toBe(2);
    expect(entry?.width).toBe(4);
  });

  it('preserves core defaults when config updates omit width and color', () => {
    const storage = new TrajectoryStorage();

    storage.setConfig({ length: 7, width: undefined, color: undefined });
    storage.appendTrajectoryPoint('a1', { x: 0, y: 0, time: 0 });

    expect(storage.dump().config).toEqual({
      ...DEFAULT_TRAJECTORY_CONFIG,
      length: 7,
    });
    expect(storage.getEntry('a1')).toMatchObject({
      limit: 7,
      width: DEFAULT_TRAJECTORY_CONFIG.width,
      defaultColor: DEFAULT_TRAJECTORY_CONFIG.color,
    });
  });

  it('does not resize retained points when only width or color changes', () => {
    const storage = new TrajectoryStorage({ length: 5 });
    storage.appendTrajectoryPoint('a1', { x: 0, y: 0, time: 0 });
    storage.appendTrajectoryPoint('a1', { x: 1, y: 1, time: 1 });
    const activeSegment = storage.getEntry('a1')!.activeSegment;

    storage.setConfig({ width: 4, color: '#0f0' });

    expect(storage.getEntry('a1')!.activeSegment).toBe(activeSegment);
    expect(storage.dump().trajectories[0]?.points).toEqual([
      { x: 0, y: 0, time: 0, color: '#0f0' },
      { x: 1, y: 1, time: 1, color: '#0f0' },
    ]);
  });

  it('emits id-only deltas for append and delete operations', () => {
    const storage = new TrajectoryStorage();
    const listener = vi.fn();
    storage.subscribe(listener);

    storage.appendTrajectoryPoint('a1', { x: 0, y: 0, time: 0 });
    storage.deleteItems(['a1']);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0][1]).toMatchObject({ created: ['a1'] });
    expect(listener.mock.calls[1][1]).toMatchObject({ deleted: ['a1'] });
  });

  it('reports append and eviction deltas so renderers can update only the tail', () => {
    const storage = new TrajectoryStorage({ length: 1 });
    const listener = vi.fn();
    storage.subscribe(listener);

    storage.appendTrajectoryPoint('a1', { x: 0, y: 0, time: 0 });
    storage.appendTrajectoryPoint('a1', { x: 1, y: 0, time: 1 });

    expect(listener.mock.calls[1][1]).toMatchObject({
      appended: ['a1'],
      appendDeltas: [{
        id: 'a1',
        point: { x: 1, y: 0, time: 1 },
        evicted: { x: 0, y: 0, time: 0 },
        startedSegment: false,
      }],
    });
  });

  it('keeps retained id reuses as separate serializable segments', () => {
    const storage = new TrajectoryStorage({ length: 10 });
    storage.appendTrajectoryPoint('a1', { x: 0, y: 0, time: 0 });
    storage.appendTrajectoryPoint('a1', { x: 1, y: 0, time: 1 });
    storage.closeTrajectory('a1');
    storage.appendTrajectoryPoint('a1', { x: 10, y: 10, time: 2 });
    storage.appendTrajectoryPoint('a1', { x: 11, y: 10, time: 3 });

    const snapshot = storage.dump();
    expect(snapshot.trajectories[0]?.segments).toEqual([
      [
        { x: 0, y: 0, time: 0, color: DEFAULT_TRAJECTORY_CONFIG.color },
        { x: 1, y: 0, time: 1, color: DEFAULT_TRAJECTORY_CONFIG.color },
      ],
      [
        { x: 10, y: 10, time: 2, color: DEFAULT_TRAJECTORY_CONFIG.color },
        { x: 11, y: 10, time: 3, color: DEFAULT_TRAJECTORY_CONFIG.color },
      ],
    ]);

    const restored = new TrajectoryStorage();
    restored.load(snapshot);
    expect(restored.dump().trajectories[0]?.segments).toEqual(snapshot.trajectories[0]?.segments);
  });
});

describe('TrajectoryStorage – serialization', () => {
  it('dump/load round-trips correctly', () => {
    const storage = new TrajectoryStorage({ length: 500, color: '#f0f' });
    storage.upsertConfigs([{ id: 'a1', color: '#000' }]);
    storage.appendTrajectoryPoint('a1', { x: 1, y: 1, time: 0 });
    storage.appendTrajectoryPoint('a1', { x: 2, y: 2, time: 100 });
    storage.appendTrajectoryPoint('a2', { x: 10, y: 10, time: 0 });

    const snap = storage.dump();
    const s2 = new TrajectoryStorage();
    s2.load(snap);

    const snap2 = s2.dump();
    expect(snap2.config).toEqual(snap.config);
    expect(snap2.configs).toEqual(snap.configs);
    expect(snap2.trajectories).toHaveLength(2);
    expect(snap2.trajectories).toEqual(expect.arrayContaining([
      {
        id: 'a1',
        points: [
          { x: 1, y: 1, time: 0, color: '#000' },
          { x: 2, y: 2, time: 100, color: '#000' },
        ],
      },
      {
        id: 'a2',
        points: [
          { x: 10, y: 10, time: 0, color: '#f0f' },
        ],
      },
    ]));
  });
});
