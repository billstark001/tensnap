import { create } from 'zustand';
import { Environment, Parameter, Snapshot, PureEnvironment, EnvironmentId, Agent, SnapshotMetadata, AgentId, ChartUpdateData, ChartGroupMetadata, ChartMetadata, ChartUpdateOperation, ChartGroup, SimulationState, SnapshotChartData } from '../../types/model';
import { ContainerView } from '../../types/ui';
import { SetStateAction } from 'react';
import { createStoreContext } from '@/utils/zustand';
import { createAutoLayout, createDefaultRootLayout } from '@/components/view/utils/pack';
import { InstantiatedEnvironment, instantiateEnvironment, serializeEnvironment } from '@/store/scenario/environment';
import { LogLevel, LogPayload, NormalizedLogPayload } from '@/types/api';
import { InstantiatedChartStorage, instantiateChartMetadata } from './chart';
import { sanitizeParameter } from './parameter';

export interface SetDataPayload {
  environments?: Environment[];
  parameters?: Parameter[];
  charts?: ChartGroupMetadata[];

  removedEnvironmentIds?: EnvironmentId[];
  removedParameterIds?: string[];
  removedChartIds?: string[];

  clearCharts?: boolean | string[];
}

export interface SetDataOptions {
  updateLayout?: boolean;
  preserveExisting?: boolean;
}
export interface ScenarioStore {
  // State
  connected: boolean;
  currentTime: number;
  isInTimeStep: boolean;
  environments: Map<EnvironmentId, InstantiatedEnvironment>;
  parameters: Parameter[];
  charts: InstantiatedChartStorage;
  snapshots: Snapshot[];
  logs: NormalizedLogPayload[];
  lastLogs?: NormalizedLogPayload;
  maxSnapshots: number;
  mainView: ContainerView;

  // Actions

  dump(): SimulationState;

  setConnected: (connected: boolean) => void;
  setCurrentTime: (time: number | null | undefined, isInTimeStep: boolean) => void;

  setData: (data: SetDataPayload, options?: SetDataOptions) => void;

  updateEnvironment: (id: EnvironmentId, data: PureEnvironment, agents?: Agent[]) => void;
  updateAgents: (id: EnvironmentId, updates: { id: AgentId; data: Partial<Agent> }[]) => void;
  updateParameter: (id: string, value: any) => void;
  updateParameterProps: (id: string, propsUpdate: Omit<Partial<Parameter>, 'id' | 'value'>) => void;
  
  // Chart operations
  updateChartProps: (id: string, propsUpdate: Omit<Partial<ChartGroup>, 'id' | 'data'>) => void;
  addChartMetadata: (groupId: string, metadata: ChartMetadata) => void;
  updateChartMetadata: (metadataId: string, propsUpdate: Partial<ChartMetadata>) => void;
  removeChartMetadataFromGroup: (metadataId: string, groupId: string, options?: { persistData?: boolean }) => void;
  moveChartMetadata: (metadataId: string, fromGroupId: string, toGroupId: string, options?: { copy?: boolean }) => void;
  addChartData: (updates: ChartUpdateData[]) => void;
  executeChartOperations: (operations: ChartUpdateOperation[]) => void;

  addSnapshot: (snapshot: SnapshotMetadata) => void;
  removeSnapshot: (id: string) => void;
  clearSnapshots: () => void;
  setMaxSnapshots: (max: number) => void;

  setMainView: (view: SetStateAction<ContainerView>) => void;
  updateMainViewLayout: () => void;

  log(payload: string | LogPayload, level?: LogLevel): void;
}

const getEnvironmentMetadata = (env: InstantiatedEnvironment) => ({
  id: env.id,
  type: env.type,
  label: env.label,
  width: (env.props as any)?.width,
  height: (env.props as any)?.height,
});

const MAX_LOG_ENTRIES = 1000;

export const createScenarioStore = () => create<ScenarioStore>((set, get) => ({
  // Initial state
  connected: false,
  currentTime: 0,
  isInTimeStep: false,
  environments: new Map(),
  parameters: [],
  charts: new InstantiatedChartStorage([]),
  snapshots: [],
  logs: [],
  maxSnapshots: 32,
  mainView: createDefaultRootLayout(),

  // Actions

  dump: () => {
    const store = get();
    return {  
      connected: false,
      currentTime: store.currentTime,
      environments: Array.from(store.environments.values()).map(env => serializeEnvironment(env)),
      parameters: structuredClone(store.parameters),
      charts: structuredClone(store.charts.getGroups()),
      snapshots: structuredClone(store.snapshots),
    };
  },

  setConnected: (connected) => set({ connected }),

  setCurrentTime: (time, isInTimeStep) => {
    if (time == null) {
      set({ isInTimeStep });
    } else {
      set({ currentTime: time, isInTimeStep });
    }
  },

  setData: (data, options) => {
    const {
      updateLayout = true,
      preserveExisting = false,
    } = options || {};

    const {
      environments,
      parameters,
      charts,
    } = get();

    const updates: Partial<Pick<ScenarioStore, 'environments' | 'parameters' | 'charts'>> = {};

    if (data.environments !== undefined || data.removedEnvironmentIds !== undefined) {
      if (preserveExisting) {
        const newEnvironments = new Map(environments);
        // When preserveExisting is true, we don't delete objects from the store
        // Instead, we keep them so that views can be marked as disabled in createAutoLayout
        // DO NOT delete removed environments here
        for (const env of data.environments || []) {
          newEnvironments.set(env.id, instantiateEnvironment(env));
        }
        updates.environments = newEnvironments;
      }
      else {
        updates.environments = new Map(data.environments?.map(env => [env.id, instantiateEnvironment(env)]));
      }
    }

    if (data.parameters !== undefined || data.removedParameterIds !== undefined) {
      const oldParameters = preserveExisting ? parameters.slice() : [];
      const newParameters: Parameter[] = [];
      const newParametersMap = new Map(data.parameters?.map(param => [param.id, param]));
      const removedIds = new Set(data.removedParameterIds || []);
      for (const oldParam of oldParameters) {
        // When preserveExisting is true, we keep removed parameters in the store
        // They will be marked as disabled in the views via createAutoLayout
        if (preserveExisting || !removedIds.has(oldParam.id)) {
          const mightBeNew = newParametersMap.get(oldParam.id);
          if (mightBeNew) {
            newParameters.push(sanitizeParameter({ ...oldParam, ...mightBeNew }, true));
            newParametersMap.delete(oldParam.id);
          } else {
            newParameters.push(sanitizeParameter(oldParam, false));
          }
        }
      }
      for (const [, param] of newParametersMap) {
        newParameters.push(sanitizeParameter(param, false));
      }
      updates.parameters = newParameters;
    }

    if (data.charts !== undefined || data.removedChartIds !== undefined || data.clearCharts !== undefined) {
      const newCharts = preserveExisting ? charts.shallowCopy() : new InstantiatedChartStorage([]);
      const removedChartIdsSet = new Set(data.removedChartIds || []);
      const clearChartIdsSet = new Set<string>(data.clearCharts === true ? [] : (Array.isArray(data.clearCharts) ? data.clearCharts : []));
      const clearAllCharts = data.clearCharts === true;
      // 0. divide chart metadata with has / does not have groups
      const chartGroupMetadata: ChartGroupMetadata[] = [];
      const chartMetadata: ChartMetadata[] = [];
      for (const chartMeta of data.charts || []) {
        if (chartMeta.dataList?.length) {
          chartGroupMetadata.push(chartMeta);
        } else {
          chartMetadata.push(chartMeta);
        }
      }
      // 1. remove charts only when NOT preserving existing
      // When preserveExisting is true, we keep removed charts in the store
      // They will be marked as disabled in the views via createAutoLayout
      if (!preserveExisting) {
        for (const chartId of removedChartIdsSet) {
          newCharts.removeChartGroup(chartId)
            || newCharts.removeChartMetadata(chartId);
        }
      }
      // 2. commit chart group changes
      for (const chartGroupMeta of chartGroupMetadata) {
        newCharts.addChartGroup(instantiateChartMetadata(chartGroupMeta), true);
      }
      for (const chartMeta of chartMetadata) {
        newCharts.upsertChartMetadata(chartMeta);
      }
      // 3. clear chart data if needed
      if (clearAllCharts) {
        newCharts.clearAll();
      } else if (clearChartIdsSet.size > 0) {
        const clearedGroupIds = newCharts.clearByGroup(Array.from(clearChartIdsSet));
        for (const groupId of clearedGroupIds) {
          clearChartIdsSet.delete(groupId);
        }
        newCharts.clearByMetadata(Array.from(clearChartIdsSet));
      }
      updates.charts = newCharts;
    }

    set(updates);

    // Auto-update layout when data changes with incremental updates
    if (updateLayout) {
      const { environments, parameters, charts, mainView } = get();
      
      // When preserveExisting is true, we need to filter out removed items for the layout
      // but keep them in the store. This way views for removed items will be disabled.
      const removedEnvIds = new Set(data.removedEnvironmentIds || []);
      const removedParamIds = new Set(data.removedParameterIds || []);
      const removedChartIds = new Set(data.removedChartIds || []);
      
      const activeEnvironments = Array.from(environments.values())
        .filter(env => !removedEnvIds.has(env.id))
        .map(getEnvironmentMetadata);
      const activeParameters = parameters.filter(p => !removedParamIds.has(p.id));
      const activeCharts = charts.getGroups().filter(c => !removedChartIds.has(c.id));
      
      set({
        mainView: createAutoLayout(
          mainView,
          activeEnvironments, 
          activeParameters, 
          activeCharts, 
          {
            disableMissingViews: preserveExisting
          }
        )
      });
    }
  },

  updateEnvironment: (id, propsUpdate, agentsUpdate) => {
    const { environments, log } = get();
    const env = environments.get(id);
    if (!env) {
      log(`Environment with id ${id} not found.`, 'warning');
      return;
    }
    let newAgents = env.agents;
    if (agentsUpdate) {
      newAgents = {};
      for (const agent of agentsUpdate) {
        newAgents[agent.id] = agent;
      }
    }
    environments.set(id, { ...env, props: { ...env.props, ...propsUpdate }, agents: newAgents });
  },

  updateAgents: (envId, updates) => {
    const { environments, log } = get();
    const env = environments.get(envId);
    if (!env) {
      log(`Environment with id ${envId} not found.`, 'warning');
      return;
    }
    const { agents } = env;
    for (const update of updates) {
      const { id, data } = update;
      if (!agents[id]) {
        log(`Agent with id ${id} not found in ${env.type} environment ${envId}.`, 'warning');
        continue;
      }
      Object.assign(agents[id], data);
    }
    environments.set(envId, { ...env, agents });
  },


  updateParameter: (id, value) => {
    set((state) => ({
      parameters: state.parameters.map((param) =>
        param.id === id ? { ...param, value } : param
      ),
    }));
  },

  updateParameterProps: (id, propsUpdate) => {
    set((state) => ({
      parameters: state.parameters.map((param) =>
        param.id === id ? { ...param, ...propsUpdate as any } : param
      ),
    }));
  },

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
    
    // Register the new metadata
    const metaList = charts.allChartMetadata.get(metadata.id) ?? [];
    metaList.push(metadata);
    charts.allChartMetadata.set(metadata.id, metaList);
    
    const groupList = charts.chartGroupsByMetadataId.get(metadata.id) ?? [];
    groupList.push(group);
    charts.chartGroupsByMetadataId.set(metadata.id, groupList);
    
    set({ charts });
  },

  updateChartMetadata: (metadataId, propsUpdate) => {
    const { charts } = get();
    const metadataList = charts.allChartMetadata.get(metadataId);
    if (!metadataList?.length) {
      return;
    }
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
    
    if (!fromGroup) {
      log(`Source chart group with id ${fromGroupId} not found.`, 'warning');
      return;
    }
    if (!toGroup) {
      log(`Target chart group with id ${toGroupId} not found.`, 'warning');
      return;
    }
    
    const metadata = fromGroup.metadataDict[metadataId];
    if (!metadata) {
      log(`Metadata with id ${metadataId} not found in group ${fromGroupId}.`, 'warning');
      return;
    }
    
    // Extract data points from source group
    const dataPoints = charts.removeChartMetadataFromGroup(metadataId, fromGroupId, { 
      persistData: copy, 
      returnData: true 
    });
    
    // Add metadata to target group
    if (!(metadataId in toGroup.metadataDict)) {
      toGroup.metadataDict[metadataId] = metadata;
      
      // Register metadata in target group
      const metaList = charts.allChartMetadata.get(metadataId) ?? [];
      metaList.push(metadata);
      charts.allChartMetadata.set(metadataId, metaList);
      
      const groupList = charts.chartGroupsByMetadataId.get(metadataId) ?? [];
      groupList.push(toGroup);
      charts.chartGroupsByMetadataId.set(metadataId, groupList);
    }
    
    // Add data points to target group if any
    if (dataPoints && dataPoints.length > 0) {
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
    for (const operation of operations) {
      const { id, operation: type } = operation;
      if (type === 'clear') {
        if (charts.allChartGroups.has(id)) {
          charts.clearByGroup([id]);
        } else {
          charts.clearByMetadata([id]);
        }
      }
    }
  },

  addSnapshot: (snapshotMetadata: SnapshotMetadata) => {
    const { environments, parameters, charts, currentTime } = get();
    
    // 提取当前时刻的图表数据 - 使用二分查找优化性能
    const chartData: SnapshotChartData[] = [];
    const allMetadata = charts.getAllChartMetadata();
    
    for (const meta of allMetadata) {
      const value = charts.getValueAtTime(meta.id, currentTime);
      if (value !== undefined) {
        chartData.push({
          id: meta.id,
          value
        });
      }
    }
    
    const snapshot: Snapshot = {
      ...snapshotMetadata,
      environments: Array.from(environments.values()).map(env => serializeEnvironment(env)),
      parameters: structuredClone(parameters.filter(p => p.type !== 'action')),
      chartData,
    };
    set((state) => {
      const newSnapshots = [...state.snapshots, snapshot];
      if (newSnapshots.length > state.maxSnapshots && state.maxSnapshots !== -1) {
        newSnapshots.shift();
      }
      return { snapshots: newSnapshots };
    })
  },

  removeSnapshot: (id: string) => {
    set((state) => {
      const newSnapshots = state.snapshots.filter(snapshot => snapshot.id !== id);
      return { snapshots: newSnapshots };
    });
  },

  clearSnapshots: () => set({ snapshots: [] }),

  setMaxSnapshots: (max) => set({ maxSnapshots: max }),

  setMainView: (view) => {
    if (typeof view === 'function') {
      set((state) => ({ mainView: view(state.mainView) }));
    } else {
      set({ mainView: view });
    }
  },

  updateMainViewLayout: () => {
    const { environments, parameters, charts, mainView } = get();
    const environmentsArray = Array.from(environments.values()).map(getEnvironmentMetadata);
    set({
      mainView: createAutoLayout(
        mainView,
        environmentsArray, 
        parameters, 
        charts.getGroups(), 
        {
          disableMissingViews: true
        }
      )
    });
  },

  log: (payload: string | LogPayload, level: LogLevel = 'info') => {
    if (typeof payload === 'string') {
      payload = { level, message: payload };
    }
    payload.level = payload.level || level;
    payload.timestamp = payload.timestamp || Date.now();
    set((state) => {
      state.logs.push(payload as NormalizedLogPayload);
      if (state.logs.length > MAX_LOG_ENTRIES) {
        state.logs.splice(0, state.logs.length - MAX_LOG_ENTRIES);
      }
      return { lastLogs: payload as NormalizedLogPayload, };
    });
  },
}));

export const {
  Provider: ScenarioStoreProvider,
  useStore: useScenarioStore,
} = createStoreContext<ScenarioStore>();