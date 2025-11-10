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

export function exportToCSV(chartGroup: ChartGroup) {
  const csvContent = createCsvContent(chartGroup);
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chart_${chartGroup.id}_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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

  private _cleanupMetadataRegistration(metadataId: string, groupId: string) {
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
   * Extract data points for a specific metadata from a group's data array.
   * @private
   */
  private _extractDataPoints(
    data: NativeDataPoint[],
    metadataId: string
  ): NativeDataPoint[] {
    const result: NativeDataPoint[] = [];
    for (let i = 0; i < data.length; i++) {
      const dp = data[i];
      if (dp[metadataId] !== undefined) {
        result.push({ time: dp.time, [metadataId]: dp[metadataId] });
      }
    }
    return result;
  }

  /**
   * Collect data points for a metadata across multiple groups and merge by time.
   * @private
   */
  private _collectAndMergeDataPoints(
    groups: ChartGroup[],
    metadataId: string
  ): NativeDataPoint[] {
    const timeValueMap = new Map<number, any>();

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      for (let j = 0; j < group.data.length; j++) {
        const dp = group.data[j];
        if (dp[metadataId] !== undefined) {
          timeValueMap.set(dp.time, dp[metadataId]);
        }
      }
    }

    if (timeValueMap.size === 0) return [];

    const result: NativeDataPoint[] = [];
    timeValueMap.forEach((value, time) => {
      result.push({ time, [metadataId]: value });
    });
    result.sort((a, b) => a.time - b.time);
    return result;
  }

  removeChartGroup(groupId: string): boolean {
    const group = this.allChartGroups.get(groupId);
    if (!group) return false;

    // Clean up metadata registrations without calling removeChartMetadataFromGroup
    const metadataIds = Object.keys(group.metadataDict);
    for (let i = 0; i < metadataIds.length; i++) {
      this._cleanupMetadataRegistration(metadataIds[i], groupId);
    }

    this.allChartGroups.delete(groupId);
    this._pushMap.delete(groupId);
    return true;
  }

  /**
   * Remove chart metadata from a specific group.
   * @param metadataId The ID of the metadata to remove.
   * @param groupId The ID of the group to remove from.
   * @param options Options for the removal process.
   *  - persistData: If true, the data points associated with the metadata will be retained (set to undefined). Default is false.
   *  - returnData: If true, the data points associated with the removed metadata will be returned. Default is false.
   * @returns The removed data points if returnData is true, otherwise null.
   */
  removeChartMetadataFromGroup(metadataId: string, groupId: string, options?: {
    persistData?: boolean;
    returnData?: boolean;
  }): NativeDataPoint[] | null {
    const { persistData = false, returnData = false } = options || {};
    const group = this.allChartGroups.get(groupId);

    if (!group || !(metadataId in group.metadataDict)) {
      return null;
    }

    let result: NativeDataPoint[] | null = null;

    // Handle data removal/collection
    if (Object.keys(group.metadataDict).length === 1) {
      // If this is the only metadata in the group, remove the entire group
      if (returnData) {
        result = this._extractDataPoints(group.data, metadataId);
      }
      this.removeChartGroup(groupId);
      return result;
    }

    // Extract data if needed before modifying
    if (returnData) {
      result = this._extractDataPoints(group.data, metadataId);
    }

    // Remove metadata from group
    delete group.metadataDict[metadataId];

    // Remove data points if not persisting
    if (!persistData) {
      for (let i = 0; i < group.data.length; i++) {
        delete group.data[i][metadataId];
      }
    }

    // Clean up metadata registrations
    this._cleanupMetadataRegistration(metadataId, groupId);

    return result;
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

    // If returnData, collect data before removal
    let result: NativeDataPoint[] | null = null;
    if (returnData) {
      result = this._collectAndMergeDataPoints(groups, metadataId);
    }

    // Copy to avoid mutation during iteration
    const groupsToRemove = [...groups];
    for (let i = 0; i < groupsToRemove.length; i++) {
      this.removeChartMetadataFromGroup(metadataId, groupsToRemove[i].id, { persistData, returnData: false });
    }

    return returnData ? result : [];
  }

  /**
   * Get all data points associated with a specific metadata.
   * @param metadataId The ID of the metadata to retrieve data for.
   * @returns An array of data points containing the metadata, sorted by time. Returns null if the metadata does not exist.
   */
  getChartData(metadataId: string): NativeDataPoint[] | null {
    const groups = this.chartGroupsByMetadataId.get(metadataId);
    if (!groups?.length) return null;

    const result = this._collectAndMergeDataPoints(groups, metadataId);
    return result.length > 0 ? result : null;
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

  /**
   * Get the value of a specific metadata at a given time using binary search.
   * @param metadataId The ID of the metadata to retrieve value for.
   * @param time The time to query.
   * @returns The value at the closest time point, or undefined if not found.
   */
  getValueAtTime(metadataId: string, time: number): number | undefined {
    const groups = this.chartGroupsByMetadataId.get(metadataId);
    if (!groups?.length) return undefined;

    // Try to find the value across all groups
    let closestValue: number | undefined = undefined;
    let minTimeDiff = Infinity;

    for (const group of groups) {
      const data = group.data;
      if (!data.length) continue;

      // Binary search to find the closest time point
      let left = 0;
      let right = data.length - 1;

      // Handle edge cases
      if (time <= data[0].time) {
        const value = data[0][metadataId];
        if (value !== undefined) {
          const timeDiff = Math.abs(data[0].time - time);
          if (timeDiff < minTimeDiff) {
            minTimeDiff = timeDiff;
            closestValue = value;
          }
        }
        continue;
      }

      if (time >= data[right].time) {
        const value = data[right][metadataId];
        if (value !== undefined) {
          const timeDiff = Math.abs(data[right].time - time);
          if (timeDiff < minTimeDiff) {
            minTimeDiff = timeDiff;
            closestValue = value;
          }
        }
        continue;
      }

      // Binary search for the closest time
      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const midTime = data[mid].time;

        if (midTime === time) {
          const value = data[mid][metadataId];
          if (value !== undefined) {
            return value;
          }
          break;
        }

        if (midTime < time) {
          left = mid + 1;
        } else {
          right = mid - 1;
        }
      }

      // Check the two closest points
      const candidates = [
        left - 1 >= 0 ? left - 1 : null,
        left < data.length ? left : null
      ].filter(idx => idx !== null) as number[];

      for (const idx of candidates) {
        const value = data[idx][metadataId];
        if (value !== undefined) {
          const timeDiff = Math.abs(data[idx].time - time);
          if (timeDiff < minTimeDiff) {
            minTimeDiff = timeDiff;
            closestValue = value;
          }
        }
      }
    }

    return closestValue;
  }

  push(currentTime: number, dataPoints: ChartUpdateData[]) {
    this._pushMap.forEach(m => m.clear());

    for (const { id, time = currentTime, value } of dataPoints) {
      const groups = this.chartGroupsByMetadataId.get(id);
      if (!groups) {
        console.warn(`Chart with id ${id} not found.`);
        continue;
      }

      for (const group of groups) {
        const timeMap = this._pushMap.get(group.id)!;
        const point = timeMap.get(time) ?? { time };
        point[id] = value;
        timeMap.set(time, point);
      }
    }

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
          continue;
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
          continue;
        }
      }

      // 否则，添加新点后重新排序
      group.data.push(...newPoints);
      group.data.sort((a, b) => a.time - b.time);
    }
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