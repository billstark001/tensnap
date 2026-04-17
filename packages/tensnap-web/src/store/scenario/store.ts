import { create } from 'zustand';
import { createStoreContext } from '@/utils/zustand';
import { createDefaultRootLayout, createAutoLayout } from '@/components/view/utils/pack';
import { createUpdateTriggerStoreFunction } from '../update-trigger';
import { getToastState } from '../toast';
import {
  Action,
  ChartStorage,
  GridEnvStorage,
  NormalizedLogPayload,
  Parameter,
  Scenario,
  ScenarioEnvironmentState,
  ScenarioSnapshot,
  SimulatorToRendererMessage,
  ScreenshotResponsePayload,
} from '@tensnap/core';
import { EditableEnvironmentDraft, ScenarioStore, ScreenshotCaptureHandler, SnapshotDraft } from './types';

const mutateSnapshot = (scenario: Scenario, mutate: (snapshot: ScenarioSnapshot) => void) => {
  const snapshot = scenario.dump();
  mutate(snapshot);
  scenario.load(snapshot);
};

const upsertEditableEnvironment = (snapshot: ScenarioSnapshot, draft: EditableEnvironmentDraft) => {
  const nextId = draft.id;
  const nextType = draft.type === 'grid' ? '2d' : 'uniform';
  const existing = snapshot.environments.find((env) => env.id === nextId);
  if (existing) {
    existing.type = nextType;
    const gridLayer = existing.layers.find((layer) => layer.layerType === 'grid');
    if (gridLayer && draft.type === 'grid') {
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
    type: nextType,
    layers: draft.type === 'grid'
      ? [{
        id: `${nextId}-grid`,
        layerType: 'grid',
        metadata: { width: draft.width ?? 10, height: draft.height ?? 10 },
        storageSnapshot: {},
      }, {
        id: `${nextId}-agents`,
        layerType: 'agent',
        metadata: {},
        storageSnapshot: { agents: [], trajectories: [] },
      }]
      : [{
        id: `${nextId}-agents`,
        layerType: 'agent',
        metadata: {},
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

const subscribeScenario = (
  scenario: Scenario,
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
  const rerenderEnv = () => schedule({ changed: true, environmentChanged: true });
  const rerenderParam = () => schedule({ changed: true, parameterChanged: true });
  const rerenderAsset = () => schedule({ changed: true, assetChanged: true });

  const handlers: Array<[string, EventListener]> = [
    ['metadata:update', rerender],
    ['action:end', rerender],
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
    ['reset', rerender],
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

  const useStore = create<ScenarioStore>((set, get) => {
    return {
      scenario,
      snapshots: [],
      maxSnapshots: 32,
      mainView: createDefaultRootLayout(),
      connected: false,
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
        set((state) => ({ _revision: state._revision + 1, currentTime: scenario.time ?? null }));
      },

      clearAll: () => {
        scenario.reset();
        set({
          connected: false,
          snapshots: [],
          currentTime: null,
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
        mutateSnapshot(scenario, (snapshot) => {
          const action = snapshot.actions.find((current) => current.id === id);
          if (action) Object.assign(action, props);
        });
      },

      renameAction: (id, newId) => {
        mutateSnapshot(scenario, (snapshot) => {
          const action = snapshot.actions.find((current) => current.id === id);
          if (action) action.id = newId;
        });
      },

      updateParameterProps: (id, props) => {
        mutateSnapshot(scenario, (snapshot) => {
          const parameter = snapshot.parameters.find((current) => current.id === id);
          if (parameter) Object.assign(parameter, props);
        });
      },

      renameParameter: (id, newId) => {
        mutateSnapshot(scenario, (snapshot) => {
          const parameter = snapshot.parameters.find((current) => current.id === id);
          if (parameter) parameter.id = newId;
        });
      },

      updateEnvironment: (id, props) => {
        mutateSnapshot(scenario, (snapshot) => {
          const environment = snapshot.environments.find((current) => current.id === id);
          if (!environment) return;

          const entries = Object.entries(props);
          if (entries.length === 0) {
            return;
          }

          const dimensionKeys = new Set(['width', 'height']);
          const agentMetaKeys = new Set(['coord_offset']);
          const gridMetaKeys = new Set(['show_grid', 'background_color']);

          for (const layer of environment.layers) {
            const nextMetadata = { ...(layer.metadata ?? {}) };
            let changed = false;

            for (const [key, value] of entries) {
              if (dimensionKeys.has(key)) {
                if (layer.layerType === 'grid' || (typeof layer.metadata?.width === 'number' && typeof layer.metadata?.height === 'number')) {
                  nextMetadata[key] = value;
                  changed = true;
                }
                continue;
              }

              if (agentMetaKeys.has(key)) {
                if (layer.layerType === 'agent') {
                  nextMetadata[key] = value;
                  changed = true;
                }
                continue;
              }

              if (gridMetaKeys.has(key)) {
                if (layer.layerType === 'grid' || (typeof layer.metadata?.width === 'number' && typeof layer.metadata?.height === 'number')) {
                  nextMetadata[key] = value;
                  changed = true;
                }
                continue;
              }

              nextMetadata[key] = value;
              changed = true;
            }

            if (changed) {
              layer.metadata = nextMetadata;
            }
          }
        });
      },

      renameEnvironment: (id, newId) => {
        mutateSnapshot(scenario, (snapshot) => {
          const environment = snapshot.environments.find((current) => current.id === id);
          if (environment) environment.id = newId;
        });
      },

      updateChartProps: (id, props) => {
        mutateSnapshot(scenario, (snapshot) => {
          const chart = snapshot.charts.find((current) => current.id === id);
          if (chart) Object.assign(chart, props);
        });
      },

      renameChartGroup: (id, newId) => {
        mutateSnapshot(scenario, (snapshot) => {
          const chart = snapshot.charts.find((current) => current.id === id);
          if (chart) chart.id = newId;
        });
      },

      createStateSyncMessage: () => scenario.createStateSyncMessage(),
      createParamChangeMessage: (id, value) => scenario.createParamChangeMessage(id, value),
      createActionStartMessage: (id, continuous) => scenario.createActionStartMessage(id, continuous),
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
    ({ changed, environmentChanged, parameterChanged, assetChanged }) => {
      useStore.setState((state) => {
        const next = {
          _revision: changed ? state._revision + 1 : state._revision,
          currentTime: changed ? (scenario.time ?? null) : state.currentTime,
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
