import type { ChangeRef, VisitValue } from './types';

export function visitProperties(
  a: object,
  b: object,
  path: string[],
  visit: VisitValue,
  ref?: ChangeRef,
  excluded?: string,
): void {
  const before = a as Record<string, unknown>,
    after = b as Record<string, unknown>;
  for (const key of Object.keys(before))
    if (key !== excluded)
      visit(
        before[key],
        after[key],
        [...path, key],
        ref,
        true,
        Object.prototype.hasOwnProperty.call(after, key),
      );
  for (const key of Object.keys(after))
    if (key !== excluded && !Object.prototype.hasOwnProperty.call(before, key))
      visit(undefined, after[key], [...path, key], ref, false, true);
}
