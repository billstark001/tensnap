import { CreateStoreFunction } from '@/utils/zustand';
import { SnapshotsSlice, ScenarioStore } from '../types';
import { serializeEnvironment } from '../environment';
import { Snapshot, SnapshotChartData } from '@/types/model';

export const createSnapshotsSlice: CreateStoreFunction<SnapshotsSlice, ScenarioStore> = (set, get) => ({
  snapshots: [],
  maxSnapshots: 32,

  addSnapshot: (snapshotMetadata) => {
    const { environments, parameters, charts, currentTime } = get();

    const chartData: SnapshotChartData[] = [];
    const allMetadata = charts.getAllMeta();

    for (const meta of allMetadata) {
      const value = charts.getValueAt(meta.id, currentTime);
      if (value !== undefined) {
        chartData.push({ id: meta.id, value });
      }
    }

    const dateNow = Date.now();
    const dateNowStr = new Date(dateNow).toLocaleString();

    const snapshot: Snapshot = {
      id: `snapshot-${dateNowStr}`,
      timestamp: dateNow,
      timeStep: currentTime,
      ...snapshotMetadata,
      environments: Array.from(environments.values()).map(serializeEnvironment),
      parameters: Array.from(parameters.values()).filter(p => p.type !== 'action'),
      chartData,
    };

    set((state) => {
      const newSnapshots = [...state.snapshots, snapshot];
      if (state.maxSnapshots !== -1 && newSnapshots.length > state.maxSnapshots) {
        newSnapshots.shift();
      }
      return { snapshots: newSnapshots };
    });
  },

  removeSnapshot: (id) => {
    set((state) => ({
      snapshots: state.snapshots.filter(snapshot => snapshot.id !== id)
    }));
  },

  clearSnapshots: () => set({ snapshots: [] }),

  setMaxSnapshots: (max) => set({ maxSnapshots: max }),
});