import { createStoreContext } from '@/utils/zustand';
import { create } from 'zustand';
import { createHistoryState, type HistoryState, type HistoryStoreOptions } from './history-model';

/** React binding for the project history model. */
export const createHistoryStore = (options: HistoryStoreOptions = {}) =>
  create<HistoryState>(createHistoryState(options));

export const { Provider: ScenarioUndoRedoStoreProvider, useStore: useScenarioUndoRedoStore } =
  createStoreContext<HistoryState>();
