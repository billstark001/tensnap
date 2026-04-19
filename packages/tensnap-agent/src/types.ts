import type { ChartMetadata } from '@tensnap/core/chart';
import type { Viewport } from '@tensnap/core/environment/types/viewport';
import type { Action, Parameter } from '@tensnap/core/parameter';
import type { NormalizedLogPayload, ProtocolEncoding } from '@tensnap/core/protocol';
import type { SceneReservedAction } from './session/reserved-actions';

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
  logs: NormalizedLogPayload[];
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
  outputPath?: string;
  persist?: boolean;
  includeData?: boolean;
}