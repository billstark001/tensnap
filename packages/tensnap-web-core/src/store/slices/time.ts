import { CreateStoreFunction } from '@/utils/zustand';
import { TimeSlice } from '../types';

export const createTimeSlice: CreateStoreFunction<TimeSlice> = (set) => ({
  currentTime: 0,
  isInTimeStep: false,
  setCurrentTime: (time, isInTimeStep) => {
    if (time == null) {
      set({ isInTimeStep });
    } else {
      set({ currentTime: time, isInTimeStep });
    }
  },
});