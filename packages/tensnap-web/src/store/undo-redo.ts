import { createStoreContext } from '@/utils/zustand';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

export type HistoryCommandScope = 'layout' | 'view-config' | 'renderer-override' | 'snapshot' | 'remote-param';
export type HistoryStatus = 'idle' | 'applying' | 'reverting' | 'failed';

export interface HistoryCommand {
  id: string;
  label: string;
  scope: HistoryCommandScope;
  apply(): void | Promise<void>;
  revert(): void | Promise<void>;
  mergeKey?: string;
  byteSize: number;
  timestamp?: number;
  /** Internal state markers keep dirty tracking correct across undo branches. */
  beforeStateId?: string;
  afterStateId?: string;
}

export interface HistoryState {
  past: HistoryCommand[];
  future: HistoryCommand[];
  status: HistoryStatus;
  error?: string;
  maxCommands: number;
  maxBytes: number;
  retainedBytes: number;
  currentStateId: string;
  cleanStateId: string;

  execute: (command: HistoryCommand) => Promise<boolean>;
  recordApplied: (command: HistoryCommand) => void;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  canUndo: () => boolean;
  canRedo: () => boolean;
  isDirty: () => boolean;
  markClean: () => void;
  clear: () => void;
}

export interface HistoryStoreOptions {
  maxCommands?: number;
  maxBytes?: number;
  onError?: (error: unknown, command: HistoryCommand) => void;
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Project-scoped command history. Commands contain renderer-owned patches only. */
export const createHistoryStore = (options: HistoryStoreOptions = {}): UseBoundStore<StoreApi<HistoryState>> => {
  const maxCommands = options.maxCommands ?? 64;
  const maxBytes = options.maxBytes ?? 4 * 1024 * 1024;
  const rootStateId = createHistoryCommandId();

  return create<HistoryState>((set, get) => {
    const retainWithinBudget = (commands: HistoryCommand[]) => {
      const next = [...commands];
      let bytes = next.reduce((sum, command) => sum + command.byteSize, 0);
      while (next.length > maxCommands || (bytes > maxBytes && next.length > 1)) {
        bytes -= next.shift()!.byteSize;
      }
      return { commands: next, bytes };
    };

    const recordApplied = (command: HistoryCommand) => {
      if (!Number.isFinite(command.byteSize) || command.byteSize < 0) {
        throw new Error('History command byteSize must be a non-negative finite number.');
      }
      if (command.byteSize > maxBytes) {
        set({
          future: [],
          error: `History command exceeds the ${maxBytes}-byte budget.`,
          currentStateId: createHistoryCommandId(),
        });
        return;
      }
      const state = get();
      if (state.status !== 'idle') return;
      const stamped = {
        ...command,
        timestamp: command.timestamp ?? Date.now(),
        beforeStateId: state.currentStateId,
        afterStateId: createHistoryCommandId(),
      };
      const last = state.past[state.past.length - 1];
      const canMerge = Boolean(
        last?.mergeKey
        && stamped.mergeKey === last.mergeKey
        && (stamped.timestamp! - (last.timestamp ?? 0)) <= 750,
      );
      const merged = canMerge
        ? {
          ...stamped,
          id: last.id,
          label: command.label,
          byteSize: Math.max(last.byteSize, command.byteSize),
          revert: last.revert,
          beforeStateId: last.beforeStateId,
        }
        : stamped;
      const candidate = canMerge
        ? [...state.past.slice(0, -1), merged]
        : [...state.past, stamped];
      const retained = retainWithinBudget(candidate);
      set({
        past: retained.commands,
        future: [],
        retainedBytes: retained.bytes,
        currentStateId: merged.afterStateId!,
        error: undefined,
      });
    };

    return {
      past: [],
      future: [],
      status: 'idle',
      maxCommands,
      maxBytes,
      retainedBytes: 0,
      currentStateId: rootStateId,
      cleanStateId: rootStateId,

      execute: async (command) => {
        if (get().status !== 'idle') return false;
        set({ status: 'applying', error: undefined });
        try {
          await command.apply();
          set({ status: 'idle' });
          recordApplied(command);
          return true;
        } catch (error) {
          set({ status: 'failed', error: messageOf(error) });
          options.onError?.(error, command);
          set({ status: 'idle' });
          return false;
        }
      },

      recordApplied,

      undo: async () => {
        const state = get();
        const command = state.past[state.past.length - 1];
        if (!command || state.status !== 'idle') return false;
        set({ status: 'reverting', error: undefined });
        try {
          await command.revert();
          const current = get();
          set({
            past: current.past.slice(0, -1),
            future: [command, ...current.future],
            retainedBytes: Math.max(0, current.retainedBytes - command.byteSize),
            currentStateId: command.beforeStateId ?? createHistoryCommandId(),
            status: 'idle',
          });
          return true;
        } catch (error) {
          set({ status: 'failed', error: messageOf(error) });
          options.onError?.(error, command);
          set({ status: 'idle' });
          return false;
        }
      },

      redo: async () => {
        const state = get();
        const command = state.future[0];
        if (!command || state.status !== 'idle') return false;
        set({ status: 'applying', error: undefined });
        try {
          await command.apply();
          const retained = retainWithinBudget([...get().past, command]);
          set({
            past: retained.commands,
            future: get().future.slice(1),
            retainedBytes: retained.bytes,
            currentStateId: command.afterStateId ?? createHistoryCommandId(),
            status: 'idle',
          });
          return true;
        } catch (error) {
          set({ status: 'failed', error: messageOf(error) });
          options.onError?.(error, command);
          set({ status: 'idle' });
          return false;
        }
      },

      canUndo: () => get().past.length > 0 && get().status === 'idle',
      canRedo: () => get().future.length > 0 && get().status === 'idle',
      isDirty: () => get().currentStateId !== get().cleanStateId,
      markClean: () => set({ cleanStateId: get().currentStateId }),
      clear: () => {
        const stateId = createHistoryCommandId();
        set({
          past: [],
          future: [],
          retainedBytes: 0,
          currentStateId: stateId,
          cleanStateId: stateId,
          status: 'idle',
          error: undefined,
        });
      },
    };
  });
};

export const createHistoryCommandId = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `history-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

export const estimateHistoryBytes = (...values: unknown[]) => (
  new TextEncoder().encode(JSON.stringify(values)).byteLength
);

export const {
  Provider: ScenarioUndoRedoStoreProvider,
  useStore: useScenarioUndoRedoStore,
} = createStoreContext<HistoryState>();
