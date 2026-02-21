import { CreateStoreFunction } from '@/utils/zustand';
import { ActionsSlice, ScenarioStore } from '../types';

export const createActionsSlice: CreateStoreFunction<ActionsSlice, ScenarioStore> = (set, get) => ({
  actions: new Map(),

  upsertAction: (action) => {
    const { actions } = get();
    actions.set(action.id, { ...action });
    set({ actions });
  },

  deleteAction: (id) => {
    const { actions } = get();
    actions.delete(id);
    set({ actions });
  },

  handleActionEnd: (_id, _continueFlag) => {
    // Continuous-loop management is handled by the UI layer (components/hooks).
    // This hook is a no-op in the store; the WebSocket layer routes action_end
    // back to whichever component initiated the action_start.
  },
});
