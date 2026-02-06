import { CreateStoreFunction } from '../state-manager';
import { TimeSlice } from '../core-types';

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