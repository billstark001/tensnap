import {
  Agent,
  AgentId,
  ChartUpdateData,
  ChartMetadata,
  EnvironmentId,
  Parameter,
  Action,
  ChartGroupMetadata,
  ChartUpdateOperation,
} from "./model";

//#region Message Types

// Server to client message types
export type ServerToClientMessageType =
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

// Client to server message types
export type ClientToServerMessageType =
  | 'state_sync'
  | 'param_change'
  | 'action_start'
  | 'asset_sync'
  | 'error';

// All message types
export type WSMessageType = ServerToClientMessageType | ClientToServerMessageType;

//#endregion

//#region Base Message Structures

export interface WSMessage<T = any> {
  type: WSMessageType;
  payload: T;
  timestamp?: number;
}

export interface ServerToClientMessage<T = any> {
  type: ServerToClientMessageType;
  payload: T;
  timestamp?: number;
}

export interface ClientToServerMessage<T = any> {
  type: ClientToServerMessageType;
  payload: T;
  timestamp?: number;
}

//#endregion

//#region Payload Definitions

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

/** metadata_update — replaces time_step_start + time_step_end */
export interface MetadataUpdatePayload {
  time?: number;
  [key: string]: any;
}

/** action_end — sent after an action finishes executing */
export interface ActionEndPayload {
  id: string;
  /** Explicit false stops a continuous loop; anything else continues. */
  continue?: boolean;
}

/** action_create / action_update */
export type ActionCUPayload = Action;

/** action_delete */
export interface ActionDeletePayload {
  id: string;
}

/** env_create */
export interface EnvCreatePayload {
  id: EnvironmentId;
  type: 'uniform' | '2d';
}

/** env_delete */
export interface EnvDeletePayload {
  id: EnvironmentId;
}

/** env_layer_create */
export interface EnvLayerCreatePayload {
  env_id: EnvironmentId;
  layer_id: string;
  layer_type: string;
  data?: Record<string, any>;
}

/** env_layer_update */
export interface EnvLayerUpdatePayload {
  env_id: EnvironmentId;
  layer_id: string;
  data: Record<string, any>;
}

/** env_layer_delete */
export interface EnvLayerDeletePayload {
  env_id: EnvironmentId;
  layer_id: string;
}

/** agent_create */
export interface AgentCreatePayload {
  env_id: EnvironmentId;
  layer_id: string;
  agents: Agent[];
}

/** agent_update — flat diff: { id, ...changedFields } */
export type AgentDiff = { id: AgentId } & Record<string, any>;

export interface AgentUpdatePayload {
  env_id: EnvironmentId;
  layer_id: string;
  agents: AgentDiff[];
}

/** agent_delete */
export interface AgentDeletePayload {
  env_id: EnvironmentId;
  layer_id: string;
  ids: AgentId[];
}

/** edge_create */
export interface EdgeCreatePayload {
  env_id: EnvironmentId;
  layer_id: string;
  edges: EdgeData[];
}

export interface EdgeData {
  source: AgentId;
  target: AgentId;
  directed?: boolean;
  style?: 'solid' | 'dashed' | 'dotted';
  width?: number;
  color?: string;
  [key: string]: any;
}

/** edge_update — flat diff: { source, target, ...changedFields } */
export type EdgeDiff = { source: AgentId; target: AgentId } & Record<string, any>;

export interface EdgeUpdatePayload {
  env_id: EnvironmentId;
  layer_id: string;
  edges: EdgeDiff[];
}

/** edge_delete */
export interface EdgeDeletePayload {
  env_id: EnvironmentId;
  layer_id: string;
  edges: Array<{ source: AgentId; target: AgentId }>;
}

/** param_create / param_update */
export type ParameterCUPayload = Parameter;

/** param_delete */
export interface ParameterDeletePayload {
  id: string;
}

/** param_sync — server-initiated value correction */
export interface ParameterSyncPayload {
  id: string;
  value: any;
}

/** chart_create */
export type ChartCreatePayload = ChartGroupMetadata;

/** chart_delete */
export interface ChartDeletePayload {
  id: string;
}

/** chart_update — data update (unchanged from v0.1) */
export type ChartUpdatePayload = {
  updates?: ChartUpdateData[];
  operations?: ChartUpdateOperation[];
};

// log
export type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'critical';

export interface LogPayload {
  message: string;
  level?: LogLevel;
  target?: string;
  timestamp?: number;
  data?: any;
}

export interface NormalizedLogPayload extends LogPayload {
  level: LogLevel;
  timestamp: number;
}

// error
export interface ErrorPayload {
  error: string;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export type AssetId = string;

/** Metadata descriptor for a single asset (no binary data). */
export interface AssetMeta {
  id: AssetId;
  /** Content hash (e.g. first 16 hex chars of SHA-256). Used to detect staleness. */
  hash: string;
  /** MIME type, e.g. "image/png", "image/svg+xml", "application/octet-stream". */
  mime: string;
  /** Byte size of the raw data. */
  size: number;
  /** Optional human-readable label. */
  label?: string;
}

/** asset_meta — server announces one or more available assets (no binary data). */
export interface AssetMetaPayload {
  assets: AssetMeta[];
}

/** asset_data — server sends the actual binary data for an asset.
 *  In JSON mode `data` is a base-64 string; in msgpack mode a Uint8Array. */
export interface AssetDataPayload {
  id: AssetId;
  hash: string;
  mime: string;
  data: string | Uint8Array;
}

/** asset_delete — server removes one or more assets from the client cache. */
export interface AssetDeletePayload {
  ids: AssetId[];
}

/** asset_sync — client tells server which assets it already has (id → hash).
 *  Server responds with asset_data for any missing or outdated assets. */
export interface AssetSyncPayload {
  /** Map of asset id to the hash the client currently holds. */
  assets: Record<AssetId, string>;
}

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

/** state_sync — client sends its full state; server replies with CUD messages */
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

/** param_change */
export interface ParameterChangePayload {
  id: string;
  value: any;
}

/** action_start */
export interface ActionStartPayload {
  id: string;
  continuous?: boolean;
}

/** asset_sync — client reports which assets it already holds (id → hash) */
// AssetSyncPayload is defined above in the Assets section.

//#endregion

//#region Server to Client Union Types

export type ServerToClientPayload =
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

export type ServerToClientWSMessage = ServerToClientMessage<ServerToClientPayload>;

//#endregion

//#region Client to Server Union Types

export type ClientToServerPayload =
  | StateSyncRequest
  | ParameterChangePayload
  | ActionStartPayload
  | AssetSyncPayload;

export type ClientToServerWSMessage = ClientToServerMessage<ClientToServerPayload>;

//#endregion
