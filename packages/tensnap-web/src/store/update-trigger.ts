import { CreateStoreFunction } from "@/utils/zustand";
import { create } from "zustand";


export interface UpdateTriggerState {
  value: any;
  set: () => void;
  reset: () => void;
};

export const createUpdateTriggerStoreFunction: CreateStoreFunction<UpdateTriggerState> = (set, get) => ({
  value: 0,
  set: () => {
    set({ value: get().value + 1 });
  },
  reset: () => {
    set({ value: 0 });
  },
});

export const createUpdateTriggerStore = () => {

  const useStore = create<UpdateTriggerState>(createUpdateTriggerStoreFunction);

  return useStore;
};