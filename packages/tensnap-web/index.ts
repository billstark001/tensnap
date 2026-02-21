// Re-export main components
export { App } from './src/App';
export { Providers } from './src/Providers';

// Re-export file types specifically
export type {
  FileMetadata,
  FileContent,
  DirectoryMetadata,
  DirectoryEntry,
  FileSystemStats
} from './src/types/file';

export type * as ModelTypes from './src/types/model';
export type * as APITypes from './src/types/api';

// Re-export commonly used types from model and api
export type {
  // Model types
  Environment,
  GridEnvironment,
  GraphEnvironment,
  UniformEnvironment,
  Agent,
  GridAgent,
  GraphAgent,
  UniformAgent,
  Parameter,
  Action,
  ChartGroupMetadata,
  ChartMetadata,
  PureEnvironment,
  PureGridEnvironment,
  PureGraphEnvironment,
  PureUniformEnvironment,
  AgentId,
  EnvironmentId,
} from './src/types/model';

export type {
  // API types
  WSMessage,
  ServerToClientMessage,
  ClientToServerMessage,
  MetadataUpdatePayload,
  ActionEndPayload,
  ActionCUPayload,
  ActionDeletePayload,
  EnvCreatePayload,
  EnvDeletePayload,
  EnvLayerCreatePayload,
  EnvLayerUpdatePayload,
  EnvLayerDeletePayload,
  AgentCreatePayload,
  AgentUpdatePayload,
  AgentDiff,
  AgentDeletePayload,
  EdgeCreatePayload,
  EdgeUpdatePayload,
  EdgeDeletePayload,
  EdgeData,
  EdgeDiff,
  ParameterCUPayload,
  ParameterDeletePayload,
  ParameterSyncPayload,
  ChartCreatePayload,
  ChartUpdatePayload,
  ChartDeletePayload,
  AssetId,
  AssetMeta,
  AssetMetaPayload,
  AssetDataPayload,
  AssetDeletePayload,
  AssetSyncPayload,
  StateSyncRequest,
  ParameterChangePayload,
  ActionStartPayload,
  LogPayload,
} from './src/types/api';

// Re-export store

// Layer Registry — public API for registering custom layer types
export { layerRegistry, registerLayerType } from './src/store/scenario/layer-registry';
export type { LayerTypeDefinition, LayerValidationResult, LayerRegistryClass } from './src/store/scenario/layer-registry';
