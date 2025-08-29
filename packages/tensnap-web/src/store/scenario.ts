import { create } from 'zustand';
import { Environment, Parameter, ChartData, Snapshot } from '../types/modeling';
import { ContainerView } from '../types/ui';
import { createAutoLayout } from '../utils/layout';
import { SetStateAction } from 'react';
import { createStoreContext } from '@/utils/zustand';
import { createDefaultRootLayout } from '@/utils/layout/pack-layout';

export interface ScenarioStore {
  // State
  connected: boolean;
  currentTime: number;
  environments: Environment[];
  parameters: Parameter[];
  charts: ChartData[];
  snapshots: Snapshot[];
  maxSnapshots: number;
  mainView: ContainerView;

  // Actions
  setConnected: (connected: boolean) => void;
  setCurrentTime: (time: number) => void;
  setEnvironments: (environments: Environment[], updateLayout?: boolean) => void;
  updateEnvironment: (id: string | number, data: SetStateAction<Environment>) => void;
  setParameters: (parameters: Parameter[], updateLayout?: boolean) => void;
  updateParameter: (id: string, value: any) => void;
  setCharts: (charts: ChartData[], updateLayout?: boolean) => void;
  addChartData: (chartId: string, time: number, value: number) => void;
  addSnapshot: (snapshot: Snapshot) => void;
  clearSnapshots: () => void;
  setMaxSnapshots: (max: number) => void;
  setMainView: (view: SetStateAction<ContainerView>) => void;
  updateMainViewLayout: () => void;
}

export const createScenarioStore = () => create<ScenarioStore>((set, get) => ({
  // Initial state
  connected: false,
  currentTime: 0,
  environments: [],
  parameters: [],
  charts: [],
  snapshots: [],
  maxSnapshots: 32,
  mainView: createDefaultRootLayout(),

  // Actions
  setConnected: (connected) => set({ connected }),

  setCurrentTime: (time) => set({ currentTime: time }),

  setEnvironments: (environments, updateLayout) => {
    set({ environments });
    // Auto-update layout when environments change with incremental updates
    if (!updateLayout) {
      return;
    }
    const { parameters, charts, mainView } = get();
    set({ 
      mainView: createAutoLayout(environments, parameters, charts, { 
        currentView: mainView, 
        preserveExisting: true 
      }) 
    });
  },

  updateEnvironment: (id, data) => {
    if (typeof data === 'function') {
      set((state) => ({
        environments: state.environments.map((env) =>
          env.id === id ? data(env) : env
        )
      }))
    } else {
      set((state) => ({
        environments: state.environments.map((env) =>
          env.id === id ? { ...env, ...data } : env
        ),
      }));
    }
  },

  setParameters: (parameters, updateLayout) => {
    set({ parameters });
    // Auto-update layout when parameters change with incremental updates
    if (!updateLayout) {
      return;
    }
    const { environments, charts, mainView } = get();
    set({ 
      mainView: createAutoLayout(environments, parameters, charts, { 
        currentView: mainView, 
        preserveExisting: true 
      }) 
    });
  },

  updateParameter: (id, value) => {
    set((state) => ({
      parameters: state.parameters.map((param) =>
        param.id === id ? { ...param, value } : param
      ),
    }));
  },

  setCharts: (charts, updateLayout) => {
    set({ charts });
    // Auto-update layout when charts change with incremental updates
    if (!updateLayout) {
      return;
    }
    const { environments, parameters, mainView } = get();
    set({ 
      mainView: createAutoLayout(environments, parameters, charts, { 
        currentView: mainView, 
        preserveExisting: true 
      }) 
    });
  },

  addChartData: (chartId, time, value) =>
    set((state) => ({
      charts: state.charts.map((chart) =>
        chart.id === chartId
          ? { ...chart, data: [...chart.data, { time, value }] }
          : chart
      ),
    })),

  addSnapshot: (snapshot) =>
    set((state) => {
      const newSnapshots = [...state.snapshots, snapshot];
      if (newSnapshots.length > state.maxSnapshots && state.maxSnapshots !== -1) {
        newSnapshots.shift();
      }
      return { snapshots: newSnapshots };
    }),

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
    set({ 
      mainView: createAutoLayout(environments, parameters, charts, { 
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