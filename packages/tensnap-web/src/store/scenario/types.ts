import { SetStateAction } from 'react';
import {
  Scenario,
  RendererSession,
  ScenarioSnapshot,
  ScenarioEnvironmentState,
  ChartStorage,
  ChartGroup,
} from '@tensnap/core';
import type { RecordingOptions, Snapshot } from '@tensnap/core/snapshot';
import type {
  Action,
  ActionStartPayload,
  ChartGroupMetadata,
  NormalizedLogPayload,
  Parameter,
  ParameterChangePayload,
  RendererToSimulatorMessage,
  ScreenshotResponsePayload,
  SimulatorToRendererMessage,
  StateSyncBoundaryPayload,
  StateSyncRequest,
} from '@tensnap/protocol';
import { ContainerView } from '../../types/ui';
import { UpdateTriggerState } from '../update-trigger';

export interface StateSyncStatus {
  requestId: string | null;
  phase: 'idle' | 'requested' | 'receiving';
  autoLayoutOnComplete: boolean;
}

export interface SnapshotDraft {
  id?: string;
  timestamp?: number;
  label?: string;
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
  stateSync: StateSyncStatus;
  _revision: number;
  _assetRevision: number;
  viewUpdateTrigger: UpdateTriggerState;
  environmentUpdateTrigger: UpdateTriggerState;
  parameterUpdateTrigger: UpdateTriggerState;

  setConnected: (connected: boolean) => void;
  prepareStateSync: (requestId: string, options?: { autoLayoutOnComplete?: boolean }) => void;
  handleStateSyncBoundary: (phase: 'begin' | 'end', payload: StateSyncBoundaryPayload) => void;
  resetStateSync: () => void;
  isMainViewAutoLayoutCandidate: () => boolean;
  setMainView: (view: SetStateAction<ContainerView>) => void;
  /** Applies a renderer-history patch without recording another command. */
  replaceMainView: (view: ContainerView) => void;
  updateMainViewLayout: (options?: { recordHistory?: boolean }) => void;

  applyMessage: (message: SimulatorToRendererMessage) => void;
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

  createStateSyncMessage: (requestId?: string) => RendererToSimulatorMessage<StateSyncRequest>;
  createParamChangeMessage: (id: string, value: unknown) => RendererToSimulatorMessage<ParameterChangePayload>;
  createActionStartMessage: (id: string, continuous?: boolean, tickId?: string) => RendererToSimulatorMessage<ActionStartPayload>;
  createAssetSyncMessage: () => RendererToSimulatorMessage<{ assets: Record<string, string> }>;
  createScreenshotResponseMessage: (payload: ScreenshotResponsePayload) => RendererToSimulatorMessage<ScreenshotResponsePayload>;

  registerScreenshotCapture: (id: string, handler: ScreenshotCaptureHandler) => void;
  unregisterScreenshotCapture: (id: string) => void;
  getScreenshotCapture: (id: string) => ScreenshotCaptureHandler | undefined;

  addSnapshot: (draft?: SnapshotDraft) => void;
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
  get logs(): readonly NormalizedLogPayload[];
  get lastLogs(): NormalizedLogPayload | undefined;
}
