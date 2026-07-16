import type { ChartGroup } from '../chart';
import type { AssetSnapshot } from '../asset';
import type { MonitorState } from '../monitor';
import type {
  Action,
  ActionResultPayload,
  ActionInvokePayload,
  AssetDataPayload,
  AssetDeletePayload,
  AssetMetadataPayload,
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
  MonitorDeletePayload,
  MonitorMetadata,
  MonitorUpdatePayload,
  NormalizedLogPayload,
  Parameter,
  ParameterChangePayload,
  ParameterSyncPayload,
  ScenarioEnvironmentType,
  ScreenshotRequestPayload,
  StateSyncBeginPayload,
  StateSyncEndPayload,
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
  monitors: MonitorState[];
  logs: NormalizedLogPayload[];
  assets: AssetSnapshot[];
}

/** Selective snapshots keep recorder keyframes from copying append-only streams. */
export interface ScenarioDumpOptions {
  includeCharts?: boolean;
  includeMonitors?: boolean;
  includeLogs?: boolean;
  includeAssets?: boolean;
}

export interface ScenarioEventDetailMap {
  'metadata:update': MetadataUpdatePayload;
  'state_sync:begin': StateSyncBeginPayload;
  'state_sync:end': StateSyncEndPayload;
  'action:result': ActionResultPayload;
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
  /** Local renderer echo of an accepted `param_change` request. */
  'param:optimistic': ParameterSyncPayload;
  'param:sync': ParameterSyncPayload;
  'chart:create': ChartGroupMetadata;
  'chart:update': ChartUpdatePayload;
  'chart:delete': ChartDeletePayload;
  'monitor:create': MonitorMetadata;
  'monitor:update': MonitorUpdatePayload;
  'monitor:delete': MonitorDeletePayload;
  'asset:metadata': AssetMetadataPayload;
  'asset:data': AssetDataPayload;
  'asset:delete': AssetDeletePayload;
  'screenshot:request': ScreenshotRequestPayload;
  log: NormalizedLogPayload;
  reset: undefined;
}

export type ScenarioEventType = keyof ScenarioEventDetailMap;

export interface ScenarioMessageFactory {
  createStateSyncMessage(modelId: string, requestId: string, instanceId?: string): { type: 'state_sync'; payload: StateSyncRequest };
  createParamChangeMessage(id: string, value: ParameterChangePayload['value']): { type: 'param_change'; payload: ParameterChangePayload };
  createActionInvokeMessage(
    id: string,
    requestId: string,
    options?: Pick<ActionInvokePayload, 'continuous' | 'target' | 'kwargs'>,
  ): { type: 'action_invoke'; payload: ActionInvokePayload };
  createAssetSyncMessage(): { type: 'asset_sync'; payload: { assets: Record<string, string> } };
}
