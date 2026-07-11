import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { createStoreContext } from '@/utils/zustand';
import { createDefaultRootLayout, createAutoLayout } from '@/utils/view/pack';
import { AnyView, ContainerView } from '@/types/ui';
import { createUpdateTriggerStoreFunction } from '../update-trigger';
import { getToastState } from '../toast';
import { useSettingsStore } from '../settings';
import {
  ChartStorage,
  GridEnvStorage,
  RendererSession,
  Scenario,
  ScenarioEnvironmentState,
  ScenarioSnapshot,
  sanitizeParameter,
} from '@tensnap/core';
import { BrowserRunRenderBarrier } from '@tensnap/core/runtime/browser';
import { createSingleSnapshot, type RecordingOptions, type Snapshot } from '@tensnap/core/snapshot';
import type {
  Action,
  ActionEndPayload,
  MetadataUpdatePayload,
  NormalizedLogPayload,
  Parameter,
  ScreenshotResponsePayload,
  SimulatorToRendererMessage,
  StateSyncBoundaryPayload,
} from '@tensnap/protocol';
import { EditableEnvironmentDraft, ScenarioStore, ScreenshotCaptureHandler, SnapshotDraft, StateSyncStatus } from './types';
import {
  createHistoryCommandId,
  estimateHistoryBytes,
  type HistoryCommandScope,
  type HistoryState,
} from '../undo-redo';

const mutateSnapshot = (scenario: Scenario, mutate: (snapshot: ScenarioSnapshot) => void) => {
  const snapshot = scenario.dump();
  mutate(snapshot);
  scenario.load(snapshot);
};

const upsertEditableEnvironment = (snapshot: ScenarioSnapshot, draft: EditableEnvironmentDraft) => {
  const nextId = draft.id;
  const existing = snapshot.environments.find((env) => env.id === nextId);
  if (existing) {
    existing.type = draft.type;
    const gridLayer = existing.layers.find((layer) => layer.layerType === 'grid');
    if (gridLayer && draft.type === '2d') {
      gridLayer.metadata = {
        ...gridLayer.metadata,
        width: draft.width ?? gridLayer.metadata.width,
        height: draft.height ?? gridLayer.metadata.height,
      };
    }
    return;
  }

  snapshot.environments.push({
    id: nextId,
    type: draft.type,
    layers: draft.type === '2d'
      ? [{
        id: `${nextId}-grid`,
        layerType: 'grid',
        metadata: { width: draft.width ?? 10, height: draft.height ?? 10 },
        dependencyLayerIds: {},
        storageSnapshot: {},
      }, {
        id: `${nextId}-agents`,
        layerType: 'agent',
        metadata: {},
        dependencyLayerIds: {},
        storageSnapshot: { agents: [], trajectories: [] },
      }]
      : [{
        id: `${nextId}-agents`,
        layerType: 'agent',
        metadata: {},
        dependencyLayerIds: {},
        storageSnapshot: { agents: [], trajectories: [] },
      }],
  });
};

const getEnvironmentMetadata = (env: ScenarioEnvironmentState) => {
  const gridLayer = [...env.layers.values()].find((layer) => layer.storage instanceof GridEnvStorage);
  const gridData = gridLayer?.metadata as Record<string, unknown> | undefined;
  return {
    id: env.id,
    type: env.type,
    label: env.id,
    width: typeof gridData?.width === 'number' ? gridData.width : undefined,
    height: typeof gridData?.height === 'number' ? gridData.height : undefined,
  };
};

const createIdleStateSyncStatus = (): StateSyncStatus => ({
  requestId: null,
  phase: 'idle',
  autoLayoutOnComplete: false,
});

type TimeCorrectionState = {
  minimumRuntimeTime: number;
};

const resetTimeCorrection = (correction: TimeCorrectionState) => {
  correction.minimumRuntimeTime = 0;
};

const syncTimeCorrectionFromMetadata = (
  correction: TimeCorrectionState,
  payload: MetadataUpdatePayload,
) => {
  if (payload.time === 0) {
    resetTimeCorrection(correction);
  }
};

const syncTimeCorrectionFromAction = (
  scenario: Scenario,
  correction: TimeCorrectionState,
  payload: ActionEndPayload,
) => {
  if (payload.id === 'reset') {
    resetTimeCorrection(correction);
    return;
  }
  if ((payload.id === 'start' || payload.id === 'step') && scenario.time === 0) {
    correction.minimumRuntimeTime = 1;
  }
};

const getCurrentTime = (scenario: Scenario, correction: TimeCorrectionState): number | null => {
  const time = scenario.time;
  if (typeof time !== 'number') {
    return null;
  }
  return time < correction.minimumRuntimeTime ? correction.minimumRuntimeTime : time;
};

const defaultMainView = createDefaultRootLayout();

const isDefaultMainViewLayout = (view: ContainerView) => (
  view.id === defaultMainView.id
  && view.type === defaultMainView.type
  && view.left === defaultMainView.left
  && view.top === defaultMainView.top
  && view.width === defaultMainView.width
  && view.height === defaultMainView.height
  && view.views.length === 0
  && view.data?.title === defaultMainView.data.title
);

const hasMeaningfulMainViewContent = (view: AnyView): boolean => {
  if (view.type !== 'container') {
    return !view.disabled;
  }
  return view.views.some((child) => hasMeaningfulMainViewContent(child));
};

const isMainViewAutoLayoutCandidate = (view: ContainerView): boolean => (
  isDefaultMainViewLayout(view) || !hasMeaningfulMainViewContent(view)
);

const matchesActiveStateSync = (activeRequestId: string | null, requestId?: string) => {
  if (!activeRequestId) return false;
  return requestId === undefined || requestId === activeRequestId;
};

const subscribeSession = (
  session: RendererSession,
  scenario: Scenario,
  timeCorrection: TimeCorrectionState,
  applyBatch: (flags: {
    changed: boolean;
    environmentChanged: boolean;
    parameterChanged: boolean;
    assetChanged: boolean;
  }) => void,
) => {
  const pending = {
    changed: false,
    environmentChanged: false,
    parameterChanged: false,
    assetChanged: false,
  };
  let queued = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushedAt: number | null = null;

  const flush = () => {
    queued = false;
    flushTimer = null;
    lastFlushedAt = typeof performance === 'undefined' ? Date.now() : performance.now();
    applyBatch({
      changed: pending.changed,
      environmentChanged: pending.environmentChanged,
      parameterChanged: pending.parameterChanged,
      assetChanged: pending.assetChanged,
    });
    pending.changed = false;
    pending.environmentChanged = false;
    pending.parameterChanged = false;
    pending.assetChanged = false;
  };

  const schedule = (updates: Partial<typeof pending>) => {
    if (updates.changed) pending.changed = true;
    if (updates.environmentChanged) pending.environmentChanged = true;
    if (updates.parameterChanged) pending.parameterChanged = true;
    if (updates.assetChanged) pending.assetChanged = true;
    if (!queued) {
      queued = true;
      const maxRenderFps = useSettingsStore.getState().maxRenderFps;
      if (maxRenderFps <= 0 || lastFlushedAt === null) {
        queueMicrotask(flush);
        return;
      }

      const now = typeof performance === 'undefined' ? Date.now() : performance.now();
      const delayMs = Math.max(0, lastFlushedAt + 1_000 / maxRenderFps - now);
      if (delayMs <= 0) {
        queueMicrotask(flush);
      } else {
        flushTimer = setTimeout(flush, delayMs);
      }
    }
  };

  const onCommit: EventListener = (event) => {
    const detail = (event as CustomEvent<{ messages: SimulatorToRendererMessage[] }>).detail;
    const flags = {
      changed: false,
      environmentChanged: false,
      parameterChanged: false,
      assetChanged: false,
    };

    for (const message of detail.messages) {
      switch (message.type) {
        case 'metadata_update':
          syncTimeCorrectionFromMetadata(timeCorrection, message.payload as MetadataUpdatePayload);
          flags.changed = true;
          break;
        case 'action_end':
          syncTimeCorrectionFromAction(scenario, timeCorrection, message.payload as ActionEndPayload);
          flags.changed = true;
          break;
        case 'env_create':
        case 'env_delete':
        case 'env_layer_create':
        case 'env_layer_update':
        case 'env_layer_delete':
        case 'item_create':
        case 'item_update':
        case 'item_delete':
          flags.changed = true;
          flags.environmentChanged = true;
          break;
        case 'param_create':
        case 'param_update':
        case 'param_delete':
        case 'param_sync':
          flags.changed = true;
          flags.parameterChanged = true;
          break;
        case 'asset_meta':
        case 'asset_data':
        case 'asset_delete':
          flags.changed = true;
          flags.assetChanged = true;
          break;
        case 'state_sync_begin':
        case 'state_sync_end':
        case 'screenshot_request':
          break;
        default:
          flags.changed = true;
      }
    }
    schedule(flags);
  };
  const onRunStatus: EventListener = () => schedule({ changed: true });

  session.addEventListener('commit', onCommit);
  session.addEventListener('run:status', onRunStatus);

  return () => {
    session.removeEventListener('commit', onCommit);
    session.removeEventListener('run:status', onRunStatus);
    if (flushTimer !== null) clearTimeout(flushTimer);
  };
};

const createSnapshot = (snapshot: ScenarioSnapshot, draft?: SnapshotDraft): Snapshot => createSingleSnapshot(snapshot, {
  id: draft?.id,
  label: draft?.label,
  timestamp: draft?.timestamp,
});

const appendSnapshot = (snapshots: Snapshot[], snapshot: Snapshot, maxSnapshots: number): Snapshot[] => {
  const next = [...snapshots, snapshot];
  if (maxSnapshots !== -1 && next.length > maxSnapshots) {
    next.splice(0, next.length - maxSnapshots);
  }
  return next;
};

export const createScenarioStore = (historyStore?: UseBoundStore<StoreApi<HistoryState>>) => {
  const renderBarrier = new BrowserRunRenderBarrier(() => {
    const { renderTriggerMode, maxTps, maxRenderFps } = useSettingsStore.getState();
    return { mode: renderTriggerMode, maxTps, maxRenderFps };
  });
  const session = new RendererSession({
    run: {
      renderBarrier,
    },
  });
  const scenario = session.scenario;
  const screenshotCaptures = new Map<string, ScreenshotCaptureHandler>();
  const timeCorrection: TimeCorrectionState = { minimumRuntimeTime: 0 };

  const useStore = create<ScenarioStore>((set, get) => {
    const recordMainViewChange = (
      label: string,
      scope: HistoryCommandScope,
      before: ContainerView,
      after: ContainerView,
      mergeKey?: string,
    ) => {
      if (!historyStore || JSON.stringify(before) === JSON.stringify(after)) return;
      const beforePatch = structuredClone(before);
      const afterPatch = structuredClone(after);
      historyStore.getState().recordApplied({
        id: createHistoryCommandId(),
        label,
        scope,
        mergeKey,
        byteSize: estimateHistoryBytes(beforePatch, afterPatch),
        apply: () => set({ mainView: structuredClone(afterPatch) }),
        revert: () => set({ mainView: structuredClone(beforePatch) }),
      });
    };

    const recordSnapshotChange = (label: string, before: Snapshot[], after: Snapshot[]) => {
      if (!historyStore || JSON.stringify(before) === JSON.stringify(after)) return;
      const beforePatch = structuredClone(before);
      const afterPatch = structuredClone(after);
      historyStore.getState().recordApplied({
        id: createHistoryCommandId(),
        label,
        scope: 'snapshot',
        byteSize: estimateHistoryBytes(beforePatch, afterPatch),
        apply: () => set({ snapshots: structuredClone(afterPatch) }),
        revert: () => set({ snapshots: structuredClone(beforePatch) }),
      });
    };

    const bumpScenarioState = (flags?: {
      environmentChanged?: boolean;
      parameterChanged?: boolean;
      assetChanged?: boolean;
    }) => {
      set((state) => ({
        _revision: state._revision + 1,
        currentTime: getCurrentTime(scenario, timeCorrection),
        _assetRevision: flags?.assetChanged ? state._assetRevision + 1 : state._assetRevision,
        environmentUpdateTrigger: flags?.environmentChanged
          ? { ...state.environmentUpdateTrigger, value: state.environmentUpdateTrigger.value + 1 }
          : state.environmentUpdateTrigger,
        parameterUpdateTrigger: flags?.parameterChanged
          ? { ...state.parameterUpdateTrigger, value: state.parameterUpdateTrigger.value + 1 }
          : state.parameterUpdateTrigger,
      }));
    };

    return {
      session,
      scenario,
      snapshots: [],
      maxSnapshots: 32,
      isRecording: false,
      mainView: createDefaultRootLayout(),
      connected: false,
      stateSync: createIdleStateSyncStatus(),
      _revision: 0,
      _assetRevision: 0,
      currentTime: null,
      viewUpdateTrigger: createUpdateTriggerStoreFunction(
        (x) => set((y) => ({ viewUpdateTrigger: { ...y.viewUpdateTrigger, ...x } })),
        () => get().viewUpdateTrigger,
        null!,
      ),
      environmentUpdateTrigger: createUpdateTriggerStoreFunction(
        (x) => set((y) => ({ environmentUpdateTrigger: { ...y.environmentUpdateTrigger, ...x } })),
        () => get().environmentUpdateTrigger,
        null!,
      ),
      parameterUpdateTrigger: createUpdateTriggerStoreFunction(
        (x) => set((y) => ({ parameterUpdateTrigger: { ...y.parameterUpdateTrigger, ...x } })),
        () => get().parameterUpdateTrigger,
        null!,
      ),

      setConnected: (connected) => set({ connected }),

      prepareStateSync: (requestId, options) => set({
        stateSync: {
          requestId,
          phase: 'requested',
          autoLayoutOnComplete: options?.autoLayoutOnComplete ?? get().isMainViewAutoLayoutCandidate(),
        },
      }),

      handleStateSyncBoundary: (phase, payload: StateSyncBoundaryPayload) => {
        const activeStateSync = get().stateSync;
        if (!matchesActiveStateSync(activeStateSync.requestId, payload.request_id)) {
          return;
        }

        if (phase === 'begin') {
          if (activeStateSync.phase !== 'receiving') {
            set({
              stateSync: {
                ...activeStateSync,
                phase: 'receiving',
              },
            });
          }
          return;
        }

        const shouldAutoLayout = activeStateSync.autoLayoutOnComplete && get().isMainViewAutoLayoutCandidate();
        set({ stateSync: createIdleStateSyncStatus() });
        if (shouldAutoLayout) {
          get().updateMainViewLayout({ recordHistory: false });
        }
      },

      resetStateSync: () => set({ stateSync: createIdleStateSyncStatus() }),

      isMainViewAutoLayoutCandidate: () => isMainViewAutoLayoutCandidate(get().mainView),

      setMainView: (view) => {
        const before = structuredClone(get().mainView);
        const after = typeof view === 'function' ? view(structuredClone(before)) : view;
        set({ mainView: after });
        recordMainViewChange('Update view', 'view-config', before, after);
      },

      replaceMainView: (view) => set({ mainView: structuredClone(view) }),

      updateMainViewLayout: (options) => {
        const state = get();
        const before = structuredClone(state.mainView);
        const after = createAutoLayout(
          state.mainView,
          Array.from(state.scenario.environments.values()).map(getEnvironmentMetadata),
          Array.from(state.scenario.parameters.values()),
          state.scenario.charts.getGroupList(),
          { disableMissingViews: true },
          Array.from(state.scenario.actions.values()),
        );
        set({
          mainView: after,
        });
        if (options?.recordHistory !== false) {
          recordMainViewChange('Update view layout', 'layout', before, after);
        }
      },

      applyMessage: (message: SimulatorToRendererMessage) => {
        try {
          session.handleIncoming(message);
        } catch (error) {
          const toast = getToastState();
          toast.error('Scenario apply failed', error instanceof Error ? error.message : String(error));
        }
      },

      dump: () => scenario.dump(),

      load: (snapshot) => {
        scenario.load(snapshot);
        resetTimeCorrection(timeCorrection);
        set((state) => ({
          _revision: state._revision + 1,
          currentTime: getCurrentTime(scenario, timeCorrection),
          stateSync: createIdleStateSyncStatus(),
          environmentUpdateTrigger: { ...state.environmentUpdateTrigger, value: state.environmentUpdateTrigger.value + 1 },
          parameterUpdateTrigger: { ...state.parameterUpdateTrigger, value: state.parameterUpdateTrigger.value + 1 },
        }));
      },

      clearAll: () => {
        scenario.reset();
        resetTimeCorrection(timeCorrection);
        set((state) => ({
          connected: false,
          snapshots: [],
          isRecording: false,
          currentTime: null,
          stateSync: createIdleStateSyncStatus(),
          environmentUpdateTrigger: { ...state.environmentUpdateTrigger, value: state.environmentUpdateTrigger.value + 1 },
          parameterUpdateTrigger: { ...state.parameterUpdateTrigger, value: state.parameterUpdateTrigger.value + 1 },
        }));
        historyStore?.getState().clear();
      },
      setData: (payload, options) => {
        mutateSnapshot(scenario, (snapshot) => {
          if (payload.removedActionIds?.length) {
            snapshot.actions = snapshot.actions.filter((action) => !payload.removedActionIds?.includes(action.id));
          }
          if (payload.removedParameterIds?.length) {
            snapshot.parameters = snapshot.parameters.filter((parameter) => !payload.removedParameterIds?.includes(parameter.id));
          }
          if (payload.removedEnvironmentIds?.length) {
            snapshot.environments = snapshot.environments.filter((environment) => !payload.removedEnvironmentIds?.includes(environment.id));
          }
          if (payload.removedChartIds?.length) {
            snapshot.charts = snapshot.charts.filter((chart) => !payload.removedChartIds?.includes(chart.id));
          }

          for (const parameter of payload.parameters ?? []) {
            const index = snapshot.parameters.findIndex((current) => current.id === parameter.id);
            if (index >= 0) snapshot.parameters[index] = structuredClone(parameter);
            else snapshot.parameters.push(structuredClone(parameter));
          }

          for (const environment of payload.environments ?? []) {
            upsertEditableEnvironment(snapshot, environment);
          }

          for (const chart of payload.charts ?? []) {
            const index = snapshot.charts.findIndex((group) => group.id === chart.id);
            const nextChart = {
              id: chart.id,
              label: chart.label,
              metadataDict: Object.fromEntries((chart.dataList ?? []).map((item) => [item.id, item])),
              data: index >= 0 ? snapshot.charts[index].data : [],
            };
            if (index >= 0) snapshot.charts[index] = nextChart;
            else snapshot.charts.push(nextChart);
          }
        });

        if (options?.updateLayout !== false) {
          get().updateMainViewLayout();
        }
      },

      upsertAction: (action) => {
        mutateSnapshot(scenario, (snapshot) => {
          const index = snapshot.actions.findIndex((current) => current.id === action.id);
          if (index >= 0) snapshot.actions[index] = structuredClone(action);
          else snapshot.actions.push(structuredClone(action));
        });
      },

      updateActionProps: (id, props) => {
        const action = scenario.getAction(id);
        if (!action) return false;
        Object.assign(action, structuredClone(props));
        bumpScenarioState();
        return true;
      },

      renameAction: (id, newId) => {
        if (id === newId) return true;
        const actionMap = scenario.actions as Map<string, Action>;
        const action = actionMap.get(id);
        if (!action || actionMap.has(newId)) return false;
        actionMap.delete(id);
        action.id = newId;
        actionMap.set(newId, action);
        bumpScenarioState();
        return true;
      },

      updateParameterProps: (id, props) => {
        const parameter = scenario.getParameter(id);
        if (!parameter) return false;
        Object.assign(parameter, structuredClone(props));
        sanitizeParameter(parameter, true);
        bumpScenarioState({ parameterChanged: true });
        return true;
      },

      renameParameter: (id, newId) => {
        if (id === newId) return true;
        const parameterMap = scenario.parameters as Map<string, Parameter>;
        const parameter = parameterMap.get(id);
        if (!parameter || parameterMap.has(newId)) return false;
        parameterMap.delete(id);
        parameter.id = newId;
        parameterMap.set(newId, parameter);
        bumpScenarioState({ parameterChanged: true });
        return true;
      },

      updateEnvironment: (id, props) => {
        const environment = scenario.getEnvironment(id);
        if (!environment) return false;

        const entries = Object.entries(props);
        if (entries.length === 0) {
          return true;
        }

        let changed = false;
        if (props.type === '2d' || props.type === 'uniform') {
          if (environment.type !== props.type) {
            environment.type = props.type;
            changed = true;
          }
        }

        const layerDrafts = Array.isArray((props as any).layers) ? (props as any).layers : null;
        if (layerDrafts) {
          for (const layerDraft of layerDrafts) {
            if (!layerDraft || typeof layerDraft.id !== 'string' || !layerDraft.metadata || typeof layerDraft.metadata !== 'object') {
              continue;
            }
            const layer = environment.layers.get(layerDraft.id);
            if (!layer) {
              continue;
            }
            scenario.apply({
              type: 'env_layer_update',
              payload: {
                env_id: id,
                layer_id: layer.id,
                data: structuredClone(layerDraft.metadata),
              },
            });
            changed = true;
          }
        }

        const dimensionKeys = new Set(['width', 'height']);
        const agentMetaKeys = new Set(['coord_offset']);

        for (const layer of environment.layers.values()) {
          const data: Record<string, unknown> = {};

          for (const [key, value] of entries) {
            if (dimensionKeys.has(key)) {
              if (layer.layerType === 'grid' || (typeof layer.metadata?.width === 'number' && typeof layer.metadata?.height === 'number')) {
                data[key] = structuredClone(value);
              }
              continue;
            }

            if (agentMetaKeys.has(key)) {
              if (layer.layerType === 'agent') {
                data[key] = structuredClone(value);
              }
              continue;
            }
          }

          if (Object.keys(data).length === 0) {
            continue;
          }

          scenario.apply({
            type: 'env_layer_update',
            payload: { env_id: id, layer_id: layer.id, data },
          });
          changed = true;
        }

        if (changed) {
          bumpScenarioState({ environmentChanged: true });
        }
        return true;
      },

      renameEnvironment: (id, newId) => {
        if (id === newId) return true;
        const environmentMap = scenario.environments as Map<string, ScenarioEnvironmentState>;
        const environment = environmentMap.get(id);
        if (!environment || environmentMap.has(newId)) return false;
        environmentMap.delete(id);
        environment.id = newId;
        environmentMap.set(newId, environment);
        bumpScenarioState({ environmentChanged: true });
        return true;
      },

      updateChartProps: (id, props) => {
        const chart = scenario.charts.getGroup(id);
        if (!chart) return false;

        const nextLabel = props.label;
        if (typeof nextLabel === 'string') {
          chart.label = nextLabel;
        }

        const nextMetadataDict = props.metadataDict;
        if (nextMetadataDict && typeof nextMetadataDict === 'object') {
          const currentMetaIds = new Set(Object.keys(chart.metadataDict));
          const updatedMetadataDict = structuredClone(nextMetadataDict) as typeof chart.metadataDict;

          for (const metaId of currentMetaIds) {
            if (!(metaId in updatedMetadataDict)) {
              scenario.charts.removeMetaFromGroup(metaId, id);
            }
          }

          for (const [metaId, meta] of Object.entries(updatedMetadataDict)) {
            if (metaId in chart.metadataDict) {
              scenario.charts.updateMeta(metaId, meta);
            } else {
              scenario.charts.addMeta(id, meta);
            }
          }
        }

        bumpScenarioState();
        return true;
      },

      renameChartGroup: (id, newId) => {
        if (id === newId) return true;
        if (!scenario.charts.renameGroup(id, newId, () => { })) return false;
        bumpScenarioState();
        return true;
      },

      createStateSyncMessage: (requestId) => scenario.createStateSyncMessage(requestId),
      createParamChangeMessage: (id, value) => scenario.createParamChangeMessage(id, value),
      createActionStartMessage: (id, continuous, tickId) => scenario.createActionStartMessage(id, continuous, tickId),
      createAssetSyncMessage: () => scenario.createAssetSyncMessage(),
      createScreenshotResponseMessage: (payload: ScreenshotResponsePayload) => scenario.createScreenshotResponseMessage(payload),

      registerScreenshotCapture: (id: string, handler: ScreenshotCaptureHandler) => {
        screenshotCaptures.set(id, handler);
      },

      unregisterScreenshotCapture: (id: string) => {
        screenshotCaptures.delete(id);
      },

      getScreenshotCapture: (id: string) => {
        return screenshotCaptures.get(id);
      },

      addSnapshot: (draft) => {
        const snapshot = createSnapshot(scenario.dump(), draft);
        const before = get().snapshots;
        const after = appendSnapshot(before, snapshot, get().maxSnapshots);
        set({ snapshots: after });
        recordSnapshotChange('Take snapshot', before, after);
      },

      startRecording: (options: RecordingOptions = {}) => {
        session.startRecording({
          maxSteps: options.maxSteps ?? 10_000,
          maxBytes: options.maxBytes ?? 64 * 1024 * 1024,
          ringBuffer: options.ringBuffer ?? true,
          ...options,
        });
        set({ isRecording: true });
      },

      stopRecording: () => {
        session.stopRecording();
      },

      renameSnapshot: (id, label) => {
        const before = get().snapshots;
        const after = before.map((snapshot) => snapshot.metadata.id === id
          ? {
            ...snapshot,
            metadata: {
              ...snapshot.metadata,
              label: label.trim() || undefined,
            },
          }
          : snapshot);
        set({ snapshots: after });
        recordSnapshotChange('Rename snapshot', before, after);
      },

      removeSnapshot: (id) => {
        const before = get().snapshots;
        const after = before.filter((snapshot) => String(snapshot.metadata.id ?? '') !== id);
        set({ snapshots: after });
        recordSnapshotChange('Delete snapshot', before, after);
      },

      clearSnapshots: () => {
        const before = get().snapshots;
        set({ snapshots: [] });
        recordSnapshotChange('Clear snapshots', before, []);
      },

      setMaxSnapshots: (max) => set({ maxSnapshots: max }),

      get environments(): ReadonlyMap<string, ScenarioEnvironmentState> {
        return scenario.environments;
      },

      get parameters(): ReadonlyMap<string, Parameter> {
        return scenario.parameters;
      },

      get actions(): ReadonlyMap<string, Action> {
        return scenario.actions;
      },

      get charts(): ChartStorage {
        return scenario.charts;
      },

      get logs(): readonly NormalizedLogPayload[] {
        return scenario.logs;
      },

      get lastLogs(): NormalizedLogPayload | undefined {
        return scenario.logs[scenario.logs.length - 1];
      },
    };
  });

  const unsubscribeScenario = subscribeSession(
    session,
    scenario,
    timeCorrection,
    ({ changed, environmentChanged, parameterChanged, assetChanged }) => {
      useStore.setState((state) => {
        const next = {
          _revision: changed ? state._revision + 1 : state._revision,
          currentTime: changed ? getCurrentTime(scenario, timeCorrection) : state.currentTime,
          _assetRevision: assetChanged ? state._assetRevision + 1 : state._assetRevision,
          environmentUpdateTrigger: environmentChanged
            ? { ...state.environmentUpdateTrigger, value: state.environmentUpdateTrigger.value + 1 }
            : state.environmentUpdateTrigger,
          parameterUpdateTrigger: parameterChanged
            ? { ...state.parameterUpdateTrigger, value: state.parameterUpdateTrigger.value + 1 }
            : state.parameterUpdateTrigger,
        };
        return next;
      });
    },
  );
  const onRecordingStart: EventListener = () => useStore.setState({ isRecording: true });
  const onRecordingComplete: EventListener = (event) => {
    const snapshot = (event as CustomEvent<{ snapshot: Snapshot }>).detail.snapshot;
    useStore.setState((state) => ({
      isRecording: false,
      snapshots: appendSnapshot(state.snapshots, snapshot, state.maxSnapshots),
    }));
  };
  session.addEventListener('recording:start', onRecordingStart);
  session.addEventListener('recording:complete', onRecordingComplete);
  void unsubscribeScenario;

  return useStore;
};

export const {
  Provider: ScenarioStoreProvider,
  useStore: useScenarioStore,
} = createStoreContext<ScenarioStore>();

export * from './types';
