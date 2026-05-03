import type { AssetId, AssetMeta } from '../asset/types';
import type { ChartGroupMetadata, ChartMetadata, ChartUpdateData, ChartUpdateOperation } from '../chart/types';
import type { Action, Parameter } from '../parameter/types';

export type EnvironmentId = string;
export type ScenarioEnvironmentType = 'uniform' | '2d';
export type ItemRecord = Record<string, unknown>;
export type ItemDiff = Record<string, unknown>;
export type ItemKey = Record<string, unknown>;
export type PrimitiveItemKey = string | number;
export type ItemDeleteItems = ItemKey[] | PrimitiveItemKey[];

export type SimulatorToRendererMessageType =
  | 'metadata_update'
  | 'state_sync_begin'
  | 'state_sync_end'
  | 'action_end'
  | 'action_create'
  | 'action_update'
  | 'action_delete'
  | 'env_create'
  | 'env_delete'
  | 'env_layer_create'
  | 'env_layer_update'
  | 'env_layer_delete'
  | 'item_create'
  | 'item_update'
  | 'item_delete'
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
  | 'screenshot_request'
  | 'log'
  | 'error';

export type RendererToSimulatorMessageType =
  | 'state_sync'
  | 'param_change'
  | 'action_start'
  | 'asset_sync'
  | 'screenshot_response'
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

export interface StateSyncBoundaryPayload {
  request_id?: string;
}

export interface TickTimingBreakdown {
  simulate_ms?: number;
  communicate_ms?: number;
  render_ms?: number;
  [key: string]: number | undefined;
}

export interface ActionEndPayload {
  id: string;
  tick_id?: string;
  continue?: boolean;
  timings?: TickTimingBreakdown;
}

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
  dependency_layer_ids?: Record<string, string>;
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

export interface ItemCreatePayload<TItem extends ItemRecord = ItemRecord> {
  env_id: EnvironmentId;
  layer_id: string;
  items: TItem[];
}

export interface ItemUpdatePayload<TItem extends ItemDiff = ItemDiff> {
  env_id: EnvironmentId;
  layer_id: string;
  items: TItem[];
}

export interface ItemDeletePayload<TItems extends ItemDeleteItems = ItemDeleteItems> {
  env_id: EnvironmentId;
  layer_id: string;
  items: TItems;
}

export interface ParameterDeletePayload {
  id: string;
}

export interface ParameterSyncPayload {
  id: string;
  value: unknown;
}

export interface ChartDeletePayload {
  id: string;
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

export interface ScreenshotRequestPayload {
  request_id: string;
  env_id?: string;
  chart_id?: string;
  format?: 'png' | 'jpeg';
  quality?: number;
}

export interface ScreenshotResponsePayload {
  request_id: string;
  data?: string | Uint8Array;
  mime?: string;
  error?: string;
}

export interface StateSyncRequest {
  request_id?: string;
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
  tick_id?: string;
  continuous?: boolean;
}

export type SimulatorToRendererPayload =
  | MetadataUpdatePayload
  | StateSyncBoundaryPayload
  | ActionEndPayload
  | Action
  | ActionDeletePayload
  | EnvCreatePayload
  | EnvDeletePayload
  | EnvLayerCreatePayload
  | EnvLayerUpdatePayload
  | EnvLayerDeletePayload
  | ItemCreatePayload
  | ItemUpdatePayload
  | ItemDeletePayload
  | Parameter
  | ParameterDeletePayload
  | ParameterSyncPayload
  | ChartGroupMetadata
  | ChartUpdatePayload
  | ChartDeletePayload
  | AssetMetaPayload
  | AssetDataPayload
  | AssetDeletePayload
  | ScreenshotRequestPayload
  | LogPayload
  | ErrorPayload;

export type RendererToSimulatorPayload =
  | StateSyncRequest
  | ParameterChangePayload
  | ActionStartPayload
  | AssetSyncPayload
  | ScreenshotResponsePayload
  | ErrorPayload;

export type SimulatorToRendererWSMessage = SimulatorToRendererMessage<SimulatorToRendererPayload>;
export type RendererToSimulatorWSMessage = RendererToSimulatorMessage<RendererToSimulatorPayload>;
export type AnyProtocolMessage = SimulatorToRendererWSMessage | RendererToSimulatorWSMessage;
