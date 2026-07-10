import { describe, expect, it } from 'vitest';
import { downsampleSeries } from './ChartScene';

describe('downsampleSeries', () => {
  it('retains extrema in every pixel bucket', () => {
    const points = Array.from({ length: 1_000 }, (_, time) => ({ time, value: time === 500 ? 999 : 1 }));
    const sampled = downsampleSeries(points, 0, 999, 20);
    expect(sampled.some((point) => point.value === 999)).toBe(true);
    expect(sampled.length).toBeLessThan(points.length);
  });
});
