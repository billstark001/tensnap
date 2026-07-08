import type { ChartGroup } from '../chart';
import type {
  Action,
  ActionEndPayload,
  ActionStartPayload,
  AssetDataPayload,
  AssetDeletePayload,
  AssetMetaPayload,
  ChartDeletePayload,
  ChartGroupMetadata,
  ChartUpdatePayload,
  EnvCreatePayload,
  EnvDeletePayload,
  EnvLayerCreatePayload,
  EnvLayerDeletePayload,
  EnvLayerUpdatePayload,
  ItemCreatePayload,
  ItemDeletePayload,
  ItemUpdatePayload,
  MetadataUpdatePayload,
  NormalizedLogPayload,
  Parameter,
  ParameterChangePayload,
  ParameterSyncPayload,
  ScenarioEnvironmentType,
  ScreenshotRequestPayload,
  StateSyncBoundaryPayload,
  StateSyncRequest,
} from '@tensnap/protocol';

export interface ScenarioLayerState {
  id: string;
  layerType: string;
  metadata: Record<string, unknown>;
  storage: ScenarioLayerStorage;
  dependencyLayerIds: Record<string, string>;
}

export interface ScenarioLayerStorage {
  dump(): unknown;
  load(snapshot: unknown): void;
}

export interface ScenarioEnvironmentState {
  id: string;
  type: ScenarioEnvironmentType;
  layers: Map<string, ScenarioLayerState>;
  dependencyGraph: Map<string, Set<string>>;
}

export interface ScenarioLayerSnapshot {
  id: string;
  layerType: string;
  metadata: Record<string, unknown>;
  dependencyLayerIds: Record<string, string>;
  storageSnapshot: unknown;
}

export interface ScenarioEnvironmentSnapshot {
  id: string;
  type: ScenarioEnvironmentType;
  layers: ScenarioLayerSnapshot[];
}

export interface ScenarioSnapshot {
  metadata: Record<string, unknown>;
  actions: Action[];
  parameters: Parameter[];
  environments: ScenarioEnvironmentSnapshot[];
  charts: ChartGroup[];
  logs: NormalizedLogPayload[];
}

export interface ScenarioEventDetailMap {
  'metadata:update': MetadataUpdatePayload;
  'state_sync:begin': StateSyncBoundaryPayload;
  'state_sync:end': StateSyncBoundaryPayload;
  'action:end': ActionEndPayload;
  'action:create': Action;
  'action:update': Action;
  'action:delete': { id: string };
  'env:create': EnvCreatePayload;
  'env:delete': EnvDeletePayload;
  'layer:create': EnvLayerCreatePayload;
  'layer:update': EnvLayerUpdatePayload;
  'layer:delete': EnvLayerDeletePayload;
  'item:create': ItemCreatePayload;
  'item:update': ItemUpdatePayload;
  'item:delete': ItemDeletePayload;
  'param:create': Parameter;
  'param:update': Parameter;
  'param:delete': { id: string };
  'param:sync': ParameterSyncPayload;
  'chart:create': ChartGroupMetadata;
  'chart:update': ChartUpdatePayload;
  'chart:delete': ChartDeletePayload;
  'asset:meta': AssetMetaPayload;
  'asset:data': AssetDataPayload;
  'asset:delete': AssetDeletePayload;
  'screenshot:request': ScreenshotRequestPayload;
  log: NormalizedLogPayload;
  reset: undefined;
}

export type ScenarioEventType = keyof ScenarioEventDetailMap;

export interface ScenarioMessageFactory {
  createStateSyncMessage(requestId?: string): { type: 'state_sync'; payload: StateSyncRequest };
  createParamChangeMessage(id: string, value: unknown): { type: 'param_change'; payload: ParameterChangePayload };
  createActionStartMessage(id: string, continuous?: boolean, tickId?: string): { type: 'action_start'; payload: ActionStartPayload };
  createAssetSyncMessage(): { type: 'asset_sync'; payload: { assets: Record<string, string> } };
}
