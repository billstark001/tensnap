import type { ContainerView } from '@tensnap/core/persistence';
import {
  createHistoryCommandId,
  estimateHistoryBytes,
  type HistoryCommandScope,
  type HistoryState,
} from './history-model';

export interface ViewHistorySideEffects {
  apply?: () => void | Promise<void>;
  revert?: () => void | Promise<void>;
  byteSize?: number;
}

/** Retain detached before/after patches for an already-applied view transaction. */
export function recordViewHistoryChange(
  history: Pick<HistoryState, 'recordApplied'> | undefined,
  replaceMainView: ((view: ContainerView) => void) | undefined,
  label: string,
  scope: HistoryCommandScope,
  before: ContainerView,
  after: ContainerView,
  mergeKey?: string,
  sideEffects?: ViewHistorySideEffects,
) {
  const viewChanged = JSON.stringify(before) !== JSON.stringify(after);
  if (!history || !replaceMainView || (!viewChanged && !sideEffects?.apply && !sideEffects?.revert))
    return;
  const beforePatch = structuredClone(before);
  const afterPatch = structuredClone(after);
  history.recordApplied({
    id: createHistoryCommandId(),
    label,
    scope,
    mergeKey,
    byteSize: estimateHistoryBytes(beforePatch, afterPatch) + (sideEffects?.byteSize ?? 0),
    apply: async () => {
      await sideEffects?.apply?.();
      replaceMainView(afterPatch);
    },
    revert: async () => {
      await sideEffects?.revert?.();
      replaceMainView(beforePatch);
    },
  });
}
