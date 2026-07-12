import { describe, expect, it } from 'vitest';
import { parseFiniteNumberInput } from './form-values';

describe('parseFiniteNumberInput', () => {
  it('accepts finite numeric input', () => {
    expect(parseFiniteNumberInput('-1.25', 9)).toBe(-1.25);
  });

  it('uses the fallback for incomplete or invalid input', () => {
    expect(parseFiniteNumberInput('', 9)).toBe(9);
    expect(parseFiniteNumberInput('-', 9)).toBe(9);
    expect(parseFiniteNumberInput('12px', 9)).toBe(9);
  });
});
