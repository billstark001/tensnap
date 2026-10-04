import { describe, expect, it } from 'vitest';
import { ChartScene, downsampleSeries } from './ChartScene';

describe('downsampleSeries', () => {
  it('retains extrema in every pixel bucket', () => {
    const points = Array.from({ length: 1_000 }, (_, time) => ({
      time,
      value: time === 500 ? 999 : 1,
    }));
    const sampled = downsampleSeries(points, 0, 999, 20);
    expect(sampled.some((point) => point.value === 999)).toBe(true);
    expect(sampled.length).toBeLessThan(points.length);
    expect(sampled.length).toBeLessThanOrEqual(20 * 4);
  });

  it('accepts fractional pixel widths without allocating a fractional bucket array', () => {
    const points = Array.from({ length: 1_000 }, (_, time) => ({
      time,
      value: time === 500 ? 999 : 1,
    }));
    const sampled = downsampleSeries(points, 0, 999, 20.5);
    expect(sampled.some((point) => point.value === 999)).toBe(true);
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
    const scene = new ChartScene({
      lines: [{ key: 'population', name: 'Population', color: '#0f0' }],
    });
    scene.updateData([
      { time: 0, population: 4 },
      { time: 10, population: 9 },
    ]);

    expect(scene.getTooltipAt(54, 400)).toEqual({
      x: 0,
      values: [{ key: 'population', label: 'Population', value: 4, color: '#0f0' }],
    });
  });

  it('skips sparse rows that have no configured line value', () => {
    const scene = new ChartScene({ lines: [{ key: 'population', name: 'Population' }] });
    scene.updateData([
      { time: 0, population: 4 },
      { time: 5, other: 99 },
      { time: 10, population: 9 },
    ]);

    expect(scene.getTooltipAt(217, 400)).toMatchObject({ x: 0, values: [{ value: 4 }] });
    expect(scene.getTooltipAt(Number.NaN, 400)).toBeNull();
    expect(scene.getTooltipAt(217, Infinity)).toBeNull();
  });

  it('keeps smart-axis tick generation bounded at floating-point extremes', () => {
    const scene = new ChartScene({
      lines: [{ key: 'value', name: 'Value' }],
      smartAxisBounds: true,
    });
    scene.updateData([
      { time: 0, value: 0 },
      { time: Number.MIN_VALUE, value: Number.MIN_VALUE },
    ]);
    expect(scene.getBounds().xMax).toBe(Number.MIN_VALUE);

    scene.updateData([
      { time: 1e300, value: 1 },
      { time: 1e300 + 2e284, value: 2 },
    ]);
    const bounds = scene.getBounds();
    expect(Number.isFinite(bounds.xMin)).toBe(true);
    expect(Number.isFinite(bounds.xMax)).toBe(true);
    expect(bounds.xMax).toBeGreaterThan(bounds.xMin);

    scene.updateConfig({ lines: [{ key: 'value', name: 'Value' }] });
    scene.updateData([{ time: Number.MAX_VALUE, value: Number.MAX_VALUE }]);
    const maximum = scene.getBounds();
    expect(Object.values(maximum).every(Number.isFinite)).toBe(true);
    expect(maximum.xMax).toBeGreaterThan(maximum.xMin);
  });
});
