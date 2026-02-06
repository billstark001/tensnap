import { CreateStoreFunction } from '../state-manager';
import { ChartsSlice, ScenarioStore } from '../core-types';
import { InstantiatedChartStorage } from '../chart';

export const createChartsSlice: CreateStoreFunction<ChartsSlice, ScenarioStore> = (set, get) => ({
  charts: new InstantiatedChartStorage([]),

  updateChartProps: (id, propsUpdate) => {
    const { charts, log } = get();
    const group = charts.allChartGroups.get(id);
    if (!group) {
      log(`Chart group with id ${id} not found.`, 'warning');
      return;
    }
    Object.assign(group, propsUpdate);
    set({ charts });
  },

  addChartMetadata: (groupId, metadata) => {
    const { charts, log } = get();
    const group = charts.allChartGroups.get(groupId);
    if (!group) {
      log(`Chart group with id ${groupId} not found.`, 'warning');
      return;
    }
    if (metadata.id in group.metadataDict) {
      log(`Metadata with id ${metadata.id} already exists in group ${groupId}.`, 'warning');
      return;
    }

    group.metadataDict[metadata.id] = metadata;

    const metaList = charts.allChartMetadata.get(metadata.id) ?? [];
    metaList.push(metadata);
    charts.allChartMetadata.set(metadata.id, metaList);

    const groupList = charts.chartGroupsByMetadataId.get(metadata.id) ?? [];
    groupList.push(group);
    charts.chartGroupsByMetadataId.set(metadata.id, groupList);

    set({ charts });
  },

  renameChartGroup: (groupId, newId) => {
    const { charts, log } = get();
    charts.renameChartGroup(groupId, newId, (msg) => log(msg, 'warning'));
  },

  renameChartMetadata: (metadataId, newId, groupId) => {
    const { charts, log } = get();
    charts.renameChartMetadata(metadataId, newId, groupId, (msg) => log(msg, 'warning'));
  },

  updateChartMetadata: (metadataId, propsUpdate) => {
    const { charts } = get();
    const metadataList = charts.allChartMetadata.get(metadataId);
    if (!metadataList?.length) return;

    metadataList.forEach(meta => Object.assign(meta, propsUpdate));
    set({ charts });
  },

  removeChartMetadataFromGroup: (metadataId, groupId, options) => {
    const { charts } = get();
    charts.removeChartMetadataFromGroup(metadataId, groupId, options);
    set({ charts });
  },

  moveChartMetadata: (metadataId, fromGroupId, toGroupId, options) => {
    const { charts, log } = get();
    const { copy = false } = options || {};

    const fromGroup = charts.allChartGroups.get(fromGroupId);
    const toGroup = charts.allChartGroups.get(toGroupId);

    if (!fromGroup || !toGroup) {
      log(`Chart group not found: ${!fromGroup ? fromGroupId : toGroupId}`, 'warning');
      return;
    }

    const metadata = fromGroup.metadataDict[metadataId];
    if (!metadata) {
      log(`Metadata with id ${metadataId} not found in group ${fromGroupId}.`, 'warning');
      return;
    }

    const dataPoints = charts.removeChartMetadataFromGroup(metadataId, fromGroupId, {
      persistData: copy,
      returnData: true
    });

    if (!(metadataId in toGroup.metadataDict)) {
      toGroup.metadataDict[metadataId] = metadata;

      const metaList = charts.allChartMetadata.get(metadataId) ?? [];
      metaList.push(metadata);
      charts.allChartMetadata.set(metadataId, metaList);

      const groupList = charts.chartGroupsByMetadataId.get(metadataId) ?? [];
      groupList.push(toGroup);
      charts.chartGroupsByMetadataId.set(metadataId, groupList);
    }

    if (dataPoints?.length) {
      charts.pushMany(metadataId, dataPoints);
    }

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
        charts.allChartGroups.has(id)
          ? charts.clearByGroup([id])
          : charts.clearByMetadata([id]);
      }
    }
  },
});