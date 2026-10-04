import { describe, expect, it } from 'vitest';
import { GridEnvStorage } from '../storages/GridEnvStorage';
import { GridLayer } from './GridLayer';

describe('GridLayer', () => {
  it('bounds line creation for extreme viewport and spacing inputs', () => {
    const layer = new GridLayer(new GridEnvStorage());
    const internal = layer as unknown as {
      group: { children: unknown[]; clear(): void };
      _drawLines: (...args: [number[], number, number, number, number, number, number, number, number, 'vertical', string, number]) => void;
    };

    internal._drawLines([0], 0, 1, 1, 2, -5, 5, 0, 10, 'vertical', '#808080', 1);
    expect(internal.group.children.length).toBeGreaterThan(0);
    internal.group.clear();
    internal._drawLines([0], 0, 1, 1, 2, -1e9, 1e9, 0, 10, 'vertical', '#808080', 1);
    internal._drawLines([0], 0, 1, 1, 2, 1e20, 1e20, 0, 10, 'vertical', '#808080', 1);
    internal._drawLines([0], 0, Infinity, 1, 2, -5, 5, 0, 10, 'vertical', '#808080', 1);
    expect(internal.group.children.length).toBe(0);
    layer.destroy();
  });
});
