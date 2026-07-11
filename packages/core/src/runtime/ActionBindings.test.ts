import { describe, expect, it } from 'vitest';
import { resolveActionBindings } from './ActionBindings';

describe('resolveActionBindings', () => {
  it('uses conventional ids before the continuous fallback', () => {
    const result = resolveActionBindings([
      { id: 'start', label: 'Start' },
      { id: 'step', label: 'Legacy step' },
      { id: 'reset', label: 'Legacy reset' },
    ]);
    expect(result.bindings).toEqual({ run: 'start', step: 'step', reset: 'reset' });
    expect(result.errors).toEqual({});
  });

  it('reports ambiguous continuous fallbacks instead of silently choosing one', () => {
    const result = resolveActionBindings([
      { id: 'go-a', label: 'A', continuous: true },
      { id: 'go-b', label: 'B', continuous: true },
    ]);
    expect(result.bindings.run).toBeUndefined();
    expect(result.errors.run).toContain('go-a, go-b');
  });
});
