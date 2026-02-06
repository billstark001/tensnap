import { createStore } from './state-manager';
import { 
  ScenarioStore, 
  SetDataPayload, 
  SetDataOptions,
} from './core-types';
import { createConnectionSlice } from './slices/connection';
import { createTimeSlice } from './slices/time';
import { createEnvironmentsSlice } from './slices/environment';
import { createParametersSlice } from './slices/parameter';
import { createChartsSlice } from './slices/chart';
import { createSnapshotsSlice } from './slices/snapshot';
import { createLogsSlice } from './slices/log';
import { mergeEnvironments, mergeParameters, mergeCharts } from './utils';
import { serializeEnvironment } from './environment';

export const createScenarioStore = () => {
  let viewTriggerValue = 0;
  let environmentTriggerValue = 0;
  let parameterTriggerValue = 0;

  return createStore<ScenarioStore>((set, get, store) => {
    const state: ScenarioStore = {
      // Combine all slices (using type assertions for compatibility)
      ...createConnectionSlice(set as any, get as any, store as any),
      ...createTimeSlice(set as any, get as any, store as any),
      ...createEnvironmentsSlice(set as any, get as any, store as any),
      ...createParametersSlice(set as any, get as any, store as any),
      ...createChartsSlice(set as any, get as any, store as any),
      ...createSnapshotsSlice(set as any, get as any, store as any),
      ...createLogsSlice(set as any, get as any, store as any),

      // Update triggers with closures
      viewUpdateTrigger: {
        value: 0,
        set: () => {
          viewTriggerValue++;
          set({ viewUpdateTrigger: { ...get().viewUpdateTrigger, value: viewTriggerValue } } as any);
        },
        reset: () => {
          viewTriggerValue = 0;
          set({ viewUpdateTrigger: { ...get().viewUpdateTrigger, value: 0 } } as any);
        }
      },
      parameterUpdateTrigger: {
        value: 0,
        set: () => {
          parameterTriggerValue++;
          set({ parameterUpdateTrigger: { ...get().parameterUpdateTrigger, value: parameterTriggerValue } } as any);
        },
        reset: () => {
          parameterTriggerValue = 0;
          set({ parameterUpdateTrigger: { ...get().parameterUpdateTrigger, value: 0 } } as any);
        }
      },
      environmentUpdateTrigger: {
        value: 0,
        set: () => {
          environmentTriggerValue++;
          set({ environmentUpdateTrigger: { ...get().environmentUpdateTrigger, value: environmentTriggerValue } } as any);
        },
        reset: () => {
          environmentTriggerValue = 0;
          set({ environmentUpdateTrigger: { ...get().environmentUpdateTrigger, value: 0 } } as any);
        }
      },

      // Core methods
      dump: () => {
        const currentState = get();
        return {
          connected: false,
          currentTime: currentState.currentTime,
          environments: Array.from(currentState.environments.values()).map(serializeEnvironment),
          parameters: structuredClone(Array.from(currentState.parameters.values())),
          charts: structuredClone(currentState.charts.getGroups()),
          snapshots: structuredClone(currentState.snapshots),
        };
      },

      setData: (data: SetDataPayload, _options?: SetDataOptions) => {
        const currentState = get();
        const { environments, parameters, charts: chartMetas } = data;

        // Merge environments
        if (environments || data.removedEnvironmentIds) {
          const newEnvironments = mergeEnvironments(
            currentState.environments,
            data,
            true  // preserveExisting
          );
          set({ environments: newEnvironments } as any);
        }

        // Merge parameters
        if (parameters || data.removedParameterIds) {
          const newParameters = mergeParameters(
            currentState.parameters,
            data,
            true  // preserveExisting
          );
          set({ parameters: newParameters } as any);
        }

        // Merge charts
        if (chartMetas || data.removedChartIds || data.clearCharts) {
          const newCharts = mergeCharts(
            currentState.charts,
            data,
            true  // preserveExisting
          );
          set({ charts: newCharts } as any);
        }

        // Trigger updates
        const updatedState = get();
        updatedState.viewUpdateTrigger.set();
        updatedState.parameterUpdateTrigger.set();
        updatedState.environmentUpdateTrigger.set();
      },

      clearAll: () => {
        const currentState = get();
        set({
          connected: false,
          currentTime: 0,
          environments: new Map(),
          parameters: new Map(),
          charts: currentState.charts.shallowCopy(), // Keep structure but clear data
          snapshots: [],
          logs: [],
          lastLogs: undefined,
        } as any);
      },
    };

    return state as ScenarioStore;
  });
};
