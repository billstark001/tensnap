import { create } from 'zustand';
import { Environment, Parameter, Snapshot, PureEnvironment, EnvironmentId, Agent, SnapshotMetadata, AgentId, ChartMetadata, ChartDataUpdate } from '../types/model';
import { ContainerView } from '../types/ui';
import { createAutoLayout } from '../utils/layout';
import { SetStateAction } from 'react';
import { createStoreContext } from '@/utils/zustand';
import { createDefaultRootLayout } from '@/utils/layout/pack-layout';
import { instantiateChartMetadata, InstantiatedChartDataStorage, InstantiatedEnvironment, instantiateEnvironment, serializeEnvironment } from '@/store/scenario-inst';

export interface SetDataPayload {
  environments?: Environment[];
  parameters?: Parameter[];
  charts?: ChartMetadata[];
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
  charts: InstantiatedChartDataStorage;
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
  addChartData: (updates: ChartDataUpdate[]) => void;
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
  charts: new InstantiatedChartDataStorage([]),
  snapshots: [],
  maxSnapshots: 32,
  mainView: createDefaultRootLayout(),

  // Actions
  setConnected: (connected) => set({ connected }),

  setCurrentTime: (time, isInTimeStep) => {
    // TODO add verification
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

    const { environments, parameters, charts } = get();

    const updates: Partial<Pick<ScenarioStore, 'environments' | 'parameters' | 'charts'>> = {};

    if (data.environments !== undefined) {
      if (preserveExisting) {
        const newEnvironments = new Map(environments);
        for (const env of data.environments) {
          newEnvironments.set(env.id, instantiateEnvironment(env));
        }
        updates.environments = newEnvironments;
      }
      else {
        updates.environments = new Map(data.environments.map(env => [env.id, instantiateEnvironment(env)]));
      }
    }
    if (data.parameters !== undefined) {
      updates.parameters = data.parameters;
    }
    if (data.charts !== undefined) {
      const newCharts = preserveExisting ? charts.shallowCopy() : new InstantiatedChartDataStorage([]);
      for (const chartMeta of data.charts) {
        if (!newCharts.chartDataMapById.has(chartMeta.id)) {
          newCharts.addChartDataGroup(instantiateChartMetadata(chartMeta));
        }
      }
      updates.charts = newCharts;
    }
    
    set(updates);
    
    // Auto-update layout when data changes with incremental updates
    if (updateLayout) {
      const { environments, parameters, charts, mainView } = get();
      const environmentsArray = Array.from(environments.values()).map(({ id, type }) => ({ id, type })); 
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
      const environmentsArray = Array.from(environments.values()).map(({ id, type }) => ({ id, type })); 
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