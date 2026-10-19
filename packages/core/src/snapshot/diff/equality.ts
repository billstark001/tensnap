export function binaryEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
}

/** Exact type-aware equality; every array, including item collections, stays ordered. */
export function exactValueEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Uint8Array || b instanceof Uint8Array)
    return a instanceof Uint8Array && b instanceof Uint8Array && binaryEqual(a, b);
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return false;
  const before = a as Record<string, unknown>,
    after = b as Record<string, unknown>;
  const keys = Object.keys(before);
  return (
    keys.length === Object.keys(after).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(after, key) &&
        exactValueEqual(before[key], after[key]),
    )
  );
}
