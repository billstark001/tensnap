import { compileFieldPath } from '../../scenario/query';
import { isPrefix } from './policy';
import type { ResolvedComparisonPolicy } from './policy';
import type { ChangeRef, SceneChange, VisitValue } from './types';
import type { ScenarioSnapshot } from '../../scenario/types';
import { ObjectSelection } from './selection';

import { binaryEqual } from './equality';

function withinTolerance(a: unknown, b: unknown, policy: ResolvedComparisonPolicy): boolean {
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b))
    return false;
  const magnitude = Math.max(Math.abs(a), Math.abs(b));
  // Normalize first: finite extremes must never turn into Infinity <= Infinity.
  return (
    magnitude === 0 ||
    Math.abs(a / magnitude - b / magnitude) <=
      policy.absoluteTolerance / magnitude + policy.relativeTolerance
  );
}

export class DiffCollector {
  readonly changes: SceneChange[] = [];
  changeCount = 0;
  selectedChangeCount = 0;
  private readonly fields;
  private readonly ignored;
  private readonly objects;

  constructor(
    private readonly policy: ResolvedComparisonPolicy,
    private readonly limit: number,
    private readonly offset: number,
    scenes: readonly ScenarioSnapshot[],
  ) {
    this.objects = new ObjectSelection(policy.objects, scenes);
    this.fields = policy.fields?.map(compileFieldPath);
    this.ignored = policy.ignore.map(compileFieldPath);
  }

  readonly visit: VisitValue = (a, b, path, ref, hasA = true, hasB = true) => {
    if (hasA === hasB && Object.is(a, b)) return;
    if (
      hasA &&
      hasB &&
      a &&
      b &&
      typeof a === 'object' &&
      typeof b === 'object' &&
      !(a instanceof Uint8Array) &&
      !(b instanceof Uint8Array) &&
      Array.isArray(a) === Array.isArray(b)
    ) {
      if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length)
        this.visit(a.length, b.length, [...path, 'length'], ref);
      const before = a as Record<string, unknown>,
        after = b as Record<string, unknown>;
      for (const key of Object.keys(before))
        this.visit(
          before[key],
          after[key],
          [...path, key],
          ref,
          true,
          Object.prototype.hasOwnProperty.call(after, key),
        );
      for (const key of Object.keys(after))
        if (!Object.prototype.hasOwnProperty.call(before, key))
          this.visit(undefined, after[key], [...path, key], ref, false, true);
      return;
    }
    if (hasA === hasB && a instanceof Uint8Array && b instanceof Uint8Array && binaryEqual(a, b))
      return;
    this.record(a, b, path, ref, hasA, hasB);
  };

  private record(
    a: unknown,
    b: unknown,
    path: string[],
    ref: ChangeRef | undefined,
    hasA: boolean,
    hasB: boolean,
  ): void {
    const objectSelected = this.objects.includes(path, ref, a, b);
    const selected =
      objectSelected &&
      (this.fields === undefined ||
        this.fields.some((field) => isPrefix(field, path) || isPrefix(path, field)));
    const ignored = this.ignored.some((field) => isPrefix(field, path));
    const tolerance = hasA && hasB && withinTolerance(a, b, this.policy);
    if (selected && !ignored && !tolerance) this.selectedChangeCount++;
    if (this.changeCount >= this.offset && this.changes.length < this.limit)
      this.changes.push({
        ref,
        path,
        kind: !hasA ? 'added' : !hasB ? 'removed' : 'changed',
        ...(hasA ? { before: structuredClone(a) } : {}),
        ...(hasB ? { after: structuredClone(b) } : {}),
        selected,
        ignored,
        withinTolerance: tolerance,
      });
    this.changeCount++;
  }
}
