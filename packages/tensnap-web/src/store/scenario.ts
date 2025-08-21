import { create } from 'zustand';
import { Environment, Parameter, ChartData, Snapshot } from '../types/modeling';
import { ContainerView } from '../types/ui';
import { createAutoLayout } from '../utils/layout';
import { SetStateAction } from 'react';
import { createStoreContext } from '@/utils/zustand';

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
  setEnvironments: (environments: Environment[]) => void;
  updateEnvironment: (id: string | number, data: SetStateAction<Environment>) => void;
  setParameters: (parameters: Parameter[]) => void;
  updateParameter: (id: string, value: any) => void;
  setCharts: (charts: ChartData[]) => void;
  addChartData: (chartId: string, time: number, value: number) => void;
  addSnapshot: (snapshot: Snapshot) => void;
  clearSnapshots: () => void;
  setMaxSnapshots: (max: number) => void;
  setMainView: (view: ContainerView) => void;
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
  mainView: createAutoLayout([], [], []),

  // Actions
  setConnected: (connected) => set({ connected }),

  setCurrentTime: (time) => set({ currentTime: time }),

  setEnvironments: (environments) => {
    set({ environments });
    // Auto-update layout when environments change
    const { parameters, charts } = get();
    set({ mainView: createAutoLayout(environments, parameters, charts) });
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
    // Auto-update layout when environments change
    const { environments, parameters, charts } = get();
    set({ mainView: createAutoLayout(environments, parameters, charts) });
  },

  setParameters: (parameters) => {
    set({ parameters });
    // Auto-update layout when parameters change
    const { environments, charts } = get();
    set({ mainView: createAutoLayout(environments, parameters, charts) });
    console.log(get());
  },

  updateParameter: (id, value) => {
    set((state) => ({
      parameters: state.parameters.map((param) =>
        param.id === id ? { ...param, value } : param
      ),
    }));
  },

  setCharts: (charts) => {
    set({ charts });
    // Auto-update layout when charts change
    const { environments, parameters } = get();
    set({ mainView: createAutoLayout(environments, parameters, charts) });
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

  setMainView: (view) => set({ mainView: view }),

  updateMainViewLayout: () => {
    const { environments, parameters, charts } = get();
    set({ mainView: createAutoLayout(environments, parameters, charts) });
  },
}));

export const {
  Provider: ScenarioStoreProvider,
  useStore: useScenarioStore,
} = createStoreContext<ScenarioStore>();