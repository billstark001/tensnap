import { useCallback } from 'react';
import type { ContainerView } from '@tensnap/core/persistence';
import { useScenarioStore } from './scenario/store';
import { useScenarioUndoRedoStore } from './undo-redo';
import type { HistoryCommandScope } from './history-model';
import { recordViewHistoryChange, type ViewHistorySideEffects } from './view-history-model';

/** Records an already-applied view-tree transaction as a renderer-only command. */
export function useRecordViewHistory() {
  const history = useScenarioUndoRedoStore();
  const replaceMainView = useScenarioStore((state) => state.replaceMainView);

  return useCallback(
    (
      label: string,
      scope: HistoryCommandScope,
      before: ContainerView,
      after: ContainerView,
      mergeKey?: string,
      sideEffects?: ViewHistorySideEffects,
    ) => {
      recordViewHistoryChange(
        history,
        replaceMainView,
        label,
        scope,
        before,
        after,
        mergeKey,
        sideEffects,
      );
    },
    [history, replaceMainView],
  );
}
