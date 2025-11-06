import { create } from "zustand";


export interface UpdateTriggerStore {
  updateTrigger: any;
  onUpdate: () => void;
};


export const createUpdateTriggerStore = () => {

  const useStore = create<UpdateTriggerStore>((set, get) => ({
    updateTrigger: 0,
    onUpdate: () => {
      set({ updateTrigger: get().updateTrigger + 1 });
    },
  }));

  return useStore;
};