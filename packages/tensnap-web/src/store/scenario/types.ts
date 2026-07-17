import { SetStateAction } from 'react';
import {
  Scenario,
  RendererSession,
  ScenarioSnapshot,
  ScenarioEnvironmentState,
  ChartStorage,
  ChartGroup,
} from '@tensnap/core';
import type { ActionRunMetricSnapshot } from '@tensnap/core/runtime';
import type { DiagnosticEvent } from '@tensnap/core';
import type { RecordingOptions, Snapshot, SnapshotCheckpoint, SnapshotModelIdentity } from '@tensnap/core/snapshot';
import type {
  Action,
  ChartGroupMetadata,
  NormalizedLogPayload,
  Parameter,
  StateSyncBeginPayload,
  StateSyncEndPayload,
} from '@tensnap/protocol';
import { ContainerView } from '../../types/ui';
import { UpdateTriggerState } from '../update-trigger';

export interface StateSyncStatus {
  requestId: string | null;
  phase: 'idle' | 'requested' | 'receiving';
  autoLayoutOnComplete: boolean;
}

/** Project-scoped, bounded diagnostics rendered in the bottom panel. */
export interface ProjectDiagnostic extends DiagnosticEvent {
  id: string;
  count: number;
  lastTimestamp: number;
}

export interface SnapshotDraft {
  id?: string;
  timestamp?: number;
  label?: string;
  modelIdentity?: SnapshotModelIdentity;
  checkpoint?: SnapshotCheckpoint;
}

export interface EditableEnvironmentDraft {
  id: string;
  type: '2d' | 'uniform';
  label?: string;
  width?: number;
  height?: number;
}

export type ScreenshotCaptureHandler = (format: 'png' | 'jpeg', quality?: number) => Promise<Blob | null>;

export interface SetDataPayload {
  environments?: EditableEnvironmentDraft[];
  parameters?: Parameter[];
  charts?: ChartGroupMetadata[];
  removedActionIds?: string[];
  removedEnvironmentIds?: string[];
  removedParameterIds?: string[];
  removedChartIds?: string[];
}

export interface ScenarioStore {
  session: RendererSession;
  scenario: Scenario;
  snapshots: Snapshot[];
  maxSnapshots: number;
  isRecording: boolean;
  mainView: ContainerView;
  connected: boolean;
  actionMetrics: ActionRunMetricSnapshot | null;
  stateSync: StateSyncStatus;
  actionRevision: number;
  chartRevision: number;
  monitorRevision: number;
  logRevision: number;
  diagnosticRevision: number;
  runRevision: number;
  assetRevision: number;
  viewUpdateTrigger: UpdateTriggerState;
  environmentUpdateTrigger: UpdateTriggerState;
  parameterUpdateTrigger: UpdateTriggerState;
  diagnostics: readonly ProjectDiagnostic[];

  setConnected: (connected: boolean) => void;
  appendDiagnostic: (diagnostic: Omit<DiagnosticEvent, 'timestamp'> & { timestamp?: number }) => void;
  clearDiagnostics: () => void;
  prepareStateSync: (requestId: string, options?: { autoLayoutOnComplete?: boolean }) => void;
  handleStateSyncBoundary: (
    phase: 'begin' | 'end',
    payload: StateSyncBeginPayload | StateSyncEndPayload,
  ) => void;
  resetStateSync: () => void;
  isMainViewAutoLayoutCandidate: () => boolean;
  setMainView: (view: SetStateAction<ContainerView>) => void;
  /** Applies a renderer-history patch without recording another command. */
  replaceMainView: (view: ContainerView) => void;
  updateMainViewLayout: (options?: { recordHistory?: boolean }) => void;

  dump: () => ScenarioSnapshot;
  load: (snapshot: ScenarioSnapshot) => void;
  clearAll: () => void;
  setData: (payload: SetDataPayload, options?: { updateLayout?: boolean; preserveExisting?: boolean }) => void;
  upsertAction: (action: Action) => void;
  updateActionProps: (id: string, props: Partial<Action>) => boolean;
  renameAction: (id: string, newId: string) => boolean;
  updateParameterProps: (id: string, props: Partial<Parameter>) => boolean;
  renameParameter: (id: string, newId: string) => boolean;
  updateEnvironment: (id: string, props: Record<string, unknown>) => boolean;
  renameEnvironment: (id: string, newId: string) => boolean;
  updateChartProps: (id: string, props: Partial<ChartGroup>) => boolean;
  renameChartGroup: (id: string, newId: string) => boolean;

  registerScreenshotCapture: (id: string, handler: ScreenshotCaptureHandler) => void;
  unregisterScreenshotCapture: (id: string) => void;
  getScreenshotCapture: (id: string) => ScreenshotCaptureHandler | undefined;

  addSnapshot: (draft?: SnapshotDraft) => void;
  /** Captures an exact checkpoint when the connected simulator supports it. */
  captureSnapshot: (draft?: SnapshotDraft) => Promise<void>;
  startRecording: (options?: RecordingOptions) => void;
  stopRecording: () => void;
  renameSnapshot: (id: string, label: string) => void;
  removeSnapshot: (id: string) => void;
  clearSnapshots: () => void;
  setMaxSnapshots: (max: number) => void;

  currentTime: number | null;
  get environments(): ReadonlyMap<string, ScenarioEnvironmentState>;
  get parameters(): ReadonlyMap<string, Parameter>;
  get actions(): ReadonlyMap<string, Action>;
  get charts(): ChartStorage;
  get monitors(): Scenario['monitors'];
  get logs(): readonly NormalizedLogPayload[];
  get lastLogs(): NormalizedLogPayload | undefined;
}
