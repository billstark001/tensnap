import { CreateStoreFunction } from '@/utils/zustand';
import { TimeSlice } from '../types';

export const createTimeSlice: CreateStoreFunction<TimeSlice> = (set) => ({
  currentTime: 0,
  setCurrentTime: (time) => {
    set({ currentTime: time });
  },
});