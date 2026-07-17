import type { ChartSeriesPoint } from '@tensnap/core/chart';
import type { Viewport } from '@tensnap/core/environment';
import type {
  Action,
  AssetMeta,
  ChartMetadata,
  NormalizedLogPayload,
  Parameter,
  ProtocolEncoding,
  ProtocolValidationLevel,
} from '@tensnap/protocol';
import type { ScenarioSnapshot } from '@tensnap/core/scenario';

export type RenderTriggerMode = 'manual' | 'action-result';
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
  clientMessageValidation: ProtocolValidationLevel;
  serverMessageValidation: ProtocolValidationLevel;
  maxRunStepsPolicy: number;
  render: RenderSettings;
  painters: string[];
  /** Monotonic in-memory scene state revision. */
  sceneRevision: number;
  /** True when memory is newer than the persisted checkpoint. */
  sceneDirty: boolean;
  lastError?: string;
}

export interface RuntimeLogEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
  data?: unknown;
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
  actions: Action[];
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
  clientMessageValidation?: ProtocolValidationLevel;
  serverMessageValidation?: ProtocolValidationLevel;
}

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
