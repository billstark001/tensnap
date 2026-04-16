import { SetStateAction } from 'react';
import {
  Action,
  Parameter,
  Scenario,
  ScenarioSnapshot,
  ScenarioEnvironmentState,
  ChartStorage,
  ChartGroupMetadata,
  RendererToSimulatorMessage,
  SimulatorToRendererMessage,
  StateSyncRequest,
  ParameterChangePayload,
  ActionStartPayload,
  NormalizedLogPayload,
  ScreenshotResponsePayload,
} from '@tensnap/core';
import { ContainerView } from '../../types/ui';
import { UpdateTriggerState } from '../update-trigger';

export interface SnapshotDraft {
  id?: string;
  timestamp?: number;
}

export interface EditableEnvironmentDraft {
  id: string;
  type: 'grid' | 'uniform';
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
  scenario: Scenario;
  snapshots: ScenarioSnapshot[];
  maxSnapshots: number;
  mainView: ContainerView;
  connected: boolean;
  _revision: number;
  _assetRevision: number;
  viewUpdateTrigger: UpdateTriggerState;
  environmentUpdateTrigger: UpdateTriggerState;
  parameterUpdateTrigger: UpdateTriggerState;

  setConnected: (connected: boolean) => void;
  setMainView: (view: SetStateAction<ContainerView>) => void;
  updateMainViewLayout: () => void;

  applyMessage: (message: SimulatorToRendererMessage) => void;
  dump: () => ScenarioSnapshot;
  load: (snapshot: ScenarioSnapshot) => void;
  clearAll: () => void;
  setData: (payload: SetDataPayload, options?: { updateLayout?: boolean; preserveExisting?: boolean }) => void;
  upsertAction: (action: Action) => void;
  updateActionProps: (id: string, props: Partial<Action>) => void;
  renameAction: (id: string, newId: string) => void;
  updateParameterProps: (id: string, props: Partial<Parameter>) => void;
  renameParameter: (id: string, newId: string) => void;
  updateEnvironment: (id: string, props: Record<string, unknown>) => void;
  renameEnvironment: (id: string, newId: string) => void;
  updateChartProps: (id: string, props: { label?: string }) => void;
  renameChartGroup: (id: string, newId: string) => void;

  createStateSyncMessage: () => RendererToSimulatorMessage<StateSyncRequest>;
  createParamChangeMessage: (id: string, value: unknown) => RendererToSimulatorMessage<ParameterChangePayload>;
  createActionStartMessage: (id: string, continuous?: boolean) => RendererToSimulatorMessage<ActionStartPayload>;
  createAssetSyncMessage: () => RendererToSimulatorMessage<{ assets: Record<string, string> }>;
  createScreenshotResponseMessage: (payload: ScreenshotResponsePayload) => RendererToSimulatorMessage<ScreenshotResponsePayload>;

  registerScreenshotCapture: (id: string, handler: ScreenshotCaptureHandler) => void;
  unregisterScreenshotCapture: (id: string) => void;
  getScreenshotCapture: (id: string) => ScreenshotCaptureHandler | undefined;

  addSnapshot: (draft?: SnapshotDraft) => void;
  removeSnapshot: (id: string) => void;
  clearSnapshots: () => void;
  setMaxSnapshots: (max: number) => void;

  get currentTime(): number;
  get environments(): ReadonlyMap<string, ScenarioEnvironmentState>;
  get parameters(): ReadonlyMap<string, Parameter>;
  get actions(): ReadonlyMap<string, Action>;
  get charts(): ChartStorage;
  get logs(): readonly NormalizedLogPayload[];
  get lastLogs(): NormalizedLogPayload | undefined;
}
