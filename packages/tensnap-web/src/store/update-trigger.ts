import { CreateStoreFunction } from "@/utils/zustand";
import { create } from "zustand";


export interface UpdateTriggerState {
  value: any;
  set: () => void;
};

export const createUpdateTriggerStoreFunction: CreateStoreFunction<UpdateTriggerState> = (set, get) => ({
  value: 0,
  set: () => {
    set({ value: get().value + 1 });
  },
});

export const createUpdateTriggerStore = () => {

  const useStore = create<UpdateTriggerState>((set, get) => ({
    value: 0,
    set: () => {
      set({ value: get().value + 1 });
    },
  }));

  return useStore;
};