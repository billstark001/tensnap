import { CreateStoreFunction } from '@/utils/zustand';
import { ConnectionSlice } from '../types';

export const createConnectionSlice: CreateStoreFunction<ConnectionSlice> = (set) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),
});