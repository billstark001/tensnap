import { CreateStoreFunction } from '@/utils/zustand';
import { ChartsSlice, ScenarioStore } from '../types';
import { ChartStorage } from 'tensnap-web-core';

export const createChartsSlice: CreateStoreFunction<ChartsSlice, ScenarioStore> = (set, get) => ({
  charts: new ChartStorage(),

  updateChartProps: (id, propsUpdate) => {
    const { charts, log } = get();
    const group = charts.getGroup(id);
    if (!group) {
      log(`Chart group with id ${id} not found.`, 'warning');
      return;
    }
    Object.assign(group, propsUpdate);
    set({ charts });
  },

  addChartMetadata: (groupId, metadata) => {
    const { charts, log } = get();
    charts.addMeta(groupId, metadata, (msg) => log(msg, 'warning'));
    set({ charts });
  },

  renameChartGroup: (groupId, newId) => {
    const { charts, log } = get();
    charts.renameGroup(groupId, newId, (msg) => log(msg, 'warning'));
  },

  renameChartMetadata: (metadataId, newId, groupId) => {
    const { charts, log } = get();
    charts.renameMeta(metadataId, newId, groupId, (msg) => log(msg, 'warning'));
  },

  updateChartMetadata: (metadataId, propsUpdate) => {
    const { charts } = get();
    charts.updateMeta(metadataId, propsUpdate);
    set({ charts });
  },

  removeChartMetadataFromGroup: (metadataId, groupId, options) => {
    const { charts } = get();
    charts.removeMetaFromGroup(metadataId, groupId, options);
    set({ charts });
  },

  moveChartMetadata: (metadataId, fromGroupId, toGroupId, options) => {
    const { charts, log } = get();
    charts.moveMeta(metadataId, fromGroupId, toGroupId, options, (msg) => log(msg, 'warning'));
    set({ charts });
  },

  addChartData: (updates) => {
    const { charts, currentTime } = get();
    charts.push(currentTime, updates);
  },

  executeChartOperations: (operations) => {
    const { charts } = get();
    for (const { id, operation: type } of operations) {
      if (type === 'clear') {
        charts.hasGroup(id)
          ? charts.clearGroups([id])
          : charts.clearMetas([id]);
      }
    }
  },
});
