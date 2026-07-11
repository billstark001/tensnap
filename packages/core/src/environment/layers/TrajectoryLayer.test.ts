// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { TrajectoryStorage } from '../storages/TrajectoryStorage';
import { TrajectoryLayer } from './TrajectoryLayer';

type LayerCache = {
  segments: Array<{ pointChunks: number[][] }>;
};

describe('TrajectoryLayer', () => {
  it('extends only the active chunk until a bounded ring wraps', () => {
    const storage = new TrajectoryStorage({ length: 3 });
    storage.appendTrajectoryPoint('a', { x: 0, y: 0, time: 0 });
    storage.appendTrajectoryPoint('a', { x: 1, y: 0, time: 1 });
    const layer = new TrajectoryLayer(storage, { coordOffset: 'float' });
    const cache = (layer as unknown as { _lines: Map<string, LayerCache> })._lines.get('a')!;
    const firstChunk = cache.segments[0].pointChunks[0];

    storage.appendTrajectoryPoint('a', { x: 2, y: 0, time: 2 });
    expect(cache.segments[0].pointChunks[0]).toBe(firstChunk);
    expect(firstChunk).toEqual([0, 0, 1, 0, 2, 0]);

    storage.appendTrajectoryPoint('a', { x: 3, y: 0, time: 3 });
    expect(cache.segments[0].pointChunks[0]).not.toBe(firstChunk);
    expect(cache.segments[0].pointChunks[0]).toEqual([1, 0, 2, 0, 3, 0]);
    layer.destroy();
  });
});
