import { describe, expect, it } from 'vitest';
import { ChartScene, downsampleSeries } from './ChartScene';

describe('downsampleSeries', () => {
  it('retains extrema in every pixel bucket', () => {
    const points = Array.from({ length: 1_000 }, (_, time) => ({ time, value: time === 500 ? 999 : 1 }));
    const sampled = downsampleSeries(points, 0, 999, 20);
    expect(sampled.some((point) => point.value === 999)).toBe(true);
    expect(sampled.length).toBeLessThan(points.length);
    expect(sampled.length).toBeLessThanOrEqual(20 * 4);
  });

  it('extends cached bounds when a stable chart array receives appended points', () => {
    const data = [{ time: 1, population: 3 }];
    const scene = new ChartScene({ lines: [{ key: 'population', name: 'Population' }] });
    scene.updateData(data);
    data.push({ time: 2, population: 9 });
    scene.updateData(data);

    expect(scene.getBounds()).toMatchObject({ xMin: 1, xMax: 2 });
  });

  it('returns the nearest point coordinates for a hover tooltip', () => {
    const scene = new ChartScene({ lines: [{ key: 'population', name: 'Population', color: '#0f0' }] });
    scene.updateData([{ time: 0, population: 4 }, { time: 10, population: 9 }]);

    expect(scene.getTooltipAt(54, 400)).toEqual({
      x: 0,
      values: [{ key: 'population', label: 'Population', value: 4, color: '#0f0' }],
    });
  });
});
