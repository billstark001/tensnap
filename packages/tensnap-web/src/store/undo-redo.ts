import { createStoreContext } from '@/utils/zustand';
import { create, StoreApi, UseBoundStore } from 'zustand';
import { ScenarioStore } from './scenario';

// Types for the undo/redo store
export interface UndoRedoState<T> {
  // Configuration
  maxHistorySteps: number;
  targetStore: UseBoundStore<StoreApi<T>>; // The target store instance

  // State management
  history: Partial<T>[]; // Array of historical states
  currentIndex: number; // Current position in history

  // Actions
  pushState: (state: Partial<T>) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
}

// Factory function to create an undo/redo store for any target store
export const createUndoRedoStore = <T>(
  maxHistorySteps: number,
  targetStore: UseBoundStore<StoreApi<T>>
) => {
  return create<UndoRedoState<T>>((set, get) => ({
    // Configuration
    maxHistorySteps,
    targetStore,

    // Initial state
    history: [],
    currentIndex: -1,

    // Push a new state to history when target store changes
    pushState: (state: Partial<T>) => {
      set((prevState) => {
        const { history, currentIndex, maxHistorySteps } = prevState;

        // Remove any future history if we're not at the end
        const newHistory = history.slice(0, currentIndex + 1);
        newHistory.push(state);

        // Ensure we don't exceed max history steps
        const trimmedHistory = newHistory.length > maxHistorySteps
          ? newHistory.slice(-maxHistorySteps)
          : newHistory;

        return {
          ...prevState,
          history: trimmedHistory,
          currentIndex: trimmedHistory.length - 1
        };
      });
    },

    // Undo to previous state
    undo: () => {
      const { history, currentIndex, targetStore } = get();

      if (currentIndex > 0) {
        const previousState = history[currentIndex - 1];

        // Apply the previous state to target store
        targetStore.setState(previousState);

        // Update current index
        set((prevState) => ({
          ...prevState,
          currentIndex: prevState.currentIndex - 1
        }));
      }
    },

    // Redo to next state
    redo: () => {
      const { history, currentIndex, targetStore } = get();

      if (currentIndex < history.length - 1) {
        const nextState = history[currentIndex + 1];

        // Apply the next state to target store
        targetStore.setState(nextState);

        // Update current index
        set((prevState) => ({
          ...prevState,
          currentIndex: prevState.currentIndex + 1
        }));
      }
    },

    // Check if undo is possible
    canUndo: () => {
      const { currentIndex } = get();
      return currentIndex > 0;
    },

    // Check if redo is possible
    canRedo: () => {
      const { history, currentIndex } = get();
      return currentIndex < history.length - 1;
    },

    // Clear all history
    clear: () => {
      set((prevState) => ({
        ...prevState,
        history: [],
        currentIndex: -1
      }));
    }
  }));
};

export const {
  Provider: ScenarioUndoRedoStoreProvider,
  useStore: useScenarioUndoRedoStore,
} = createStoreContext<UndoRedoState<ScenarioStore>>();