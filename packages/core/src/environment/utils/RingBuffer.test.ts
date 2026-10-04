import { describe, expect, it } from 'vitest';
import { RingBuffer } from './RingBuffer';

describe('RingBuffer', () => {
  it('rejects fractional and unsafe capacities with a clear error', () => {
    expect(() => new RingBuffer<number>(1.5)).toThrow(/non-negative safe integer/);
    expect(() => new RingBuffer<number>(-1)).toThrow(/non-negative safe integer/);
    expect(() => new RingBuffer<number>(Number.POSITIVE_INFINITY)).toThrow(/non-negative safe integer/);
  });

  it('retains the newest entries after resize', () => {
    const ring = new RingBuffer<number>(3);
    for (let number = 1; number <= 4; number++) ring.push(number);
    expect(ring.resize(2).toArray()).toEqual([3, 4]);
    expect(ring.resize(0).toArray()).toEqual([2, 3, 4]);
  });
});
