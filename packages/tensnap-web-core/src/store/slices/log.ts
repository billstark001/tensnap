import { CreateStoreFunction } from '../state-manager';
import { LogsSlice } from '../core-types';
import { LogLevel, LogPayload, NormalizedLogPayload } from '../core-types';

const MAX_LOG_ENTRIES = 1000;

export const createLogsSlice: CreateStoreFunction<LogsSlice> = (set) => ({
  logs: [],
  lastLogs: undefined,

  log: (payload: string | LogPayload, level: LogLevel = 'info') => {
    const normalizedPayload: NormalizedLogPayload = typeof payload === 'string'
      ? { id: `log-${Date.now()}-${Math.random()}`, level, message: payload, timestamp: Date.now() }
      : { id: `log-${Date.now()}-${Math.random()}`, level: 'info', ...payload, timestamp: payload.timestamp || Date.now() };

    set((state) => {
      const newLogs = [...state.logs, normalizedPayload];
      if (newLogs.length > MAX_LOG_ENTRIES) {
        newLogs.splice(0, newLogs.length - MAX_LOG_ENTRIES);
      }
      return { logs: newLogs, lastLogs: normalizedPayload };
    });
  },
});