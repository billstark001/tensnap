import { useCallback } from 'react';
import type { ContainerView } from '@/types/ui';
import { useScenarioStore } from './scenario/store';
import {
  createHistoryCommandId,
  estimateHistoryBytes,
  useScenarioUndoRedoStore,
  type HistoryCommandScope,
  type HistoryState,
} from './undo-redo';

export interface ViewHistorySideEffects {
  apply?: () => void | Promise<void>;
  revert?: () => void | Promise<void>;
  byteSize?: number;
}

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
  if (!history || !replaceMainView || (!viewChanged && !sideEffects?.apply && !sideEffects?.revert)) return;
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

/** Records an already-applied view-tree transaction as a renderer-only command. */
export function useRecordViewHistory() {
  const history = useScenarioUndoRedoStore();
  const replaceMainView = useScenarioStore((state) => state.replaceMainView);

  return useCallback((
    label: string,
    scope: HistoryCommandScope,
    before: ContainerView,
    after: ContainerView,
    mergeKey?: string,
    sideEffects?: ViewHistorySideEffects,
  ) => {
    recordViewHistoryChange(history, replaceMainView, label, scope, before, after, mergeKey, sideEffects);
  }, [history, replaceMainView]);
}
