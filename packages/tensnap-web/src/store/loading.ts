import { create } from 'zustand';

interface LoadingState {
  // Public loading state - true if any loading process is active
  loading: boolean;
  
  // Private state for tracking loading processes
  loadingCount: number;
  loadingProcesses: Set<string>;
  
  // Actions
  startLoading: (processId?: string) => void;
  stopLoading: (processId?: string) => void;
  withLoading: <T>(
    fn: () => Promise<T>, 
    processId?: string
  ) => Promise<T>;
}

export const useLoadingStore = create<LoadingState>((set, get) => ({
  loading: false,
  loadingCount: 0,
  loadingProcesses: new Set(),

  startLoading: (processId?: string) => {
    const state = get();
    
    if (processId) {
      // If process ID is provided, check if it's already running
      if (state.loadingProcesses.has(processId)) {
        return; // Process with this ID is already running
      }
      
      set({
        loadingProcesses: new Set([...state.loadingProcesses, processId]),
        loading: true
      });
    } else {
      // No process ID provided, increment counter
      set({
        loadingCount: state.loadingCount + 1,
        loading: true
      });
    }
  },

  stopLoading: (processId?: string) => {
    const state = get();
    
    if (processId) {
      // Remove specific process ID
      const newProcesses = new Set(state.loadingProcesses);
      newProcesses.delete(processId);
      
      set({
        loadingProcesses: newProcesses,
        loading: state.loadingCount > 0 || newProcesses.size > 0
      });
    } else {
      // Decrement counter, but don't go below 0
      const newCount = Math.max(0, state.loadingCount - 1);
      
      set({
        loadingCount: newCount,
        loading: newCount > 0 || state.loadingProcesses.size > 0
      });
    }
  },

  withLoading: async <T>(
    fn: () => Promise<T>, 
    processId?: string,
  ): Promise<T> => {
    const { startLoading, stopLoading } = get();
    
    try {
      startLoading(processId);
      return await fn();
    } finally {
      stopLoading(processId);
    }
  }
}));


export const useWithLoading = () => useLoadingStore(x => x.withLoading);