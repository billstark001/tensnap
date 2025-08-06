import { create } from 'zustand';
import { Environment, Parameter, ChartData, Snapshot } from '../types';

interface SimulationStore {
  // State
  connected: boolean;
  currentTime: number;
  environments: Environment[];
  parameters: Parameter[];
  charts: ChartData[];
  snapshots: Snapshot[];
  maxSnapshots: number;
  
  // Actions
  setConnected: (connected: boolean) => void;
  setCurrentTime: (time: number) => void;
  setEnvironments: (environments: Environment[]) => void;
  updateEnvironment: (id: string | number, data: Partial<Environment>) => void;
  setParameters: (parameters: Parameter[]) => void;
  updateParameter: (id: string, value: any) => void;
  setCharts: (charts: ChartData[]) => void;
  addChartData: (chartId: string, time: number, value: number) => void;
  addSnapshot: (snapshot: Snapshot) => void;
  clearSnapshots: () => void;
  setMaxSnapshots: (max: number) => void;
}

export const useSimulationStore = create<SimulationStore>((set) => ({
  // Initial state
  connected: false,
  currentTime: 0,
  environments: [],
  parameters: [],
  charts: [],
  snapshots: [],
  maxSnapshots: 100,
  
  // Actions
  setConnected: (connected) => set({ connected }),
  
  setCurrentTime: (time) => set({ currentTime: time }),
  
  setEnvironments: (environments) => set({ environments }),
  
  updateEnvironment: (id, data) =>
    set((state) => ({
      environments: state.environments.map((env) =>
        env.id === id ? { ...env, ...data } : env
      ),
    })),
  
  setParameters: (parameters) => set({ parameters }),
  
  updateParameter: (id, value) =>
    set((state) => ({
      parameters: state.parameters.map((param) =>
        param.id === id ? { ...param, value } : param
      ),
    })),
  
  setCharts: (charts) => set({ charts }),
  
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
}));