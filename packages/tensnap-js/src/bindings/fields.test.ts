import { describe, expect, it } from 'vitest';
import { literal, projectFields } from './fields';
import { compilePath } from './utils';

describe('compiled field projection', () => {
  it('reads symbol keys without converting them into string property names', () => {
    const id = Symbol('id');
    const item = { [id]: 42 };
    expect(projectFields<{}, typeof item>({ id })({}, item)).toEqual({ id: 42 });
  });

  it('preserves callbacks, literals, constants, and null-safe nested/indexed paths', () => {
    const project = projectFields<{ offset: number }, { position: { values: number[] } | null }>({
      x: 'position.values[0]',
      computed: (item, model) => model.offset + (item.position?.values[0] ?? 0),
      label: literal('fixed'),
      size: 2,
    });
    expect(project({ offset: 3 }, { position: { values: [5] } })).toEqual({
      x: 5,
      computed: 8,
      label: 'fixed',
      size: 2,
    });
    expect(project({ offset: 7 }, { position: null })).toEqual({
      x: null,
      computed: 7,
      label: 'fixed',
      size: 2,
    });
    expect(compilePath('values[0].x')({ values: [{ x: 9 }] })).toBe(9);
  });

  it('preserves a projected field named __proto__ as an own property', () => {
    const project = projectFields(Object.fromEntries([['__proto__', literal('value')]]));
    const result = project({}, {});
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true);
    expect(result.__proto__).toBe('value');
  });
});
