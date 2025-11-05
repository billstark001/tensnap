import { create } from 'zustand';
import { Environment, Parameter, Snapshot, PureEnvironment, EnvironmentId, Agent, SnapshotMetadata, AgentId, ChartUpdateData, ChartGroupMetadata, ChartMetadata, ChartUpdateOperation } from '../types/model';
import { ContainerView } from '../types/ui';
import { createAutoLayout } from '../utils/layout';
import { SetStateAction } from 'react';
import { createStoreContext } from '@/utils/zustand';
import { createDefaultRootLayout } from '@/utils/layout/pack-layout';
import { instantiateChartMetadata, InstantiatedChartStorage, InstantiatedEnvironment, instantiateEnvironment, sanitizeParameter, serializeEnvironment } from '@/store/scenario-inst';

export interface SetDataPayload {
  environments?: Environment[];
  parameters?: Parameter[];
  charts?: ChartGroupMetadata[];

  removedEnvironmentIds?: EnvironmentId[];
  removedParameterIds?: string[];
  removedChartIds?: string[];

  clearCharts?: boolean | string[];
}

export interface SetDataOptions {
  updateLayout?: boolean;
  preserveExisting?: boolean;
}
export interface ScenarioStore {
  // State
  connected: boolean;
  currentTime: number;
  isInTimeStep: boolean;
  environments: Map<EnvironmentId, InstantiatedEnvironment>;
  parameters: Parameter[];
  charts: InstantiatedChartStorage;
  snapshots: Snapshot[];
  maxSnapshots: number;
  mainView: ContainerView;

  // Actions
  setConnected: (connected: boolean) => void;
  setCurrentTime: (time: number | null | undefined, isInTimeStep: boolean) => void;
  setData: (data: SetDataPayload, options?: SetDataOptions) => void;
  updateEnvironment: (id: EnvironmentId, data: PureEnvironment) => void;
  updateAgents: (id: EnvironmentId, updates: { id: AgentId; data: Partial<Agent> }[]) => void;
  updateParameter: (id: string, value: any) => void;
  addChartData: (updates: ChartUpdateData[]) => void;
  executeChartOperations: (operations: ChartUpdateOperation[]) => void;
  addSnapshot: (snapshot: SnapshotMetadata) => void;
  clearSnapshots: () => void;
  setMaxSnapshots: (max: number) => void;
  setMainView: (view: SetStateAction<ContainerView>) => void;
  updateMainViewLayout: () => void;
}

export const createScenarioStore = () => create<ScenarioStore>((set, get) => ({
  // Initial state
  connected: false,
  currentTime: 0,
  isInTimeStep: false,
  environments: new Map(),
  parameters: [],
  charts: new InstantiatedChartStorage([]),
  snapshots: [],
  maxSnapshots: 32,
  mainView: createDefaultRootLayout(),

  // Actions
  setConnected: (connected) => set({ connected }),

  setCurrentTime: (time, isInTimeStep) => {
    if (time == null) {
      set({ isInTimeStep });
    } else {
      set({ currentTime: time, isInTimeStep });
    }
  },

  setData: (data, options) => {
    const {
      updateLayout = true,
      preserveExisting = false,
    } = options || {};

    const {
      environments,
      parameters,
      charts,
    } = get();

    const updates: Partial<Pick<ScenarioStore, 'environments' | 'parameters' | 'charts'>> = {};

    if (data.environments !== undefined || data.removedEnvironmentIds !== undefined) {
      if (preserveExisting) {
        const newEnvironments = new Map(environments);
        for (const id of data.removedEnvironmentIds || []) {
          newEnvironments.delete(id);
        }
        for (const env of data.environments || []) {
          newEnvironments.set(env.id, instantiateEnvironment(env));
        }
        updates.environments = newEnvironments;
      }
      else {
        updates.environments = new Map(data.environments?.map(env => [env.id, instantiateEnvironment(env)]));
      }
    }

    if (data.parameters !== undefined || data.removedParameterIds !== undefined) {
      const oldParameters = preserveExisting ? parameters.slice() : [];
      const newParameters: Parameter[] = [];
      const newParametersMap = new Map(data.parameters?.map(param => [param.id, param]));
      const removedIds = new Set(data.removedParameterIds || []);
      for (const oldParam of oldParameters) {
        if (removedIds.has(oldParam.id)) {
          continue;
        }
        const mightBeNew = newParametersMap.get(oldParam.id);
        if (mightBeNew) {
          newParameters.push(sanitizeParameter({ ...oldParam, ...mightBeNew }, true));
          newParametersMap.delete(oldParam.id);
        } else {
          newParameters.push(sanitizeParameter(oldParam, false));
        }
      }
      for (const [, param] of newParametersMap) {
        newParameters.push(sanitizeParameter(param, false));
      }
      updates.parameters = newParameters;
    }

    if (data.charts !== undefined || data.removedChartIds !== undefined || data.clearCharts !== undefined) {
      const newCharts = preserveExisting ? charts.shallowCopy() : new InstantiatedChartStorage([]);
      const removedChartIdsSet = new Set(data.removedChartIds || []);
      const clearChartIdsSet = new Set<string>(data.clearCharts === true ? [] : (Array.isArray(data.clearCharts) ? data.clearCharts : []));
      const clearAllCharts = data.clearCharts === true;
      // 0. divide chart metadata with has / does not have groups
      const chartGroupMetadata: ChartGroupMetadata[] = [];
      const chartMetadata: ChartMetadata[] = [];
      for (const chartMeta of data.charts || []) {
        if (chartMeta.dataList?.length) {
          chartGroupMetadata.push(chartMeta);
        } else {
          chartMetadata.push(chartMeta);
        }
      }
      // 1. remove charts
      for (const chartId of removedChartIdsSet) {
        newCharts.removeChartGroup(chartId)
          || newCharts.removeChartGroupsByMetadata(chartId);
      }
      // 2. commit chart group changes
      for (const chartGroupMeta of chartGroupMetadata) {
        newCharts.addChartGroup(instantiateChartMetadata(chartGroupMeta), true);
      }
      for (const chartMeta of chartMetadata) {
        newCharts.upsertChartMetadata(chartMeta);
      }
      // 3. clear chart data if needed
      if (clearAllCharts) {
        newCharts.clearAll();
      } else if (clearChartIdsSet.size > 0) {
        const clearedGroupIds = newCharts.clearByGroup(Array.from(clearChartIdsSet));
        for (const groupId of clearedGroupIds) {
          clearChartIdsSet.delete(groupId);
        }
        newCharts.clearByMetadata(Array.from(clearChartIdsSet));
      }
      updates.charts = newCharts;
    }

    set(updates);

    // Auto-update layout when data changes with incremental updates
    if (updateLayout) {
      const { environments, parameters, charts, mainView } = get();
      const environmentsArray = Array.from(environments.values()).map(({ id, type, label }) => ({ id, type, label }));
      set({
        mainView: createAutoLayout(environmentsArray, parameters, charts.getGroups(), {
          currentView: mainView,
          preserveExisting: true
        })
      });
    }
  },

  updateEnvironment: (id, propsUpdate) => {
    const { environments } = get();
    const env = environments.get(id);
    if (!env) {
      console.warn(`Environment with id ${id} not found.`);
      return;
    }
    environments.set(id, { ...env, props: { ...env.props, ...propsUpdate } });
  },

  updateAgents: (envId, updates) => {
    const { environments } = get();
    const env = environments.get(envId);
    if (!env) {
      console.warn(`Environment with id ${envId} not found.`);
      return;
    }
    const { agents } = env;
    for (const update of updates) {
      const { id, data } = update;
      if (!agents[id]) {
        console.warn(`Agent with id ${id} not found in ${env.type} environment ${envId}.`);
        continue;
      }
      Object.assign(agents[id], data);
    }
    environments.set(envId, { ...env, agents });
  },


  updateParameter: (id, value) => {
    set((state) => ({
      parameters: state.parameters.map((param) =>
        param.id === id ? { ...param, value } : param
      ),
    }));
  },

  addChartData: (updates) => {
    const { charts, currentTime } = get();
    charts.push(currentTime, updates);
  },

  executeChartOperations: (operations) => {
    const { charts } = get();
    for (const operation of operations) {
      const { id, operation: type } = operation;
      if (type === 'clear') {
        if (charts.allChartGroups.has(id)) {
          charts.clearByGroup([id]);
        } else {
          charts.clearByMetadata([id]);
        }
      }
    }
  },

  addSnapshot: (snapshotMetadata: SnapshotMetadata) => {
    return; // TODO optimize performance
    const { environments, parameters } = get();
    const snapshot: Snapshot = {
      ...snapshotMetadata,
      environments: Array.from(environments.values()).map(env => serializeEnvironment(env)),
      parameters: parameters,
    };
    set((state) => {
      const newSnapshots = [...state.snapshots, snapshot];
      if (newSnapshots.length > state.maxSnapshots && state.maxSnapshots !== -1) {
        newSnapshots.shift();
      }
      return { snapshots: newSnapshots };
    })
  },

  clearSnapshots: () => set({ snapshots: [] }),

  setMaxSnapshots: (max) => set({ maxSnapshots: max }),

  setMainView: (view) => {
    if (typeof view === 'function') {
      set((state) => ({ mainView: view(state.mainView) }));
    } else {
      set({ mainView: view });
    }
  },

  updateMainViewLayout: () => {
    const { environments, parameters, charts, mainView } = get();
    const environmentsArray = Array.from(environments.values()).map(({ id, type, label }) => ({ id, type, label }));
    set({
      mainView: createAutoLayout(environmentsArray, parameters, charts.getGroups(), {
        currentView: mainView,
        preserveExisting: true
      })
    });
  },
}));

export const {
  Provider: ScenarioStoreProvider,
  useStore: useScenarioStore,
} = createStoreContext<ScenarioStore>();