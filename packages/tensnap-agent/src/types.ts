import type { ChartSeriesPoint } from '@tensnap/core/chart';
import type { Viewport } from '@tensnap/core/environment';
import type {
  Action,
  AssetMeta,
  ChartMetadata,
  NormalizedLogPayload,
  Parameter,
  ProtocolEncoding,
} from '@tensnap/protocol';
import type { ScenarioSnapshot } from '@tensnap/core/scenario';
import type { RunSpec, RunStatus } from '@tensnap/core/runtime';

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
  maxRunStepsPolicy: number;
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

export type ActionSummary = Action;

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

export interface SceneSnapshotInspection {
  snapshot: ScenarioSnapshot;
  charts: ChartSeriesSnapshot[];
  assets: SceneAssetSummary[];
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

export type AgentRunSpec = RunSpec;
export type AgentRunStatus = RunStatus;

export interface SceneRenderOptions {
  envId?: string;
  chartId?: string;
  width?: number;
  height?: number;
  viewport?: Viewport;
  format?: RenderFormat;
  quality?: number;
  backgroundColor?: string;
  outputPath?: string;
  persist?: boolean;
  includeData?: boolean;
  /** Render graph edges at the stored coordinates without running d3-force. */
  readOnlyGraphLayout?: boolean;
}
