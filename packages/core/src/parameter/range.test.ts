import { describe, expect, it } from 'vitest';
import { estimateNumericRange, sanitizeParameter } from './range';

describe('numeric parameter ranges', () => {
  it.each([
    { value: -3, min: -7, max: -1, step: 0.25 },
    { value: 0.5, min: 0.2, max: 0.8, step: 0.05 },
    { value: 3, min: 2, max: 7, step: 2 },
  ])('preserves explicit simulator constraints: %j', (hint) => {
    expect(estimateNumericRange(hint)).toEqual({ min: hint.min, max: hint.max, step: hint.step });
  });

  it('preserves supplied bounds when only the step is estimated', () => {
    expect(estimateNumericRange({ value: -3, min: -7, max: -1 })).toMatchObject({
      min: -7,
      max: -1,
    });
  });

  it.each([NaN, Infinity, -Infinity])('rejects a non-finite current value: %s', (value) => {
    expect(() => estimateNumericRange({ value })).toThrow(RangeError);
  });

  it('produces usable finite ranges across extreme magnitudes', () => {
    const values = [0, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE];
    for (let exponent = -320; exponent <= 308; exponent += 7) {
      values.push(10 ** exponent, -(10 ** exponent), 2.5 * 10 ** Math.min(exponent, 307));
    }
    for (const value of values) {
      const range = estimateNumericRange({ value });
      expect(Number.isFinite(range.min), `min for ${value}`).toBe(true);
      expect(Number.isFinite(range.max), `max for ${value}`).toBe(true);
      expect(range.min, `lower bound for ${value}`).toBeLessThanOrEqual(value);
      expect(range.max, `upper bound for ${value}`).toBeGreaterThanOrEqual(value);
      expect(range.min, `nonempty range for ${value}`).toBeLessThan(range.max);
      expect(Number.isFinite(range.step), `step for ${value}`).toBe(true);
      expect(range.step).toBeGreaterThan(0);
    }
  });

  it('does not widen a cloned parameter definition', () => {
    const parameter = {
      id: 'rate',
      label: 'Rate',
      type: 'number' as const,
      value: 0.5,
      min: 0.2,
      max: 0.8,
      step: 0.05,
    };
    expect(sanitizeParameter(parameter)).toEqual(parameter);
    expect(sanitizeParameter(parameter)).not.toBe(parameter);
  });
});
