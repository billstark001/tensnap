import { Environment, Parameter, Action, Snapshot, EnvironmentId, Agent, SnapshotMetadata, AgentId, ChartUpdateData, ChartMetadata, ChartUpdateOperation, ChartGroupMetadata, SimulationState, PureEnvironment, ChartGroup } from '../../types/model';
import { ContainerView } from '../../types/ui';
import { SetStateAction } from 'react';
import { InstantiatedEnvironment } from './environment';
import { AgentDiff, EdgeData, EdgeDiff, LogLevel, LogPayload, NormalizedLogPayload } from '@/types/api';
import { ChartStorage } from 'tensnap-web-core';
import { UpdateTriggerState } from '../update-trigger';

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

// 连接状态切片
export interface ConnectionSlice {
  connected: boolean;
  setConnected: (connected: boolean) => void;
}

// 时间管理切片
export interface TimeSlice {
  currentTime: number;
  setCurrentTime: (time: number) => void;
}

// Action管理切片
export interface ActionsSlice {
  actions: Map<string, Action>;
  upsertAction: (action: Action) => void;
  deleteAction: (id: string) => void;
  handleActionEnd: (id: string, continueFlag?: boolean) => void;
}

// 环境管理切片
export interface EnvironmentsSlice {
  environments: Map<EnvironmentId, InstantiatedEnvironment>;
  renameEnvironment: (id: EnvironmentId, newId: EnvironmentId) => void;
  removeEnvironment: (id: EnvironmentId) => void;
  createEnv: (id: EnvironmentId, type: 'uniform' | '2d') => void;
  deleteEnv: (id: EnvironmentId) => void;
  updateEnvironment: (id: EnvironmentId, props: Partial<PureEnvironment>, agents?: Agent[]) => void;
  createEnvLayer: (envId: EnvironmentId, layerId: string, layerType: string, data?: Record<string, any>) => void;
  updateEnvLayer: (envId: EnvironmentId, layerId: string, data: Record<string, any>) => void;
  deleteEnvLayer: (envId: EnvironmentId, layerId: string) => void;
  createAgents: (envId: EnvironmentId, layerId: string, agents: Agent[]) => void;
  updateAgents: (envId: EnvironmentId, layerId: string, agents: AgentDiff[]) => void;
  deleteAgents: (envId: EnvironmentId, layerId: string, ids: AgentId[]) => void;
  createEdges: (envId: EnvironmentId, layerId: string, edges: EdgeData[]) => void;
  updateEdges: (envId: EnvironmentId, layerId: string, edges: EdgeDiff[]) => void;
  deleteEdges: (envId: EnvironmentId, layerId: string, edges: Array<{ source: AgentId; target: AgentId }>) => void;
}

// 参数管理切片
export interface ParametersSlice {
  parameters: Map<string, Parameter>;
  renameParameter: (id: string, newId: string) => void;
  updateParameterValue: (id: string, value: any) => void;
  updateParameterProps: (id: string, propsUpdate: Partial<Parameter>) => void;
  upsertParameter: (param: Parameter) => void;
  deleteParameter: (id: string) => void;
  syncParameterValue: (id: string, value: any) => void;
}

// 图表管理切片
export interface ChartsSlice {
  charts: ChartStorage;
  updateChartProps: (id: string, propsUpdate: Partial<Pick<ChartGroup, 'label'>>) => void;
  addChartMetadata: (groupId: string, metadata: ChartMetadata) => void;
  renameChartGroup: (groupId: string, newId: string) => void;
  renameChartMetadata: (metadataId: string, newId: string, groupId?: string) => void;
  updateChartMetadata: (metadataId: string, propsUpdate: Partial<ChartMetadata>) => void;
  removeChartMetadataFromGroup: (metadataId: string, groupId: string, options?: { persistData?: boolean }) => void;
  moveChartMetadata: (metadataId: string, fromGroupId: string, toGroupId: string, options?: { copy?: boolean }) => void;
  addChartData: (updates: ChartUpdateData[]) => void;
  executeChartOperations: (operations: ChartUpdateOperation[]) => void;
  upsertChart: (chart: ChartGroupMetadata) => void;
  deleteChart: (id: string) => void;
}

// 快照管理切片
export interface SnapshotsSlice {
  snapshots: Snapshot[];
  maxSnapshots: number;
  addSnapshot: (snapshot?: SnapshotMetadata) => void;
  removeSnapshot: (id: string) => void;
  clearSnapshots: () => void;
  setMaxSnapshots: (max: number) => void;
}

// 视图管理切片
export interface ViewsSlice {
  mainView: ContainerView;
  setMainView: (view: SetStateAction<ContainerView>) => void;
  updateMainViewLayout: () => void;
}

// 日志管理切片
export interface LogsSlice {
  logs: NormalizedLogPayload[];
  lastLogs?: NormalizedLogPayload;
  log: (payload: string | LogPayload, level?: LogLevel) => void;
}

// 核心切片（包含 dump 和 setData）
export interface CoreSlice {
  viewUpdateTrigger: UpdateTriggerState;
  environmentUpdateTrigger: UpdateTriggerState;
  parameterUpdateTrigger: UpdateTriggerState;
  dump: () => SimulationState;
  setData: (data: SetDataPayload, options?: SetDataOptions) => void;
  clearAll: () => void;
}

export type ScenarioStore = ConnectionSlice &
  TimeSlice &
  ActionsSlice &
  EnvironmentsSlice &
  ParametersSlice &
  ChartsSlice &
  SnapshotsSlice &
  ViewsSlice &
  LogsSlice &
  CoreSlice;