import { create } from 'zustand';
import { Environment, Parameter, ChartData, Snapshot, PureEnvironment, EnvironmentId, Agent, SnapshotMetadata, AgentId } from '../types/model';
import { ContainerView } from '../types/ui';
import { createAutoLayout } from '../utils/layout';
import { SetStateAction } from 'react';
import { createStoreContext } from '@/utils/zustand';
import { createDefaultRootLayout } from '@/utils/layout/pack-layout';
import { InstantiatedEnvironment, instantiateEnvironment, serializeEnvironment } from '@/types/model-inst';

export interface SetDataPayload {
  environments?: Environment[];
  parameters?: Parameter[];
  charts?: ChartData[];
}

export interface ScenarioStore {
  // State
  connected: boolean;
  currentTime: number;
  environments: Map<EnvironmentId, InstantiatedEnvironment>;
  parameters: Parameter[];
  charts: ChartData[];
  snapshots: Snapshot[];
  maxSnapshots: number;
  mainView: ContainerView;

  // Actions
  setConnected: (connected: boolean) => void;
  setCurrentTime: (time: number) => void;
  setData: (data: SetDataPayload, updateLayout?: boolean) => void;
  updateEnvironment: (id: EnvironmentId, data: PureEnvironment) => void;
  updateAgents: (id: EnvironmentId, updates: { id: AgentId; data: Partial<Agent> }[]) => void;
  updateParameter: (id: string, value: any) => void;
  addChartData: (chartId: string, time: number, value: number) => void;
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
  environments: new Map(),
  parameters: [],
  charts: [],
  snapshots: [],
  maxSnapshots: 32,
  mainView: createDefaultRootLayout(),

  // Actions
  setConnected: (connected) => set({ connected }),

  setCurrentTime: (time) => set({ currentTime: time }),

  setData: (data, updateLayout = true) => {
    const updates: Partial<Pick<ScenarioStore, 'environments' | 'parameters' | 'charts'>> = {};
    
    if (data.environments !== undefined) {
      updates.environments = new Map(data.environments.map(env => [env.id, instantiateEnvironment(env)]));
    }
    if (data.parameters !== undefined) {
      updates.parameters = data.parameters;
    }
    if (data.charts !== undefined) {
      updates.charts = data.charts;
    }
    
    set(updates);
    
    // Auto-update layout when data changes with incremental updates
    if (updateLayout) {
      const { environments, parameters, charts, mainView } = get();
      const environmentsArray = Array.from(environments.values()).map(({ id, type }) => ({ id, type })); 
      set({
        mainView: createAutoLayout(environmentsArray, parameters, charts, {
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
    set({ environments });
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
    set({ environments });
  },


  updateParameter: (id, value) => {
    set((state) => ({
      parameters: state.parameters.map((param) =>
        param.id === id ? { ...param, value } : param
      ),
    }));
  },

  addChartData: (chartId, time, value) =>
    set((state) => ({
      charts: state.charts.map((chart) =>
        chart.id === chartId
          ? { ...chart, data: [...chart.data, { time, value }] }
          : chart
      ),
    })),

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
      mainView: createAutoLayout(environmentsArray, parameters, charts, {
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