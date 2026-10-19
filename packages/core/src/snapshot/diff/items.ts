import type { ChangeRef, VisitValue } from './types';

export type ItemKey<T> = (item: T) => string;
export type ItemRef<T> = (item: T) => ChangeRef | undefined;

/** Two linear indexes, no sort, union array/set or cloning of complete items. */
export function compareIdentityItems<T>(
  a: readonly T[],
  b: readonly T[],
  path: string[],
  visit: VisitValue,
  key: ItemKey<T>,
  reference?: ItemRef<T>,
): void {
  const index = (values: readonly T[]) => {
    const result = new Map<string, T>();
    for (const value of values) {
      const id = key(value);
      if (result.has(id))
        throw new Error(`Duplicate item identity at ${JSON.stringify(path)}: ${id}`);
      result.set(id, value);
    }
    return result;
  };
  const before = index(a),
    after = index(b);
  for (const [id, old] of before) {
    const hasNext = after.has(id),
      next = after.get(id);
    visit(old, next, [...path, id], reference?.((hasNext ? next : old)!), true, hasNext);
  }
  for (const [id, next] of after)
    if (!before.has(id)) visit(undefined, next, [...path, id], reference?.(next), false, true);
}

/** Position-sensitive traversal: no identity index is built in exact mode. */
export function compareExactItems<T>(
  a: readonly T[],
  b: readonly T[],
  path: string[],
  visit: VisitValue,
  _key: ItemKey<T>,
  reference?: ItemRef<T>,
): void {
  if (a.length !== b.length) visit(a.length, b.length, [...path, 'length']);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const hasA = Object.prototype.hasOwnProperty.call(a, index),
      hasB = Object.prototype.hasOwnProperty.call(b, index);
    visit(
      a[index],
      b[index],
      [...path, String(index)],
      hasA || hasB ? reference?.((hasB ? b[index] : a[index])!) : undefined,
      hasA,
      hasB,
    );
  }
}

export function typedItemKey(fields: readonly string[]): ItemKey<unknown> {
  return (item) => {
    if (!item || typeof item !== 'object') throw new Error('Item identity requires an object.');
    const values = fields.map((field) => {
      const value = (item as Record<string, unknown>)[field];
      if (
        !Object.prototype.hasOwnProperty.call(item, field) ||
        (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value)))
      )
        throw new Error(`Item identity requires typed string/number field ${field}.`);
      return value;
    });
    return JSON.stringify(values);
  };
}
