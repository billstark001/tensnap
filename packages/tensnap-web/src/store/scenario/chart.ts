import { ChartGroupMetadata, ChartGroup, ChartMetadata, NativeDataPoint, ChartUpdateData } from "@/types/model";

export function instantiateChartMetadata(meta: ChartGroupMetadata): ChartGroup {
  const metadataDict = meta.dataList?.length
    ? Object.fromEntries(meta.dataList.map(m => [m.id, m]))
    : { [meta.id]: meta };

  return {
    id: meta.id,
    label: meta.label,
    metadataDict,
    data: [],
  };
}

export function createCsvContent(chartGroup: ChartGroup): string {
  const { metadataDict, data } = chartGroup;
  const chartIds = Object.keys(metadataDict);

  const header = ['time', ...chartIds].join(',');
  const rows = data.map(dp =>
    [dp.time, ...chartIds.map(id => dp[id] ?? '')].join(',')
  );

  return [header, ...rows].join('\n');
}

export class InstantiatedChartStorage {
  readonly allChartGroups = new Map<string, ChartGroup>();
  readonly allChartMetadata = new Map<string, ChartMetadata[]>();
  readonly chartGroupsByMetadataId = new Map<string, ChartGroup[]>();

  private readonly _pushMap = new Map<string, Map<number, NativeDataPoint>>();

  constructor(groups: ChartGroup[]) {
    groups.forEach(group => this.addChartGroup(group));
  }

  getGroups(): ChartGroup[] {
    return Array.from(this.allChartGroups.values());
  }

  shallowCopy(): InstantiatedChartStorage {
    const newStorage = new InstantiatedChartStorage([]);
    this.allChartGroups.forEach((group, id) => {
      newStorage.allChartGroups.set(id, group);
      newStorage._pushMap.set(id, new Map());
    });
    this.allChartMetadata.forEach((list, id) =>
      newStorage.allChartMetadata.set(id, list)
    );
    this.chartGroupsByMetadataId.forEach((list, id) =>
      newStorage.chartGroupsByMetadataId.set(id, list)
    );
    return newStorage;
  }

  addChartGroup(group: ChartGroup, upsert = false) {
    const existingGroup = this.allChartGroups.get(group.id);

    if (upsert && existingGroup) {
      existingGroup.label = group.label;
      const newMetadataIds = new Set<string>();

      Object.entries(group.metadataDict).forEach(([id, meta]) => {
        if (!(id in existingGroup.metadataDict)) {
          existingGroup.metadataDict[id] = meta;
          newMetadataIds.add(id);
        }
      });

      existingGroup.data.push(...group.data);
      this._registerMetadata(newMetadataIds, existingGroup);
    } else {
      this.allChartGroups.set(group.id, group);
      this._registerMetadata(new Set(Object.keys(group.metadataDict)), group);
      this._pushMap.set(group.id, new Map());
    }
  }

  private _registerMetadata(metadataIds: Set<string>, group: ChartGroup) {
    metadataIds.forEach(id => {
      const meta = group.metadataDict[id];

      const metaList = this.allChartMetadata.get(id) ?? [];
      metaList.push(meta);
      this.allChartMetadata.set(id, metaList);

      const groupList = this.chartGroupsByMetadataId.get(id) ?? [];
      groupList.push(group);
      this.chartGroupsByMetadataId.set(id, groupList);
    });
  }

  upsertChartMetadata(metadata: ChartMetadata) {
    const existing = this.allChartMetadata.get(metadata.id);

    if (!existing?.length) {
      this.addChartGroup(instantiateChartMetadata(metadata));
    } else {
      existing.forEach(meta => Object.assign(meta, metadata));
    }
  }

  removeChartGroup(groupId: string): boolean {
    const group = this.allChartGroups.get(groupId);
    if (!group) return false;

    Object.values(group.metadataDict).forEach(meta => {
      this.removeChartMetadataFromGroup(meta.id, groupId);
    });

    this.allChartGroups.delete(groupId);
    this._pushMap.delete(groupId);
    return true;
  }

  removeChartMetadataFromGroup(metadataId: string, groupId: string) {
    const metaList = this.allChartMetadata.get(metadataId);
    if (metaList) {
      const filtered = metaList.filter(m => {
        const groups = this.chartGroupsByMetadataId.get(m.id);
        return groups?.some(g => g.id === groupId) === false;
      });

      filtered.length
        ? this.allChartMetadata.set(metadataId, filtered)
        : this.allChartMetadata.delete(metadataId);
    }

    const groupList = this.chartGroupsByMetadataId.get(metadataId);
    if (groupList) {
      const filtered = groupList.filter(g => g.id !== groupId);
      filtered.length
        ? this.chartGroupsByMetadataId.set(metadataId, filtered)
        : this.chartGroupsByMetadataId.delete(metadataId);
    }
  }

  /**
   * Remove chart metadata from all groups.
   * @param metadataId The ID of the metadata to remove.
   * @param options Options for the removal process.
   *  - persistData: If true, the data points associated with the metadata will be retained (set to undefined). Default is false.
   *  - returnData: If true, the data points associated with the removed metadata will be returned. Default is false.
   * @returns An array if there are any metadata removed, otherwise null. 
   * If `returnData` is true, returns the data points associated with the removed metadata. Else, returns an empty array.
   */
  removeChartMetadata(metadataId: string, options?: {
    persistData?: boolean;
    returnData?: boolean;
  }): NativeDataPoint[] | null {
    const { persistData = false, returnData = false } = options || {};
    const groups = this.chartGroupsByMetadataId.get(metadataId);
    if (!groups?.length) return null;

    const rawResult: Map<number, number> = new Map();
    for (const group of groups) {
      if (Object.keys(group.metadataDict).length === 1) {
        this.removeChartGroup(group.id);
      } else {
        delete group.metadataDict[metadataId];
        for (const dp of group.data) {
          if (returnData && dp[metadataId] !== undefined) {
            rawResult.set(dp.time, dp[metadataId]);
          }
          if (!persistData) {
            delete dp[metadataId];
          }
        }
      }
    }
    this.chartGroupsByMetadataId.delete(metadataId);
    this.allChartMetadata.delete(metadataId);
    const result: NativeDataPoint[] = Array.from(rawResult.entries()).map(([time, value]) => ({ time, [metadataId]: value }));
    if (returnData) {
      result.sort((a, b) => a.time - b.time);
    }
    return result;
  }

  getAllChartIds(): string[] {
    return Array.from(this.allChartMetadata.keys());
  }

  getAllChartMetadata(): ChartMetadata[] {
    const seen = new Set<string>();
    const result: ChartMetadata[] = [];

    this.allChartMetadata.forEach(list => {
      list.forEach(meta => {
        if (!seen.has(meta.id)) {
          result.push(meta);
          seen.add(meta.id);
        }
      });
    });

    return result;
  }

  push(currentTime: number, dataPoints: ChartUpdateData[]) {
    this._pushMap.forEach(m => m.clear());

    dataPoints.forEach(({ id, time = currentTime, value }) => {
      const groups = this.chartGroupsByMetadataId.get(id);
      if (!groups) {
        console.warn(`Chart with id ${id} not found.`);
        return;
      }

      for (const group of groups) {
        const timeMap = this._pushMap.get(group.id)!;
        const point = timeMap.get(time) ?? { time };
        point[id] = value;
        timeMap.set(time, point);
      }
    });

    for (const [groupId, timeMap] of this._pushMap) {
      if (!timeMap.size) {
        continue;
      }
      const group = this.allChartGroups.get(groupId)!;
      const newPoints = Array.from(timeMap.values());

      // 优化：如果新数据是单个点且比最后一个点时间晚，直接追加
      if (newPoints.length === 1 && group.data.length > 0) {
        const lastTime = group.data[group.data.length - 1].time;
        if (newPoints[0].time >= lastTime) {
          group.data.push(newPoints[0]);
          return;
        }
      }

      // 检查是否所有新点都比现有数据晚
      if (group.data.length > 0 && newPoints.length > 0) {
        const lastTime = group.data[group.data.length - 1].time;
        const allLater = newPoints.every(p => p.time >= lastTime);

        if (allLater) {
          // 先排序新点（如果有多个）
          if (newPoints.length > 1) {
            newPoints.sort((a, b) => a.time - b.time);
          }
          group.data.push(...newPoints);
          return;
        }
      }

      // 否则，添加新点后重新排序
      group.data.push(...newPoints);
      group.data.sort((a, b) => a.time - b.time);
    };
  }

  pushMany(metadataId: string, dataPoints: NativeDataPoint[]) {
    if (!dataPoints.length) return;

    const groups = this.chartGroupsByMetadataId.get(metadataId);
    if (!groups?.length) {
      console.warn(`Chart with id ${metadataId} not found.`);
      return;
    }

    // 按时间排序输入的数据点
    const sortedPoints = [...dataPoints].sort((a, b) => a.time - b.time);

    for (const group of groups) {
      // 为每个group创建或更新数据点
      const timeToPoint = new Map<number, NativeDataPoint>();

      // 先把现有数据加入map
      group.data.forEach(point => {
        timeToPoint.set(point.time, { ...point });
      });

      // 合并新数据
      sortedPoints.forEach(point => {
        if (metadataId in point) {
          const existing = timeToPoint.get(point.time);
          if (existing) {
            existing[metadataId] = point[metadataId];
          } else {
            timeToPoint.set(point.time, { time: point.time, [metadataId]: point[metadataId] });
          }
        }
      });

      // 按时间排序并更新group数据
      group.data = Array.from(timeToPoint.values()).sort((a, b) => a.time - b.time);
    }
  }

  clearAll() {
    this.allChartGroups.forEach(group => group.data = []);
  }

  clearByGroup(groupIds: string[]): Set<string> {
    const cleared = new Set<string>();
    groupIds.forEach(id => {
      const group = this.allChartGroups.get(id);
      if (group) {
        group.data = [];
        cleared.add(id);
      }
    });
    return cleared;
  }

  clearByMetadata(metadataIds: string[]): Set<string> {
    const groupMetadata = new Map<string, Set<string>>();
    const cleared = new Set<string>();

    metadataIds.forEach(metaId => {
      const groups = this.chartGroupsByMetadataId.get(metaId);
      if (groups?.length) {
        groups.forEach(group => {
          const set = groupMetadata.get(group.id) ?? new Set();
          set.add(metaId);
          groupMetadata.set(group.id, set);
        });
        cleared.add(metaId);
      }
    });

    groupMetadata.forEach((metaIds, groupId) => {
      const group = this.allChartGroups.get(groupId);
      if (!group) return;

      if (metaIds.size === Object.keys(group.metadataDict).length) {
        group.data = [];
      } else {
        group.data = group.data.map(dp => {
          const newDp = { ...dp };
          metaIds.forEach(id => delete newDp[id]);
          return newDp;
        });
      }
    });

    return cleared;
  }
}