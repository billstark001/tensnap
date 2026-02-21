import { create } from 'zustand';
import { ScenarioStore, SetDataPayload, SetDataOptions } from './types';
import { createStoreContext } from '@/utils/zustand';
import { createConnectionSlice } from './slices/connection';
import { createTimeSlice } from './slices/time';
import { createActionsSlice } from './slices/action';
import { createEnvironmentsSlice } from './slices/environment';
import { createParametersSlice } from './slices/parameter';
import { createChartsSlice } from './slices/chart';
import { createSnapshotsSlice } from './slices/snapshot';
import { createViewsSlice } from './slices/view';
import { createLogsSlice } from './slices/log';
import { mergeEnvironments, mergeParameters, mergeCharts } from './utils';
import { serializeEnvironment } from './environment';
import { createAutoLayout } from '@/components/view/utils/pack';
import { createUpdateTriggerStoreFunction } from '../update-trigger';

const getEnvironmentMetadata = (env: any) => ({
  id: env.id,
  type: env.type,
  label: env.label,
  width: env.props?.width,
  height: env.props?.height,
});

export const createScenarioStore = () => create<ScenarioStore>((set, get, store) => ({
  ...createConnectionSlice(set as any, get, store),
  ...createTimeSlice(set as any, get, store),
  ...createActionsSlice(set as any, get, store),
  ...createEnvironmentsSlice(set as any, get, store),
  ...createParametersSlice(set as any, get, store),
  ...createChartsSlice(set as any, get, store),
  ...createSnapshotsSlice(set as any, get, store),
  ...createViewsSlice(set as any, get, store),
  ...createLogsSlice(set as any, get, store),

  viewUpdateTrigger: createUpdateTriggerStoreFunction(x => set((y) => ({ viewUpdateTrigger: { ...y.viewUpdateTrigger, ...x } })), () => get().viewUpdateTrigger, null!),
  parameterUpdateTrigger: createUpdateTriggerStoreFunction(x => set((y) => ({ parameterUpdateTrigger: { ...y.parameterUpdateTrigger, ...x } })), () => get().parameterUpdateTrigger, null!),
  environmentUpdateTrigger: createUpdateTriggerStoreFunction(x => set((y) => ({ environmentUpdateTrigger: { ...y.environmentUpdateTrigger, ...x } })), () => get().environmentUpdateTrigger, null!),

  dump: () => {
    const store = get();
    return {
      connected: false,
      currentTime: store.currentTime,
      environments: Array.from(store.environments.values()).map(serializeEnvironment),
      parameters: structuredClone(Array.from(store.parameters.values())),
      actions: structuredClone(Array.from(store.actions.values())),
      charts: structuredClone(store.charts.getGroupList()),
      snapshots: structuredClone(store.snapshots),
    };
  },

  setData: (data: SetDataPayload, options?: SetDataOptions) => {
    const { updateLayout = true, preserveExisting = false } = options || {};
    const state = get();

    if (!preserveExisting && data.removedEnvironmentIds) {
      const { removeEnvironment } = state;
      for (const envId of data.removedEnvironmentIds) {
        removeEnvironment(envId);
      }
    }

    const environments = mergeEnvironments(state.environments, data, preserveExisting);
    const parameters = mergeParameters(state.parameters, data, preserveExisting);
    const charts = mergeCharts(state.charts, data, preserveExisting);

    set({ environments, parameters, charts });

    if (updateLayout) {
      const removedEnvIds = new Set(data.removedEnvironmentIds || []);
      const removedParamIds = new Set(data.removedParameterIds || []);
      const removedChartIds = new Set(data.removedChartIds || []);

      const activeEnvironments = Array.from(environments.values())
        .filter(env => !removedEnvIds.has(env.id))
        .map(getEnvironmentMetadata);
      const activeParameters = Array.from(parameters.values()).filter(p => !removedParamIds.has(p.id));
      const activeCharts = charts.getGroupList().filter(c => !removedChartIds.has(c.id));

      set({
        mainView: createAutoLayout(
          state.mainView,
          activeEnvironments,
          activeParameters,
          activeCharts,
          { disableMissingViews: preserveExisting },
          Array.from(state.actions.values()),
        )
      });
    }
  },

  clearAll: () => {
    const state = get();

    state.environments.forEach(env => {
      if (env.type === 'grid') {
        (env as any).agentTraces = {};
      }
      env.agents = {};
    });
    state.environments.clear();
    state.parameters.clear();
    state.actions.clear();
    state.charts.clearAll();

    set({
      snapshots: [],
      logs: [],
      lastLogs: undefined,
    });

    state.viewUpdateTrigger.reset();
    state.parameterUpdateTrigger.reset();
    state.environmentUpdateTrigger.reset();
  },
}));

export const {
  Provider: ScenarioStoreProvider,
  useStore: useScenarioStore,
} = createStoreContext<ScenarioStore>();

export * from './types';