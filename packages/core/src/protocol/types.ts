import type { AssetId, AssetMeta } from '../asset';
import type { ChartGroupMetadata, ChartMetadata, ChartUpdateData } from '../chart';
import type { Action, Parameter } from '../parameter';
import type { AgentId, BaseAgent } from '../environment';

export type { AssetId, AssetMeta } from '../asset';

export type EnvironmentId = string;
export type ScenarioEnvironmentType = 'uniform' | '2d';
export type AgentRecord = BaseAgent;

export interface EdgeData {
  source: AgentId;
  target: AgentId;
  directed?: boolean;
  style?: 'solid' | 'dashed' | 'dotted';
  width?: number;
  color?: string;
  [key: string]: unknown;
}

export type AgentDiff = { id: AgentId } & Record<string, unknown>;
export type EdgeDiff = { source: AgentId; target: AgentId } & Record<string, unknown>;

export type SimulatorToRendererMessageType =
  | 'metadata_update'
  | 'action_end'
  | 'action_create'
  | 'action_update'
  | 'action_delete'
  | 'env_create'
  | 'env_delete'
  | 'env_layer_create'
  | 'env_layer_update'
  | 'env_layer_delete'
  | 'agent_create'
  | 'agent_update'
  | 'agent_delete'
  | 'edge_create'
  | 'edge_update'
  | 'edge_delete'
  | 'param_create'
  | 'param_update'
  | 'param_delete'
  | 'param_sync'
  | 'chart_create'
  | 'chart_update'
  | 'chart_delete'
  | 'asset_meta'
  | 'asset_data'
  | 'asset_delete'
  | 'log'
  | 'error';

export type RendererToSimulatorMessageType =
  | 'state_sync'
  | 'param_change'
  | 'action_start'
  | 'asset_sync'
  | 'error';

export type ProtocolMessageType = SimulatorToRendererMessageType | RendererToSimulatorMessageType;

export interface ProtocolMessage<TType extends ProtocolMessageType = ProtocolMessageType, TPayload = unknown> {
  type: TType;
  payload: TPayload;
  timestamp?: number;
}

export interface SimulatorToRendererMessage<TPayload = unknown>
  extends ProtocolMessage<SimulatorToRendererMessageType, TPayload> {}

export interface RendererToSimulatorMessage<TPayload = unknown>
  extends ProtocolMessage<RendererToSimulatorMessageType, TPayload> {}

export interface MetadataUpdatePayload {
  time?: number;
  [key: string]: unknown;
}

export interface ActionEndPayload {
  id: string;
  continue?: boolean;
}

export type ActionCUPayload = Action;

export interface ActionDeletePayload {
  id: string;
}

export interface EnvCreatePayload {
  id: EnvironmentId;
  type: ScenarioEnvironmentType;
}

export interface EnvDeletePayload {
  id: EnvironmentId;
}

export interface EnvLayerCreatePayload {
  env_id: EnvironmentId;
  layer_id: string;
  layer_type: string;
  data?: Record<string, unknown>;
}

export interface EnvLayerUpdatePayload {
  env_id: EnvironmentId;
  layer_id: string;
  data: Record<string, unknown>;
}

export interface EnvLayerDeletePayload {
  env_id: EnvironmentId;
  layer_id: string;
}

export interface AgentCreatePayload {
  env_id: EnvironmentId;
  layer_id: string;
  agents: AgentRecord[];
}

export interface AgentUpdatePayload {
  env_id: EnvironmentId;
  layer_id: string;
  agents: AgentDiff[];
}

export interface AgentDeletePayload {
  env_id: EnvironmentId;
  layer_id: string;
  ids: AgentId[];
}

export interface EdgeCreatePayload {
  env_id: EnvironmentId;
  layer_id: string;
  edges: EdgeData[];
}

export interface EdgeUpdatePayload {
  env_id: EnvironmentId;
  layer_id: string;
  edges: EdgeDiff[];
}

export interface EdgeDeletePayload {
  env_id: EnvironmentId;
  layer_id: string;
  edges: Array<{ source: AgentId; target: AgentId }>;
}

export type ParameterCUPayload = Parameter;

export interface ParameterDeletePayload {
  id: string;
}

export interface ParameterSyncPayload {
  id: string;
  value: unknown;
}

export type ChartCreatePayload = ChartGroupMetadata;

export interface ChartDeletePayload {
  id: string;
}

export interface ChartUpdateOperation {
  id: string;
  operation: 'clear';
}

export interface ChartUpdatePayload {
  updates?: ChartUpdateData[];
  operations?: ChartUpdateOperation[];
}

export type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'critical';

export interface LogPayload {
  message: string;
  level?: LogLevel;
  target?: string;
  timestamp?: number;
  data?: unknown;
}

export interface NormalizedLogPayload extends LogPayload {
  level: LogLevel;
  timestamp: number;
}

export interface ErrorPayload {
  error: string;
}

export interface AssetMetaPayload {
  assets: AssetMeta[];
}

export interface AssetDataPayload {
  id: AssetId;
  hash: string;
  mime: string;
  data: string | Uint8Array;
}

export interface AssetDeletePayload {
  ids: AssetId[];
}

export interface AssetSyncPayload {
  assets: Record<AssetId, string>;
}

export interface StateSyncRequest {
  parameters: Parameter[];
  actions: Action[];
  envs: Array<{
    id: EnvironmentId;
    type: string;
    layers: Array<{ layer_id: string; layer_type: string }>;
  }>;
  charts: ChartMetadata[];
}

export interface ParameterChangePayload {
  id: string;
  value: unknown;
}

export interface ActionStartPayload {
  id: string;
  continuous?: boolean;
}

export type SimulatorToRendererPayload =
  | MetadataUpdatePayload
  | ActionEndPayload
  | ActionCUPayload
  | ActionDeletePayload
  | EnvCreatePayload
  | EnvDeletePayload
  | EnvLayerCreatePayload
  | EnvLayerUpdatePayload
  | EnvLayerDeletePayload
  | AgentCreatePayload
  | AgentUpdatePayload
  | AgentDeletePayload
  | EdgeCreatePayload
  | EdgeUpdatePayload
  | EdgeDeletePayload
  | ParameterCUPayload
  | ParameterDeletePayload
  | ParameterSyncPayload
  | ChartCreatePayload
  | ChartUpdatePayload
  | ChartDeletePayload
  | AssetMetaPayload
  | AssetDataPayload
  | AssetDeletePayload
  | LogPayload
  | ErrorPayload;

export type RendererToSimulatorPayload =
  | StateSyncRequest
  | ParameterChangePayload
  | ActionStartPayload
  | AssetSyncPayload
  | ErrorPayload;

export type SimulatorToRendererWSMessage = SimulatorToRendererMessage<SimulatorToRendererPayload>;
export type RendererToSimulatorWSMessage = RendererToSimulatorMessage<RendererToSimulatorPayload>;
export type AnyProtocolMessage = SimulatorToRendererWSMessage | RendererToSimulatorWSMessage;

/** @deprecated Use SimulatorToRendererMessageType. */
export type ServerToClientMessageType = SimulatorToRendererMessageType;
/** @deprecated Use RendererToSimulatorMessageType. */
export type ClientToServerMessageType = RendererToSimulatorMessageType;
/** @deprecated Use ProtocolMessageType. */
export type WSMessageType = ProtocolMessageType;
/** @deprecated Use ProtocolMessage. */
export type WSMessage<T = unknown> = ProtocolMessage<ProtocolMessageType, T>;
/** @deprecated Use SimulatorToRendererMessage. */
export type ServerToClientMessage<T = unknown> = SimulatorToRendererMessage<T>;
/** @deprecated Use RendererToSimulatorMessage. */
export type ClientToServerMessage<T = unknown> = RendererToSimulatorMessage<T>;
/** @deprecated Use SimulatorToRendererPayload. */
export type ServerToClientPayload = SimulatorToRendererPayload;
/** @deprecated Use RendererToSimulatorPayload. */
export type ClientToServerPayload = RendererToSimulatorPayload;
/** @deprecated Use SimulatorToRendererWSMessage. */
export type ServerToClientWSMessage = SimulatorToRendererWSMessage;
/** @deprecated Use RendererToSimulatorWSMessage. */
export type ClientToServerWSMessage = RendererToSimulatorWSMessage;