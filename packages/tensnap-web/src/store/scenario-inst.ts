import { Agent, AgentId, ChartUpdateData, ChartGroup, ChartMetadata, Environment, EnvironmentId, EnvironmentType, GraphAgent, GridAgent, NativeDataPoint, PureEnvironment, PureGraphEnvironment, PureGridEnvironment, PureUniformEnvironment, UniformAgent, ChartMetadataWithList, Parameter, SliderParameter, EnumParameter, CheckboxParameter, StringParameter } from "../types/model";

// #region Environment

export interface InstantiatedEnvironment {
  id: EnvironmentId;
  type: EnvironmentType;
  props: PureEnvironment;
  agents: Record<AgentId, Agent>;
}

export interface InstantiatedGridEnvironment extends InstantiatedEnvironment {
  type: 'grid';
  props: Omit<PureGridEnvironment, 'type' | 'id'>;
  agents: Record<AgentId, GridAgent>;
}

export interface InstantiatedGraphEnvironment extends InstantiatedEnvironment {
  type: 'graph';
  props: Omit<PureGraphEnvironment, 'type' | 'id'>;
  agents: Record<AgentId, GraphAgent>;
}

export interface InstantiatedUniformEnvironment extends InstantiatedEnvironment {
  type: 'uniform';
  props: Omit<PureUniformEnvironment, 'type' | 'id'>;
  agents: Record<AgentId, UniformAgent>;
}

export function instantiateEnvironment(env: Environment): InstantiatedEnvironment {

  const { id, type, agents, ...props } = env;

  const agentsMap: Record<AgentId, Agent> = {};
  agents.forEach(agent => {
    agentsMap[agent.id] = agent;
  });

  return {
    id,
    type,
    props,
    agents: agentsMap,
  };
}

export function serializeEnvironment(instEnv: InstantiatedEnvironment): Environment {
  const { id, type, props, agents } = instEnv;

  return {
    id,
    type,
    ...props,
    agents: Object.values(agents),
  } as any;
}

// #endregion

// #region Chart Data

export function instantiateChartMetadata(meta: ChartMetadataWithList): ChartGroup {
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
      const group = this.allChartMetadata.get(id);
      if (!group) {
        console.warn(`Chart with id ${id} not found.`);
        continue;
      }
      const metadataList = this.allChartMetadata.get(id);
      if (!metadataList?.length) {
        console.warn(`Chart metadata with id ${id} not found.`);
        continue;
      }
      for (const metadata of metadataList) {
        const m = this._pushMap.get(metadata.id)!;
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

// #endregion

// #region Parameters
interface RangeHint {
  value: number;
  min?: number;
  max?: number;
  step?: number;
}

interface EstimatedRange {
  min: number;
  max: number;
  step: number;
}

export function estimateNumericRange(hint: RangeHint): EstimatedRange {
  const { value, min, max, step } = hint;

  // 辅助函数：将数值转换为10的整数次幂
  function toPowerOfTen(val: number, roundUp: boolean = false): number {
    if (val === 0) return 0;

    const absVal = Math.abs(val);
    const sign = val < 0 ? -1 : 1;

    // 防止太小的值，直接截断为0或1
    if (absVal < 1e-10) return val < 0 ? -1 : (val === 0 ? 0 : 1);

    const log10Val = Math.log10(absVal);
    const exponent = roundUp ? Math.ceil(log10Val) : Math.floor(log10Val);

    return sign * Math.pow(10, exponent);
  }

  // 检查hint是否合理
  function isValidHint(min?: number, max?: number, value?: number): boolean {
    if (min !== undefined && max !== undefined && min >= max) return false;
    if (value !== undefined) {
      if (min !== undefined && value < min) return false;
      if (max !== undefined && value > max) return false;
    }
    return true;
  }

  // 验证hint的合理性
  const validMin = isValidHint(min, max, value) ? min : undefined;
  const validMax = isValidHint(min, max, value) ? max : undefined;
  const validStep = step !== undefined && step > 0 ? step : undefined;

  // 如果全部都有且合理，就直接返回（转换为10的幂）
  if (validMin !== undefined && validMax !== undefined && validStep !== undefined) {
    return {
      min: toPowerOfTen(validMin),
      max: toPowerOfTen(validMax, true),
      step: toPowerOfTen(validStep)
    };
  }

  const absVal = Math.abs(value);
  const isZero = absVal < Number.EPSILON;
  const isNegative = value < 0;

  let estimatedMin: number;
  let estimatedMax: number;

  if (validMin !== undefined && validMax !== undefined) {
    // 两个边界都给定且合理
    estimatedMin = toPowerOfTen(validMin);
    estimatedMax = toPowerOfTen(validMax, true);
  } else if (validMin !== undefined) {
    // 只给定最小值
    estimatedMin = toPowerOfTen(validMin);
    if (isZero) {
      estimatedMax = toPowerOfTen(validMin + 10);
    } else {
      // 基于value和min确定max
      const range = Math.abs(value - validMin) * 10;
      estimatedMax = toPowerOfTen(Math.max(value, validMin) + range, true);
    }
  } else if (validMax !== undefined) {
    // 只给定最大值
    estimatedMax = toPowerOfTen(validMax, true);
    if (isZero) {
      estimatedMin = toPowerOfTen(validMax - 10);
    } else {
      // 基于value和max确定min
      const range = Math.abs(validMax - value) * 10;
      estimatedMin = toPowerOfTen(Math.min(value, validMax) - range);
    }
  } else {
    // 都没给定，基于value估计
    if (isZero) {
      estimatedMin = -1;
      estimatedMax = 1;
    } else if (isNegative) {
      // 负数情况：扩展到两个方向
      const magnitude = toPowerOfTen(absVal, true);
      estimatedMin = -magnitude * 10;
      estimatedMax = magnitude;
    } else {
      // 正数情况
      const magnitude = toPowerOfTen(value, true);
      estimatedMin = toPowerOfTen(value / 100);
      estimatedMax = magnitude * 10;
    }
  }

  // 确保 min < max
  if (estimatedMin >= estimatedMax) {
    if (isZero) {
      estimatedMin = -1;
      estimatedMax = 1;
    } else {
      const center = (estimatedMin + estimatedMax) / 2;
      const magnitude = Math.max(Math.abs(estimatedMin), Math.abs(estimatedMax));
      const powerMagnitude = toPowerOfTen(magnitude, true);
      estimatedMin = center - powerMagnitude;
      estimatedMax = center + powerMagnitude;
    }
  }

  // 估算步幅
  let estimatedStep: number;
  if (validStep !== undefined) {
    estimatedStep = toPowerOfTen(validStep);
  } else {
    const range = estimatedMax - estimatedMin;
    if (range === 0) {
      estimatedStep = isZero ? 0.1 : toPowerOfTen(Math.abs(value) / 100);
    } else {
      // 步幅通常是范围的1%到10%之间的10的幂
      const targetStep = range / 100;
      estimatedStep = toPowerOfTen(targetStep);
    }
  }

  return {
    min: estimatedMin,
    max: estimatedMax,
    step: estimatedStep,
  };
}

export function sanitizeParameter(param: Parameter, inPlace: boolean = false): Parameter {
  const result = inPlace ? param : { ...param };

  switch (param.type) {
    case 'number': {
      const estimatedRange = estimateNumericRange({
        value: param.value,
        min: param.min,
        max: param.max,
        step: param.step,
      });

      (result as SliderParameter).min = estimatedRange.min;
      (result as SliderParameter).max = estimatedRange.max;
      (result as SliderParameter).step = estimatedRange.step;
      break;
    }

    case 'enum': {
      if (!param.options?.includes(param.value)) {
        (result as EnumParameter).value = param.options?.[0] ?? '';
      }
      break;
    }

    case 'checkbox': {
      const value = (param as CheckboxParameter).value;
      if (typeof value !== 'boolean') {
        (result as CheckboxParameter).value =
          value === 'false' || value === 'False' ? false : Boolean(value);
      }
      break;
    }

    case 'string': {
      const value = (param as StringParameter).value;
      if (typeof value !== 'string') {
        (result as StringParameter).value = value == null ? '' : String(value);
      }
      break;
    }
  }

  return result;
}

// #endregion