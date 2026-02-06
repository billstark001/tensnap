import { 
  Environment, 
  Parameter, 
  Snapshot, 
  EnvironmentId, 
  Agent, 
  SnapshotMetadata, 
  AgentId, 
  ChartUpdateData, 
  ChartMetadata, 
  ChartUpdateOperation, 
  ChartGroupMetadata, 
  SimulationState, 
  PureEnvironment, 
  ChartGroup 
} from '../types/model';
import { InstantiatedEnvironment } from './environment';
import { InstantiatedChartStorage } from './chart';

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

// Agent update operation types
export type AgentUpdateOperation = 'add' | 'update' | 'remove';

// Log types
export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface LogPayload {
  message: string;
  level?: LogLevel;
  timestamp?: number;
}

export interface NormalizedLogPayload extends Required<LogPayload> {
  id: string;
}

// Update trigger state
export interface UpdateTriggerState {
  counter: number;
  timestamp: number;
}

// Connection state slice
export interface ConnectionSlice {
  connected: boolean;
  setConnected: (connected: boolean) => void;
}

// Time management slice
export interface TimeSlice {
  currentTime: number;
  isInTimeStep: boolean;
  setCurrentTime: (time: number | null | undefined, isInTimeStep: boolean) => void;
}

// Environment management slice
export interface EnvironmentsSlice {
  environments: Map<EnvironmentId, InstantiatedEnvironment>;
  renameEnvironment: (id: EnvironmentId, newId: EnvironmentId) => void;
  removeEnvironment: (id: EnvironmentId) => void;
  updateEnvironment: (id: EnvironmentId, props: Partial<PureEnvironment>, agents?: Agent[]) => void;
  updateAgents: (id: EnvironmentId, updates: { id: AgentId; data?: Partial<Agent>, operation?: AgentUpdateOperation }[]) => void;
}

// Parameter management slice
export interface ParametersSlice {
  parameters: Map<string, Parameter>;
  renameParameter: (id: string, newId: string) => void;
  updateParameterValue: (id: string, value: any) => void;
  updateParameterProps: (id: string, propsUpdate: Partial<Parameter>) => void;
}

// Chart management slice
export interface ChartsSlice {
  charts: InstantiatedChartStorage;
  updateChartProps: (id: string, propsUpdate: Partial<Pick<ChartGroup, 'label'>>) => void;
  addChartMetadata: (groupId: string, metadata: ChartMetadata) => void;
  renameChartGroup: (groupId: string, newId: string) => void;
  renameChartMetadata: (metadataId: string, newId: string, groupId?: string) => void;
  updateChartMetadata: (metadataId: string, propsUpdate: Partial<ChartMetadata>) => void;
  removeChartMetadataFromGroup: (metadataId: string, groupId: string, options?: { persistData?: boolean }) => void;
  moveChartMetadata: (metadataId: string, fromGroupId: string, toGroupId: string, options?: { copy?: boolean }) => void;
  addChartData: (updates: ChartUpdateData[]) => void;
  executeChartOperations: (operations: ChartUpdateOperation[]) => void;
}

// Snapshot management slice
export interface SnapshotsSlice {
  snapshots: Snapshot[];
  maxSnapshots: number;
  addSnapshot: (snapshot?: SnapshotMetadata) => void;
  removeSnapshot: (id: string) => void;
  clearSnapshots: () => void;
  setMaxSnapshots: (max: number) => void;
}

// Log management slice
export interface LogsSlice {
  logs: NormalizedLogPayload[];
  lastLogs?: NormalizedLogPayload;
  log: (payload: string | LogPayload, level?: LogLevel) => void;
}

// Core slice (contains dump and setData)
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
  EnvironmentsSlice &
  ParametersSlice &
  ChartsSlice &
  SnapshotsSlice &
  LogsSlice &
  CoreSlice;
