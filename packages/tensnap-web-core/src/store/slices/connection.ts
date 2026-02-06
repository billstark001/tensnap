import { CreateStoreFunction } from '../state-manager';
import { ConnectionSlice } from '../core-types';

export const createConnectionSlice: CreateStoreFunction<ConnectionSlice> = (set) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),
});