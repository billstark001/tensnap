import { create } from 'zustand';
import { createStoreContext } from '@/utils/zustand';
import { createDefaultRootLayout, createAutoLayout } from '@/view/utils/pack';
import { AnyView, ContainerView } from '@/types/ui';
import { createUpdateTriggerStoreFunction } from '../update-trigger';
import { getToastState } from '../toast';
import {
  Action,
  ActionEndPayload,
  ChartStorage,
  GridEnvStorage,
  MetadataUpdatePayload,
  NormalizedLogPayload,
  Parameter,
  Scenario,
  ScenarioEnvironmentState,
  ScenarioSnapshot,
  StateSyncBoundaryPayload,
  SimulatorToRendererMessage,
  ScreenshotResponsePayload,
  sanitizeParameter,
} from '@tensnap/core';
import { EditableEnvironmentDraft, ScenarioStore, ScreenshotCaptureHandler, SnapshotDraft, StateSyncStatus } from './types';

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

const subscribeScenario = (
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

  const flush = () => {
    queued = false;
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
      queueMicrotask(flush);
    }
  };

  const rerender = () => schedule({ changed: true });
  const rerenderMetadata: EventListener = (event) => {
    syncTimeCorrectionFromMetadata(
      timeCorrection,
      (event as CustomEvent<MetadataUpdatePayload>).detail,
    );
    schedule({ changed: true });
  };
  const rerenderActionEnd: EventListener = (event) => {
    syncTimeCorrectionFromAction(
      scenario,
      timeCorrection,
      (event as CustomEvent<ActionEndPayload>).detail,
    );
    schedule({ changed: true });
  };
  const rerenderEnv = () => schedule({ changed: true, environmentChanged: true });
  const rerenderParam = () => schedule({ changed: true, parameterChanged: true });
  const rerenderAsset = () => schedule({ changed: true, assetChanged: true });
  const rerenderReset: EventListener = () => {
    resetTimeCorrection(timeCorrection);
    schedule({ changed: true });
  };

  const handlers: Array<[string, EventListener]> = [
    ['metadata:update', rerenderMetadata],
    ['action:end', rerenderActionEnd],
    ['action:create', rerender],
    ['action:update', rerender],
    ['action:delete', rerender],
    ['env:create', rerenderEnv],
    ['env:delete', rerenderEnv],
    ['layer:create', rerenderEnv],
    ['layer:update', rerenderEnv],
    ['layer:delete', rerenderEnv],
    ['param:create', rerenderParam],
    ['param:update', rerenderParam],
    ['param:delete', rerenderParam],
    ['param:sync', rerenderParam],
    ['chart:create', rerender],
    ['chart:update', rerender],
    ['chart:delete', rerender],
    ['asset:meta', rerenderAsset as EventListener],
    ['asset:data', rerenderAsset as EventListener],
    ['asset:delete', rerenderAsset as EventListener],
    ['log', rerender],
    ['reset', rerenderReset],
  ];

  handlers.forEach(([type, handler]) => scenario.addEventListener(type, handler));
  const unsubscribeAssets = scenario.assets.subscribe(() => {
    schedule({ assetChanged: true });
  });

  return () => {
    handlers.forEach(([type, handler]) => scenario.removeEventListener(type, handler));
    unsubscribeAssets();
  };
};

const annotateSnapshot = (snapshot: ScenarioSnapshot, draft?: SnapshotDraft): ScenarioSnapshot => {
  const timestamp = draft?.timestamp ?? Date.now();
  const id = draft?.id ?? `snapshot-${timestamp}`;
  return {
    ...snapshot,
    metadata: {
      ...snapshot.metadata,
      id,
      timestamp,
    },
  };
};

export const createScenarioStore = () => {
  const scenario = new Scenario();
  const screenshotCaptures = new Map<string, ScreenshotCaptureHandler>();
  const timeCorrection: TimeCorrectionState = { minimumRuntimeTime: 0 };

  const useStore = create<ScenarioStore>((set, get) => {
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
      scenario,
      snapshots: [],
      maxSnapshots: 32,
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
          get().updateMainViewLayout();
        }
      },

      resetStateSync: () => set({ stateSync: createIdleStateSyncStatus() }),

      isMainViewAutoLayoutCandidate: () => isMainViewAutoLayoutCandidate(get().mainView),

      setMainView: (view) => {
        if (typeof view === 'function') {
          set((state) => ({ mainView: view(state.mainView) }));
        } else {
          set({ mainView: view });
        }
      },

      updateMainViewLayout: () => {
        const state = get();
        set({
          mainView: createAutoLayout(
            state.mainView,
            Array.from(state.scenario.environments.values()).map(getEnvironmentMetadata),
            Array.from(state.scenario.parameters.values()),
            state.scenario.charts.getGroupList(),
            { disableMissingViews: true },
            Array.from(state.scenario.actions.values()),
          ),
        });
      },

      applyMessage: (message: SimulatorToRendererMessage) => {
        try {
          scenario.apply(message);
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
        }));
      },

      clearAll: () => {
        scenario.reset();
        resetTimeCorrection(timeCorrection);
        set({
          connected: false,
          snapshots: [],
          currentTime: null,
          stateSync: createIdleStateSyncStatus(),
        });
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
        if (!action) return;
        Object.assign(action, structuredClone(props));
        bumpScenarioState();
      },

      renameAction: (id, newId) => {
        if (id === newId) return;
        const actionMap = scenario.actions as Map<string, Action>;
        const action = actionMap.get(id);
        if (!action || actionMap.has(newId)) return;
        actionMap.delete(id);
        action.id = newId;
        actionMap.set(newId, action);
        bumpScenarioState();
      },

      updateParameterProps: (id, props) => {
        const parameter = scenario.getParameter(id);
        if (!parameter) return;
        Object.assign(parameter, structuredClone(props));
        sanitizeParameter(parameter, true);
        bumpScenarioState({ parameterChanged: true });
      },

      renameParameter: (id, newId) => {
        if (id === newId) return;
        const parameterMap = scenario.parameters as Map<string, Parameter>;
        const parameter = parameterMap.get(id);
        if (!parameter || parameterMap.has(newId)) return;
        parameterMap.delete(id);
        parameter.id = newId;
        parameterMap.set(newId, parameter);
        bumpScenarioState({ parameterChanged: true });
      },

      updateEnvironment: (id, props) => {
        const environment = scenario.getEnvironment(id);
        if (!environment) return;

        const entries = Object.entries(props);
        if (entries.length === 0) {
          return;
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
        }
      },

      renameEnvironment: (id, newId) => {
        if (id === newId) return;
        const environmentMap = scenario.environments as Map<string, ScenarioEnvironmentState>;
        const environment = environmentMap.get(id);
        if (!environment || environmentMap.has(newId)) return;
        environmentMap.delete(id);
        environment.id = newId;
        environmentMap.set(newId, environment);
        bumpScenarioState({ environmentChanged: true });
      },

      updateChartProps: (id, props) => {
        const chart = scenario.charts.getGroup(id);
        if (!chart) return;

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
      },

      renameChartGroup: (id, newId) => {
        if (id === newId) return;
        if (!scenario.charts.renameGroup(id, newId, () => { })) return;
        bumpScenarioState();
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
        const snapshot = annotateSnapshot(scenario.dump(), draft);
        set((state) => {
          const snapshots = [...state.snapshots, snapshot];
          if (state.maxSnapshots !== -1 && snapshots.length > state.maxSnapshots) {
            snapshots.splice(0, snapshots.length - state.maxSnapshots);
          }
          return { snapshots };
        });
      },

      removeSnapshot: (id) => set((state) => ({
        snapshots: state.snapshots.filter((snapshot) => String(snapshot.metadata.id ?? '') !== id),
      })),

      clearSnapshots: () => set({ snapshots: [] }),

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

  const unsubscribeScenario = subscribeScenario(
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
  void unsubscribeScenario;

  return useStore;
};

export const {
  Provider: ScenarioStoreProvider,
  useStore: useScenarioStore,
} = createStoreContext<ScenarioStore>();

export * from './types';
