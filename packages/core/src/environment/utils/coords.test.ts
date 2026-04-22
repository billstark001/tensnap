import { describe, expect, it } from 'vitest';
import { applyCoordOffset, getCoordOffsetValue } from './coords';

describe('coord offset utilities', () => {
  it('uses +0.5 for int grid coordinates', () => {
    expect(getCoordOffsetValue('int')).toBe(0.5);
    expect(applyCoordOffset(2, 3, 'int')).toEqual({ x: 2.5, y: 3.5 });
  });

  it('uses raw coordinates for float grid coordinates', () => {
    expect(getCoordOffsetValue('float')).toBe(0);
    expect(applyCoordOffset(2, 3, 'float')).toEqual({ x: 2, y: 3 });
  });
});