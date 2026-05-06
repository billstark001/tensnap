import type { AssetMeta } from '@tensnap/core/asset';
import type { ChartMetadata } from '@tensnap/core/chart';
import type { ChartSeriesPoint } from '@tensnap/core/chart';
import type { Viewport } from '@tensnap/core/environment';
import type { Action, Parameter } from '@tensnap/core/parameter';
import type { ActionEndPayload, NormalizedLogPayload, ProtocolEncoding } from '@tensnap/core/protocol';
import type { ScenarioSnapshot } from '@tensnap/core/scenario';
import type { SceneReservedAction } from './session/reserved-actions';
import type { RenderArtifact } from './runtime/painter';

export type RenderTriggerMode = 'manual' | 'action-end';
export type RenderFormat = 'png' | 'jpeg';

export type RuntimePhase =
  | 'idle'
  | 'starting'
  | 'connecting'
  | 'open'
  | 'syncing'
  | 'ready'
  | 'stopping'
  | 'stopped'
  | 'error';

export interface RenderSettings {
  trigger: RenderTriggerMode;
  backgroundColor: string;
}

export interface RuntimeContextOptions {
  cwd?: string;
  rootDir?: string;
  contextName?: string;
}

export interface RuntimeControlFile {
  version: 1;
  contextName: string;
  contextDir: string;
  createdAt: string;
  updatedAt: string;
  host: string;
  controlPort: number | null;
  pid: number | null;
  phase: RuntimePhase;
  simulatorUrl?: string;
  encoding: ProtocolEncoding;
  render: RenderSettings;
  painters: string[];
  lastError?: string;
}

export interface RuntimeLogEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
  data?: unknown;
}

export interface ActionSummary extends Action {
  reserved?: SceneReservedAction;
}

export interface SceneEnvironmentSummary {
  id: string;
  type: string;
  layerCount: number;
  layerIds: string[];
}

export interface SceneSummary {
  metadata: Record<string, unknown>;
  time?: number;
  environments: SceneEnvironmentSummary[];
  parameters: Parameter[];
  actions: ActionSummary[];
  charts: ChartMetadata[];
  assets: SceneAssetSummary[];
  logs: NormalizedLogPayload[];
}

export interface ChartSeriesSnapshot {
  id: string;
  metadata: ChartMetadata;
  points: ChartSeriesPoint[];
}

export interface SceneAssetSummary extends AssetMeta {
  resolved: boolean;
  valueType: 'pending' | 'string' | 'bytes';
}

export interface WaitForActionEndOptions {
  id?: string;
  timeoutMs?: number;
}

export interface SceneSnapshotInspection {
  snapshot: ScenarioSnapshot;
  charts: ChartSeriesSnapshot[];
  assets: SceneAssetSummary[];
}

export type WaitForActionEndResult = ActionEndPayload;

export type WaitComparisonOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
export type WaitMetadataComparisonOperator = WaitComparisonOperator | 'exists';

export interface WaitForTimeOptions {
  time: number;
  comparison?: WaitComparisonOperator;
  timeoutMs?: number;
}

export interface WaitForTimeResult {
  kind: 'time';
  comparison: WaitComparisonOperator;
  expectedTime: number;
  actualTime: number;
}

export interface WaitForChartOptions {
  id: string;
  value: number;
  comparison?: WaitComparisonOperator;
  atTime?: number;
  timeoutMs?: number;
}

export interface WaitForChartResult {
  kind: 'chart';
  id: string;
  comparison: WaitComparisonOperator;
  expectedValue: number;
  actualValue: number;
  atTime?: number;
}

export interface WaitForMetadataOptions {
  path: string;
  value?: unknown;
  comparison?: WaitMetadataComparisonOperator;
  timeoutMs?: number;
}

export interface WaitForMetadataResult {
  kind: 'metadata';
  path: string;
  comparison: WaitMetadataComparisonOperator;
  expectedValue?: unknown;
  actualValue: unknown;
}

export type ExperimentWaitRequest =
  | ({ kind: 'action-end' } & WaitForActionEndOptions)
  | ({ kind: 'time' } & WaitForTimeOptions)
  | ({ kind: 'chart' } & WaitForChartOptions)
  | ({ kind: 'metadata' } & WaitForMetadataOptions);

export type ExperimentWaitResult =
  | { kind: 'action-end'; payload: WaitForActionEndResult }
  | WaitForTimeResult
  | WaitForChartResult
  | WaitForMetadataResult;

export interface ExperimentActionRequest {
  id: string;
  continuous?: boolean;
  waitForEnd?: boolean;
  timeoutMs?: number;
}

export interface ExperimentResetRequest {
  enabled?: boolean;
  actionId?: string;
  continuous?: boolean;
  timeoutMs?: number;
}

export interface ExperimentCollectionOptions {
  scene?: boolean;
  snapshot?: boolean;
}

export interface ExperimentRunRequest {
  label?: string;
  parameters?: Record<string, unknown>;
  reset?: boolean | ExperimentResetRequest;
  action?: ExperimentActionRequest;
  waits?: ExperimentWaitRequest[];
  render?: (SceneRenderOptions & { reason?: string }) | null;
  collect?: ExperimentCollectionOptions;
}

export interface ExperimentRunResult {
  label?: string;
  startedAt: string;
  finishedAt: string;
  parametersApplied: Array<{ id: string; value: unknown }>;
  waits: ExperimentWaitResult[];
  scene?: SceneSummary;
  snapshot?: SceneSnapshotInspection;
  renderArtifacts?: RenderArtifact[];
}

export interface RuntimeStatus extends RuntimeControlFile {
  isConnected: boolean;
}

export interface RuntimeEvent<T = unknown> {
  type: string;
  at: string;
  data: T;
}

export interface ConnectOptions {
  simulatorUrl: string;
  encoding?: ProtocolEncoding;
}

export interface ActionRunOptions {
  continuous?: boolean;
}

export interface SceneRenderOptions {
  envId?: string;
  width?: number;
  height?: number;
  viewport?: Viewport;
  format?: RenderFormat;
  quality?: number;
  backgroundColor?: string;
  outputPath?: string;
  persist?: boolean;
  includeData?: boolean;
}