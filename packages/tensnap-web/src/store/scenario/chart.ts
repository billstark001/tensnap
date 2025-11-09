import { ChartGroupMetadata, ChartGroup, ChartMetadata, NativeDataPoint, ChartUpdateData } from "@/types/model";

export function instantiateChartMetadata(meta: ChartGroupMetadata): ChartGroup {
  const metadataDict: Record<string, ChartMetadata> = meta.dataList?.length
    ? meta.dataList.reduce((dict, m) => {
      dict[m.id] = m;
      return dict;
    }, {} as Record<string, ChartMetadata>)
    : { [meta.id]: meta };
  return {
    id: meta.id,
    label: meta.label,
    metadataDict,
    data: [],
  };
}

export function createCsvContent(chartGroup: ChartGroup): string {
  const { metadataDict: metadataList, data } = chartGroup;
  const chartIds = Object.keys(metadataList);

  const header = ['time', ...chartIds].join(',');
  const rows = data.map(dp => {
    const row = [dp.time.toString()];
    for (const chartId of chartIds) {
      row.push(dp[chartId] !== undefined ? dp[chartId].toString() : '');
    }
    return row.join(',');
  });

  rows.unshift(header);

  return rows.join('\n');
}

export class InstantiatedChartStorage {

  readonly allChartGroups: Map<string, ChartGroup> = new Map();
  readonly allChartMetadata: Map<string, ChartMetadata[]> = new Map();
  readonly chartGroupsByMetadataId = new Map<string, ChartGroup[]>();

  private readonly _pushMap: Map<string, Map<number, NativeDataPoint>> = new Map();

  constructor(groups: ChartGroup[]) {
    for (const group of groups) {
      this.addChartGroup(group);
    }
  }

  getGroups(): ChartGroup[] {
    return Array.from(this.allChartGroups.values());
  }

  shallowCopy(): InstantiatedChartStorage {
    const newStorage = new InstantiatedChartStorage([]);
    for (const [groupId, group] of this.allChartGroups.entries()) {
      newStorage.allChartGroups.set(groupId, group);
      newStorage._pushMap.set(groupId, new Map());
    }
    for (const [chartId, metadataList] of this.allChartMetadata.entries()) {
      newStorage.allChartMetadata.set(chartId, metadataList);
    }
    for (const [groupId, groupList] of this.chartGroupsByMetadataId.entries()) {
      newStorage.chartGroupsByMetadataId.set(groupId, groupList);
    }
    return newStorage;
  }

  addChartGroup(group: ChartGroup, upsert: boolean = false) {
    let newGroup = group;
    let addedMetadataIds = new Set<string>(Object.keys(group.metadataDict));
    // merge with existing group if overwrite is true
    if (upsert && this.allChartGroups.has(group.id)) {
      const existingGroup = this.allChartGroups.get(group.id)!;
      existingGroup.label = group.label;
      const existingMetadataIds = new Set(Object.keys(existingGroup.metadataDict));
      for (const metadataId in group.metadataDict) {
        if (!existingMetadataIds.has(metadataId)) {
          existingGroup.metadataDict[metadataId] = group.metadataDict[metadataId];
        } else {
          addedMetadataIds.delete(metadataId);
        }
      }
      existingGroup.data.push(...group.data);
      newGroup = existingGroup;
    }
    this.allChartGroups.set(group.id, newGroup);
    // maintain metadata maps
    for (const metadata of addedMetadataIds) {
      const meta = newGroup.metadataDict[metadata];

      const existing = this.allChartMetadata.get(meta.id) || [];
      existing.push(meta);
      this.allChartMetadata.set(meta.id, existing);

      const existingGroups = this.chartGroupsByMetadataId.get(meta.id) || [];
      existingGroups.push(group);
      this.chartGroupsByMetadataId.set(meta.id, existingGroups);
    }

    this._pushMap.set(group.id, new Map());
  }

  upsertChartMetadata(metadata: ChartMetadata) {
    const existingMetadata = this.allChartMetadata.get(metadata.id) || [];
    if (existingMetadata.length === 0) {
      this.addChartGroup(instantiateChartMetadata(metadata));
      return;
    } else {
      for (const meta of existingMetadata) {
        Object.assign(meta, metadata);
      }
    }
  }

  removeChartGroup(groupId: string) {
    const group = this.allChartGroups.get(groupId);
    if (!group) return false;
    for (const metadata in group.metadataDict) {
      const meta = group.metadataDict[metadata];
      const existing = this.allChartMetadata.get(meta.id);
      if (existing) {
        const filtered = existing.filter(m => m.id !== meta.id);
        if (filtered.length === 0) {
          this.allChartMetadata.delete(meta.id);
        } else {
          this.allChartMetadata.set(meta.id, filtered);
        }
      }
      const existingGroups = this.chartGroupsByMetadataId.get(meta.id);
      if (existingGroups) {
        const filteredGroups = existingGroups.filter(g => g.id !== groupId);
        if (filteredGroups.length === 0) {
          this.chartGroupsByMetadataId.delete(meta.id);
        } else {
          this.chartGroupsByMetadataId.set(meta.id, filteredGroups);
        }
      }
    }
    this.allChartGroups.delete(groupId);
    this._pushMap.delete(groupId);
    return true;
  }

  removeChartGroupsByMetadata(metadataId: string) {
    const groups = this.chartGroupsByMetadataId.get(metadataId);
    if (!groups?.length) {
      return false;
    }
    for (const group of groups) {
      if (Object.keys(group.metadataDict).length === 1) {
        this.removeChartGroup(group.id);
      } else {
        delete group.metadataDict[metadataId];
        group.data.forEach(dp => {
          delete dp[metadataId];
        });
      }
    }
    this.chartGroupsByMetadataId.delete(metadataId);
    this.allChartMetadata.delete(metadataId);
    return true;
  }

  getAllChartIds(): string[] {
    return Array.from(this.allChartMetadata.keys());
  }

  getAllChartMetadata(): ChartMetadata[] {
    const allMetadata: ChartMetadata[] = [];
    const metadataIdSet = new Set<string>();
    for (const metadataList of this.allChartMetadata.values()) {
      for (const metadata of metadataList) {
        if (!metadataIdSet.has(metadata.id)) {
          allMetadata.push(metadata);
          metadataIdSet.add(metadata.id);
        }
      }
    }
    return allMetadata;
  }

  push(currentTime: number, dataPoints: ChartUpdateData[]) {
    for (const m of this._pushMap.values()) {
      m.clear();
    }
    for (const { id, time = currentTime, value } of dataPoints) {
      const allGroups = this.chartGroupsByMetadataId.get(id);
      if (!allGroups) {
        console.warn(`Chart with id ${id} not found.`);
        continue;
      }
      for (const group of allGroups) {
        const m = this._pushMap.get(group.id)!;
        const timePoint = m.get(time) || { time };
        timePoint[id] = value;
        m.set(time, timePoint);
      }
    }
    for (const [groupId, m] of this._pushMap.entries()) {
      if (!m.size) continue;
      const group = this.allChartGroups.get(groupId)!;
      for (const dataPoint of m.values()) {
        group.data.push(dataPoint);
      }
    }
  }

  clearAll() {
    for (const group of this.allChartGroups.values()) {
      group.data = [];
    }
  }

  clearByGroup(groupIds: string[]) {
    const clearedGroupIds = new Set<string>();
    for (const groupId of groupIds) {
      const group = this.allChartGroups.get(groupId);
      if (group) {
        group.data = [];
        clearedGroupIds.add(groupId);
      }
    }
    return clearedGroupIds;
  }

  clearByMetadata(metadataIds: string[]) {
    const metadataToClear = new Map<string, Set<string>>(); // groupId -> metadataIds[]
    const clearedMetadataIds = new Set<string>();
    for (const metadataId of metadataIds) {
      const groups = this.chartGroupsByMetadataId.get(metadataId);
      if (groups?.length) {
        for (const group of groups) {
          if (!metadataToClear.has(group.id)) {
            metadataToClear.set(group.id, new Set());
          }
          metadataToClear.get(group.id)!.add(metadataId);
        }
        clearedMetadataIds.add(metadataId);
      }
    }
    for (const [groupId, metaIds] of metadataToClear.entries()) {
      const group = this.allChartGroups.get(groupId);
      if (group) {
        const metaIdsArray = Array.from(metaIds);
        if (metaIdsArray.length === Object.keys(group.metadataDict).length) {
          // all metadata in this group need to be cleared
          group.data = [];
          continue;
        }
        group.data = group.data.map(dp => {
          const newDp = { ...dp };
          for (const metaId of metaIdsArray) {
            delete newDp[metaId];
          }
          return newDp;
        });
      }
    }
    return clearedMetadataIds;
  }

}