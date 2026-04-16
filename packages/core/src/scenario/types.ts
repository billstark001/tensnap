import type { ChartGroup } from '../chart';
import type { Action, Parameter } from '../parameter';
import type {
  ActionEndPayload,
  ActionStartPayload,
  AgentCreatePayload,
  AgentDeletePayload,
  AgentUpdatePayload,
  AssetDataPayload,
  AssetDeletePayload,
  AssetMetaPayload,
  ChartCreatePayload,
  ChartDeletePayload,
  ChartUpdatePayload,
  EdgeCreatePayload,
  EdgeDeletePayload,
  EdgeUpdatePayload,
  EnvCreatePayload,
  EnvDeletePayload,
  EnvLayerCreatePayload,
  EnvLayerDeletePayload,
  EnvLayerUpdatePayload,
  LogPayload,
  MetadataUpdatePayload,
  NormalizedLogPayload,
  ParameterChangePayload,
  ParameterSyncPayload,
  ScenarioEnvironmentType,
  ScreenshotRequestPayload,
  StateSyncRequest,
} from '../protocol';

export interface ScenarioLayerState {
  id: string;
  layerType: string;
  metadata: Record<string, unknown>;
  storage: ScenarioStorage;
  agentLayerRef?: string;
}

export interface ScenarioStorage {
  dump(): unknown;
  load(snapshot: unknown): void;
}

export interface ScenarioEnvironmentState {
  id: string;
  type: ScenarioEnvironmentType;
  layers: Map<string, ScenarioLayerState>;
}

export interface ScenarioLayerSnapshot {
  id: string;
  layerType: string;
  metadata: Record<string, unknown>;
  storageSnapshot: unknown;
  agentLayerRef?: string;
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
  'action:end': ActionEndPayload;
  'action:create': Action;
  'action:update': Action;
  'action:delete': { id: string };
  'env:create': EnvCreatePayload;
  'env:delete': EnvDeletePayload;
  'layer:create': EnvLayerCreatePayload;
  'layer:update': EnvLayerUpdatePayload;
  'layer:delete': EnvLayerDeletePayload;
  'agent:create': AgentCreatePayload;
  'agent:update': AgentUpdatePayload;
  'agent:delete': AgentDeletePayload;
  'edge:create': EdgeCreatePayload;
  'edge:update': EdgeUpdatePayload;
  'edge:delete': EdgeDeletePayload;
  'param:create': Parameter;
  'param:update': Parameter;
  'param:delete': { id: string };
  'param:sync': ParameterSyncPayload;
  'chart:create': ChartCreatePayload;
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
  createStateSyncMessage(): { type: 'state_sync'; payload: StateSyncRequest };
  createParamChangeMessage(id: string, value: unknown): { type: 'param_change'; payload: ParameterChangePayload };
  createActionStartMessage(id: string, continuous?: boolean): { type: 'action_start'; payload: ActionStartPayload };
  createAssetSyncMessage(): { type: 'asset_sync'; payload: { assets: Record<string, string> } };
}

export type ScenarioLogPayload = LogPayload;