import type { QueryItem } from '../../scenario/query-schema';

export type ChangeRef = QueryItem['ref'];

export type VisitValue = (
  before: unknown,
  after: unknown,
  path: string[],
  ref?: ChangeRef,
  hasBefore?: boolean,
  hasAfter?: boolean,
) => void;

export interface SceneChange {
  ref?: ChangeRef;
  path: string[];
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
  selected: boolean;
  ignored: boolean;
  withinTolerance: boolean;
}
