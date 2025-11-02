import { Agent, AgentId, ChartDataUpdate, ChartGroup, ChartMetadata, Environment, EnvironmentId, EnvironmentType, GraphAgent, GridAgent, NativeDataPoint, PureEnvironment, PureGraphEnvironment, PureGridEnvironment, PureUniformEnvironment, UniformAgent } from "../types/model";

// #region Instantiated Environment

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

// #region Instantiated Chart Data


export function instantiateChartMetadata(meta: ChartMetadata): ChartGroup {
  return {
    id: meta.id,
    label: meta.label,
    metadataList: {
      [meta.id]: meta,
    },
    data: [],
  };
}

export function createCsvContent(instChartData: ChartGroup): string {
  const { metadataList, data } = instChartData;
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

export class InstantiatedChartDataStorage {

  readonly chartDataMapByGroup: Map<string, ChartGroup> = new Map();
  readonly chartDataMapById: Map<string, ChartMetadata[]> = new Map();

  private readonly _pushMap: Map<string, Map<number, NativeDataPoint>> = new Map();

  constructor(groups: ChartGroup[]) {
    for (const group of groups) {
      this.addChartDataGroup(group);
    }
  }

  getGroups(): ChartGroup[] {
    return Array.from(this.chartDataMapByGroup.values());
  }

  shallowCopy(): InstantiatedChartDataStorage {
    const newStorage = new InstantiatedChartDataStorage([]);
    for (const [groupId, group] of this.chartDataMapByGroup.entries()) {
      newStorage.chartDataMapByGroup.set(groupId, group);
      newStorage._pushMap.set(groupId, new Map());
    }
    for (const [chartId, metadataList] of this.chartDataMapById.entries()) {
      newStorage.chartDataMapById.set(chartId, metadataList);
    }
    return newStorage;
  }

  addChartDataGroup(group: ChartGroup) {
    this.chartDataMapByGroup.set(group.id, group);
    for (const metadata in group.metadataList) {
      const meta = group.metadataList[metadata];
      const existing = this.chartDataMapById.get(meta.id) || [];
      existing.push(meta);
      this.chartDataMapById.set(meta.id, existing);
    }
    this._pushMap.set(group.id, new Map());
  }

  removeChartDataGroup(groupId: string) {
    const group = this.chartDataMapByGroup.get(groupId);
    if (!group) return;
    for (const metadata in group.metadataList) {
      const meta = group.metadataList[metadata];
      const existing = this.chartDataMapById.get(meta.id);
      if (existing) {
        const filtered = existing.filter(m => m.id !== meta.id);
        if (filtered.length === 0) {
          this.chartDataMapById.delete(meta.id);
        } else {
          this.chartDataMapById.set(meta.id, filtered);
        }
      }
    }
    this.chartDataMapByGroup.delete(groupId);
    this._pushMap.delete(groupId);
  }

  getAllChartIds(): string[] {
    return Array.from(this.chartDataMapById.keys());
  }

  push(currentTime: number, dataPoints: ChartDataUpdate[]) {
    for (const m of this._pushMap.values()) {
      m.clear();
    }
    for (const { id, time = currentTime, value } of dataPoints) {
      const group = this.chartDataMapById.get(id);
      if (!group) {
        console.warn(`Chart with id ${id} not found.`);
        continue;
      }
      const metadataList = this.chartDataMapById.get(id);
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
      const group = this.chartDataMapByGroup.get(groupId)!;
      for (const dataPoint of m.values()) {
        group.data.push(dataPoint);
      }
    }
  }

}

// #endregion