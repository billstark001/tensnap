import type {
  ActionInvokePayload,
  ActionResultPayload,
  AssetMeta,
  ChartUpdatePayload,
  Checkpoint,
  Parameter,
  ProtocolData,
  ProtocolValue,
  RendererToSimulatorMessage,
  SceneCapturePayload,
  SceneRestoreEndPayload,
  SceneRestorePayload,
} from '@tensnap/protocol';
import { decodeBinaryString, decodeMessagePack, encodeMessagePack } from '@tensnap/protocol';
import type { SimulatorSession } from '../runtime';
import { SimulatorSession as BaseSimulatorSession } from '../runtime';
import { ScenarioRegistry, type ScenarioDefinition } from '../scenario';
import { validateActionInvocation } from './actions';
import { buildScenarioDefinition, getCurrentConfig } from './definition';
import { projectLayerItems } from './layers';
import type {
  BoundModelDefinition,
  ChartValueInput,
  CheckpointData,
  ItemDeleteKey,
  ItemKeySelector,
  ItemRecord,
  LayerProjector,
  LayerRuntimeContext,
  ModelSessionContext,
  PublishedAsset,
  SyncRecordsOptions,
  SyncedLayerState,
} from './types';
import {
  cloneItem,
  cloneItems,
  diffItem,
  getLayerKey,
  hashAssetData,
  isChartValueEntry,
  resolveItemKey,
  stableStorageKey,
  textToBytes,
} from './utils';

type ActionExecutionError = NonNullable<ActionResultPayload['error']>;

function parameterDefinitionChanged(previous: Parameter, next: Parameter): boolean {
  const { value: _previousValue, ...previousDefinition } = previous as Parameter & { value: unknown };
  const { value: _nextValue, ...nextDefinition } = next as Parameter & { value: unknown };
  return JSON.stringify(previousDefinition) !== JSON.stringify(nextDefinition);
}

export function createBoundSession<TConfig extends object, TModel>(
  binding: BoundModelDefinition<TConfig, TModel>,
  initialConfig: TConfig,
): SimulatorSession {
  const model = binding.options.create(initialConfig);
  const assetRegistry = new Map<string, PublishedAsset>();
  const syncedItems = new Map<string, SyncedLayerState>();
  const parameterMap = new Map(binding.parameters.map((parameter) => [parameter.id, parameter]));
  const actionMap = new Map(binding.actions.map((action) => [action.metadata.id, action]));
  let currentDefinition = buildScenarioDefinition(binding, model, getCurrentConfig(binding, model, initialConfig));
  let registry = ScenarioRegistry.from(currentDefinition);
  let session!: SimulatorSession;
  let fallbackTime = 0;
  let initialized = false;
  let stateRevision = 0;
  let activeTransaction: 'state_sync' | 'scene_restore' | undefined;
  let actionInFlight = false;
  const restoreResults = new Map<string, SceneRestoreEndPayload>();
  const instanceId = crypto.randomUUID();
  const capabilities = new Set(binding.metadata.capabilities ?? []);
  if (binding.monitors.length > 0) capabilities.add('monitor');
  if (binding.actions.some((action) => action.metadata.scope !== undefined && action.metadata.scope !== 'model')) {
    capabilities.add('action.target');
  }
  if (binding.actions.some((action) => action.metadata.kwargs?.length)) capabilities.add('action.kwargs');
  const hasDeclarativeLayerRestore = binding.environments.some((environment) =>
    environment.layers.some((layer) => layer.restore !== undefined));
  const hasProjectedRestore = binding.options.sceneRestore !== undefined || hasDeclarativeLayerRestore;
  if (hasProjectedRestore) capabilities.add('scene.restore.projected');
  if (binding.options.restoreCheckpoint && binding.options.captureCheckpoint) {
    capabilities.add('scene.restore.checkpoint');
  }

  const isBusy = (): boolean => activeTransaction !== undefined || actionInFlight;

  const reportBusy = async (requestId?: string): Promise<void> => {
    await session.emitter.error({
      code: 'busy',
      message: 'Wait for the active protocol operation to finish.',
      ...(requestId === undefined ? {} : { request_id: requestId }),
    });
  };

  const rebuildDefinition = (): void => {
    currentDefinition = buildScenarioDefinition(binding, model, getCurrentConfig(binding, model, initialConfig));
    registry = ScenarioRegistry.from(currentDefinition);
  };

  const currentTime = (): number => binding.options.time?.(model) ?? fallbackTime;

  const publishAssets = async (ctx: ModelSessionContext<TConfig>): Promise<void> => {
    const config = getCurrentConfig(binding, model, initialConfig);
    for (const asset of binding.assets) {
      const raw = typeof asset.data === 'function' ? await asset.data(model, config) : asset.data;
      await ctx.publishAsset(
        asset.id,
        asset.mime,
        typeof raw === 'string' ? textToBytes(raw) : raw,
        asset.label,
      );
    }
  };

  const pushLayerState = async (
    ctx: ModelSessionContext<TConfig>,
    phase: LayerRuntimeContext['phase'],
    full: boolean,
  ): Promise<void> => {
    for (const environment of binding.environments) {
      for (const layer of environment.layers) {
        if (full || !layer.updates) {
          if (layer.items) {
            const items = layer.items(model, { phase, full });
            const records = projectLayerItems(model, items, layer.project);
            await ctx.syncRecords(environment.id, layer.id, records, { key: layer.key as ItemKeySelector<ItemRecord> });
          }
          continue;
        }

        const updates = layer.updates(model, { phase, full });
        const records = projectLayerItems(
          model,
          updates as readonly (Partial<unknown> & object)[],
          (layer.updateProject ?? layer.project) as LayerProjector<TModel, Partial<unknown> & object> | undefined,
        );
        await ctx.updateItems(environment.id, layer.id, records);
      }
    }
  };

  const pushCharts = async (ctx: ModelSessionContext<TConfig>): Promise<void> => {
    if (binding.charts.length === 0) {
      return;
    }
    const config = getCurrentConfig(binding, model, initialConfig);
    const values = Object.assign(
      {},
      ...binding.charts.map((chart) => chart.values(model, config)),
    ) as Record<string, unknown>;
    await ctx.setChartValues(values, currentTime());
  };

  const pushMonitors = async (ctx: ModelSessionContext<TConfig>): Promise<void> => {
    if (binding.monitors.length === 0) return;
    const config = getCurrentConfig(binding, model, initialConfig);
    for (const monitor of binding.monitors) {
      const metadata = monitor.metadata();
      await ctx.setMonitor(metadata.id, monitor.value(model, config));
    }
  };

  const pushState = async (
    ctx: ModelSessionContext<TConfig>,
    phase: LayerRuntimeContext['phase'],
    full: boolean,
  ): Promise<void> => {
    if (full) {
      await publishAssets(ctx);
    }
    await pushLayerState(ctx, phase, full);
    await ctx.setTime(currentTime());
    await pushCharts(ctx);
    await pushMonitors(ctx);
  };

  /** Reconcile declarations without using create frames as implicit upserts. */
  const reconcileDefinitions = async (previous: ScenarioDefinition, includeCharts = false): Promise<void> => {
    const previousParameters = new Map((previous.parameters ?? []).map((parameter) => [parameter.id, parameter]));
    const nextParameters = new Map((currentDefinition.parameters ?? []).map((parameter) => [parameter.id, parameter]));
    for (const id of previousParameters.keys()) {
      if (!nextParameters.has(id)) await session.emitter.paramDelete({ id });
    }
    for (const [id, parameter] of nextParameters) {
      if (previousParameters.has(id)) await session.emitter.paramUpdate(parameter);
      else await session.emitter.paramCreate(parameter);
    }

    const previousActions = new Map((previous.actions ?? []).map((action) => [action.id, action]));
    const nextActions = new Map((currentDefinition.actions ?? []).map((action) => [action.id, action]));
    for (const id of previousActions.keys()) {
      if (!nextActions.has(id)) await session.emitter.actionDelete({ id });
    }
    for (const [id, action] of nextActions) {
      if (previousActions.has(id)) await session.emitter.actionUpdate(action);
      else await session.emitter.actionCreate(action);
    }

    const previousEnvironments = new Map((previous.environments ?? []).map((environment) => [environment.id, environment]));
    const nextEnvironments = new Map((currentDefinition.environments ?? []).map((environment) => [environment.id, environment]));
    for (const [id, environment] of previousEnvironments) {
      const next = nextEnvironments.get(id);
      if (!next || next.type !== environment.type) await session.emitter.envDelete({ id });
    }
    for (const [id, environment] of nextEnvironments) {
      const prior = previousEnvironments.get(id);
      if (!prior || prior.type !== environment.type) {
        await session.emitter.envCreate({ id, type: environment.type });
        for (const layer of environment.layers ?? []) {
          await session.emitter.envLayerCreate({
            env_id: id,
            layer_id: layer.layerId,
            layer_type: layer.layerType,
            dependency_layer_ids: layer.dependencyLayerIds,
            metadata: layer.metadata as Record<string, ProtocolData> | undefined,
          });
        }
        continue;
      }

      const previousLayers = new Map((prior.layers ?? []).map((layer) => [layer.layerId, layer]));
      const nextLayers = new Map((environment.layers ?? []).map((layer) => [layer.layerId, layer]));
      for (const [layerId, layer] of previousLayers) {
        const next = nextLayers.get(layerId);
        const topologyChanged = next !== undefined && (next.layerType !== layer.layerType
          || JSON.stringify(next.dependencyLayerIds ?? {}) !== JSON.stringify(layer.dependencyLayerIds ?? {}));
        if (!next || topologyChanged) await session.emitter.envLayerDelete({ env_id: id, layer_id: layerId });
      }
      for (const [layerId, layer] of nextLayers) {
        const priorLayer = previousLayers.get(layerId);
        const topologyChanged = priorLayer !== undefined && (priorLayer.layerType !== layer.layerType
          || JSON.stringify(priorLayer.dependencyLayerIds ?? {}) !== JSON.stringify(layer.dependencyLayerIds ?? {}));
        if (!priorLayer || topologyChanged) {
          await session.emitter.envLayerCreate({
            env_id: id,
            layer_id: layerId,
            layer_type: layer.layerType,
            dependency_layer_ids: layer.dependencyLayerIds,
            metadata: layer.metadata as Record<string, ProtocolData> | undefined,
          });
        } else {
          await session.emitter.envLayerUpdate({
            env_id: id,
            layer_id: layerId,
            metadata: (layer.metadata ?? {}) as Record<string, ProtocolData>,
          });
        }
      }
    }

    if (includeCharts) {
      const previousCharts = new Map((previous.charts ?? []).map((chart) => [chart.id, chart]));
      const nextCharts = new Map((currentDefinition.charts ?? []).map((chart) => [chart.id, chart]));
      for (const [id, chart] of previousCharts) {
        const next = nextCharts.get(id);
        if (!next || JSON.stringify(next) !== JSON.stringify(chart)) {
          await session.emitter.chartDelete({ kind: 'group', id });
        }
      }
      for (const [id, chart] of nextCharts) {
        const prior = previousCharts.get(id);
        if (!prior || JSON.stringify(prior) !== JSON.stringify(chart)) {
          await session.emitter.chartCreate(chart);
        }
      }
    }

    const previousMonitors = new Map((previous.monitors ?? []).map((monitor) => [monitor.id, monitor]));
    const nextMonitors = new Map((currentDefinition.monitors ?? []).map((monitor) => [monitor.id, monitor]));
    for (const [id, monitor] of previousMonitors) {
      const next = nextMonitors.get(id);
      if (!next || JSON.stringify(next) !== JSON.stringify(monitor)) {
        await session.emitter.monitorDelete({ id });
      }
    }
    for (const [id, monitor] of nextMonitors) {
      const prior = previousMonitors.get(id);
      if (!prior || JSON.stringify(prior) !== JSON.stringify(monitor)) {
        await session.emitter.monitorCreate(monitor);
      }
    }
  };

  const resetSyncedItems = async (): Promise<void> => {
    for (const [layerKey, { envId, layerId, deleteKeys }] of syncedItems) {
      const layerType = currentDefinition.environments
        ?.find((environment) => environment.id === envId)
        ?.layers?.find((layer) => layer.layerId === layerId)?.layerType;
      // Trajectory items are simulator-owned drawing configs. Resetting their
      // source agents applies on_reset; deleting the configs themselves would
      // also erase preserved renderer-owned history.
      if (layerType === 'trajectory') continue;
      const items = [...deleteKeys.values()];
      if (items.length > 0) {
        await session.emitter.itemDelete({
          env_id: envId,
          layer_id: layerId,
          items: items as Array<string | number> | Array<Record<string, ProtocolData>>,
        });
      }
      syncedItems.delete(layerKey);
    }
  };

  const runSync = async (): Promise<void> => {
    await pushState(context, 'sync', true);
  };

  const context: ModelSessionContext<TConfig> = {
    get session() {
      return session;
    },
    get emitter() {
      return session.emitter;
    },
    get registry() {
      return registry;
    },
    getConfig: () => getCurrentConfig(binding, model, initialConfig),
    replayDefinition: () => registry.replay(session.emitter),
    sync: runSync,
    async refreshParameters(ids) {
      const nextDefinition = buildScenarioDefinition(binding, model, getCurrentConfig(binding, model, initialConfig));
      const currentParameters = new Map(
        (currentDefinition.parameters ?? []).map((parameter) => [parameter.id, parameter]),
      );
      const nextParameters = new Map(
        (nextDefinition.parameters ?? []).map((parameter) => [parameter.id, parameter]),
      );
      const targetIds = ids
        ? new Set(Array.isArray(ids) ? ids : [ids])
        : new Set([...currentParameters.keys(), ...nextParameters.keys()]);

      currentDefinition = {
        ...currentDefinition,
        parameters: nextDefinition.parameters,
      };
      registry = ScenarioRegistry.from(currentDefinition);

      for (const id of targetIds) {
        const next = nextParameters.get(id);
        const previous = currentParameters.get(id);

        if (!next && previous) {
          await session.emitter.paramDelete({ id });
          continue;
        }
        if (!next) {
          continue;
        }
        if (previous) {
          await session.emitter.paramUpdate(next);
          continue;
        }
        await session.emitter.paramCreate(next);
      }
    },
    setTime: (time) => session.emitter.metadataUpdate({ time }),
    metadata: (payload) => session.emitter.metadataUpdate(payload),
    setChartValues(values: Readonly<Record<string, ChartValueInput>>, time?: number) {
      return session.emitter.chartUpdate({
        updates: Object.entries(values).map(([id, entry]) => {
          if (isChartValueEntry(entry)) {
            return {
              id,
              value: entry.value,
              time: entry.time ?? time,
            };
          }
          return { id, value: entry, time };
        }),
      });
    },
    updateCharts: (payload: ChartUpdatePayload) => session.emitter.chartUpdate(payload),
    clearCharts: (...chartIds) => session.emitter.chartUpdate({
      operations: chartIds.map((id) => ({
        id,
        operation: 'clear' as const,
        kind: (currentDefinition.charts ?? []).some((chart) => chart.id === id) ? 'group' as const : 'series' as const,
      })),
    }),
    clearAllCharts() {
      return session.emitter.chartUpdate({
        operations: [{ operation: 'clear', kind: 'all' }],
      });
    },
    setMonitor: (id, value, revision) => session.emitter.monitorUpdate({
      id,
      value,
      ...(revision === undefined ? {} : { revision }),
    }),
    createItems: (envId, layerId, items) => {
      if (items.length === 0) {
        return Promise.resolve();
      }
      return session.emitter.itemCreate({
        env_id: envId,
        layer_id: layerId,
        items: cloneItems(items) as Array<Record<string, ProtocolData>>,
      });
    },
    updateItems: (envId, layerId, items) => {
      if (items.length === 0) {
        return Promise.resolve();
      }
      return session.emitter.itemUpdate({
        env_id: envId,
        layer_id: layerId,
        items: cloneItems(items) as Array<Record<string, ProtocolData>>,
      });
    },
    deleteItems: (envId, layerId, items) => {
      if (items.length === 0) {
        return Promise.resolve();
      }
      return session.emitter.itemDelete({
        env_id: envId,
        layer_id: layerId,
        items: cloneItems(items) as Array<string | number> | Array<Record<string, ProtocolData>>,
      });
    },
    async syncRecords<TItem extends object>(
      envId: string,
      layerId: string,
      items: readonly TItem[],
      options?: SyncRecordsOptions<TItem>,
    ) {
      const layerKey = getLayerKey(envId, layerId);
      const previousState = syncedItems.get(layerKey);
      const previousItems = previousState?.items ?? new Map<string, ItemRecord>();
      const currentItems = new Map<string, ItemRecord>();
      const currentDeleteKeys = new Map<string, ItemDeleteKey>();
      const currentIds = new Set<string>();
      const create: ItemRecord[] = [];
      const update: ItemRecord[] = [];
      let keyFields: readonly string[] = [];

      for (const item of items) {
        const snapshot = cloneItem(item);
        const itemKey = resolveItemKey(item, snapshot, options?.key);
        keyFields = itemKey.keyFields;
        currentIds.add(itemKey.storageKey);
        currentItems.set(itemKey.storageKey, snapshot);
        currentDeleteKeys.set(itemKey.storageKey, itemKey.deleteKey);

        const previous = previousItems.get(itemKey.storageKey);
        if (!previous) {
          create.push(snapshot);
          continue;
        }

        const diff = diffItem(previous, snapshot, itemKey);
        if (diff) {
          update.push(diff);
        }
      }

      const remove = Array.from(previousItems.keys())
        .filter((id) => !currentIds.has(id))
        .map((id) => previousState?.deleteKeys.get(id))
        .filter((id): id is ItemDeleteKey => id !== undefined);

      if (remove.length > 0) {
        await session.emitter.itemDelete({
          env_id: envId,
          layer_id: layerId,
          items: remove as Array<string | number> | Array<Record<string, ProtocolData>>,
        });
      }
      if (create.length > 0) {
        await session.emitter.itemCreate({
          env_id: envId,
          layer_id: layerId,
          items: create as Array<Record<string, ProtocolData>>,
        });
      }
      if (update.length > 0) {
        await session.emitter.itemUpdate({
          env_id: envId,
          layer_id: layerId,
          items: update as Array<Record<string, ProtocolData>>,
        });
      }

      syncedItems.set(layerKey, {
        envId,
        layerId,
        items: currentItems,
        deleteKeys: currentDeleteKeys,
        keyFields,
      });
    },
    syncItems(envId, layerId, items, options) {
      return this.syncRecords(envId, layerId, items, options);
    },
    finishAction: (payload, shouldContinue = false) => session.emitter.actionResult({
      id: payload.id,
      request_id: payload.request_id,
      should_continue: !!payload.continuous && shouldContinue,
    }),
    async publishAsset(id, mime, data, label) {
      const normalizedData = data.slice();
      const hash = await hashAssetData(normalizedData);
      assetRegistry.set(id, {
        hash,
        mime,
        data: normalizedData,
        label,
      });
      await session.emitter.assetMetadata({
        assets: [{ id, hash, mime, size: normalizedData.byteLength, label } satisfies AssetMeta],
      });
      return { id, hash };
    },
    async syncAssets(payload) {
      for (const [id, asset] of assetRegistry) {
        if (payload.assets[id] !== asset.hash) {
          await session.emitter.assetData({
            id,
            hash: asset.hash,
            mime: asset.mime,
            data: asset.data,
          });
        }
      }
    },
    clearPublishedAssets() {
      assetRegistry.clear();
    },
  };

  const runStep = async (): Promise<boolean> => {
    if (!binding.options.step) return false;
    const result = await binding.options.step(model, context);
    if (!binding.options.time) {
      fallbackTime += 1;
    }
    rebuildDefinition();
    await pushState(context, 'step', false);
    return result ?? true;
  };

  const handleDefaultAction = async (
    payload: { id: string; continuous?: boolean; request_id: string },
  ): Promise<boolean | undefined> => {
    if (payload.id === 'start') {
      return runStep();
    }

    if (payload.id === 'step') {
      await runStep();
      return false;
    }

    if (payload.id === 'stop') {
      await binding.options.stop?.(model, context);
      return false;
    }

    if (payload.id === 'reset') {
      const previousDefinition = currentDefinition;
      await resetSyncedItems();
      await context.clearAllCharts();
      fallbackTime = 0;
      if (binding.options.reset) {
        await binding.options.reset(model, context);
      }
      rebuildDefinition();
      await reconcileDefinitions(previousDefinition, true);
      await pushState(context, 'reset', true);
      return false;
    }

    return undefined;
  };

  const invalidTarget = (payload: ActionInvokePayload): ActionExecutionError | undefined => {
    const target = payload.target;
    if (target === undefined) return undefined;
    const environment = binding.environments.find((entry) => entry.id === target.env_id);
    if (!environment) return { code: 'invalid_target', message: `Unknown environment: ${target.env_id}.` };
    if (target.type === 'env') return undefined;

    const layer = environment.layers.find((entry) => entry.id === target.layer_id);
    if (!layer) return { code: 'invalid_target', message: `Unknown layer: ${target.layer_id}.` };
    if (target.type === 'layer') return undefined;
    if (layer.type !== 'agent' || !layer.items) {
      return { code: 'invalid_target', message: `Layer ${target.layer_id} cannot resolve agent targets.` };
    }
    const records = projectLayerItems(model, layer.items(model, { phase: 'step', full: false }), layer.project);
    if (!records.some((record) => Object.is(record.id, target.agent_id))) {
      return { code: 'invalid_target', message: `Unknown agent: ${String(target.agent_id)}.` };
    }
    return undefined;
  };

  const rejectRestore = async (payload: SceneRestorePayload, code: string, message: string): Promise<void> => {
    const result: SceneRestoreEndPayload = {
      request_id: payload.request_id,
      status: 'rejected',
      error: { code, message },
    };
    restoreResults.set(payload.request_id, result);
    await session.emitter.sceneRestoreBegin({ request_id: payload.request_id });
    await session.emitter.sceneRestoreEnd(result);
  };

  type LayerRestorePlan = {
    environmentId: string;
    layerId: string;
    dependencies: Record<string, string>;
    inbound: NonNullable<SceneRestorePayload['envs']>[number]['layers'][number];
    restore: NonNullable<typeof binding.environments[number]['layers'][number]['restore']>;
    itemCud: boolean;
    current: Map<string, ItemDeleteKey>;
    incoming: Map<string, { item: Record<string, ProtocolValue>; key: ItemDeleteKey }>;
  };

  type ProjectedRestorePlan = { layers: LayerRestorePlan[] };

  const validationError = (error: unknown): ActionExecutionError => ({
    code: 'invalid_scene_restore',
    message: error instanceof Error ? error.message : String(error),
  });

  const validateRestoredParameter = (parameter: Parameter, value: ProtocolValue): string | undefined => {
    switch (parameter.type) {
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) return `Parameter ${parameter.id} requires a finite number.`;
        if (parameter.min !== undefined && value < parameter.min) return `Parameter ${parameter.id} is below its minimum.`;
        if (parameter.max !== undefined && value > parameter.max) return `Parameter ${parameter.id} is above its maximum.`;
        return undefined;
      case 'boolean':
        return typeof value === 'boolean' ? undefined : `Parameter ${parameter.id} requires a boolean.`;
      case 'string':
        return typeof value === 'string' ? undefined : `Parameter ${parameter.id} requires a string.`;
      case 'enum':
        return typeof value === 'string' && parameter.options.includes(value)
          ? undefined
          : `Parameter ${parameter.id} must be one of its declared options.`;
    }
  };

  const orderedLayerPlans = (plans: readonly LayerRestorePlan[]): LayerRestorePlan[] => {
    const output: LayerRestorePlan[] = [];
    const byEnvironment = new Map<string, LayerRestorePlan[]>();
    for (const plan of plans) {
      const group = byEnvironment.get(plan.environmentId) ?? [];
      group.push(plan);
      byEnvironment.set(plan.environmentId, group);
    }
    for (const group of byEnvironment.values()) {
      const byLayer = new Map(group.map((plan) => [plan.layerId, plan]));
      const visited = new Set<string>();
      const visit = (plan: LayerRestorePlan): void => {
        if (visited.has(plan.layerId)) return;
        visited.add(plan.layerId);
        for (const dependencyId of Object.values(plan.dependencies)) {
          const dependency = byLayer.get(dependencyId);
          if (dependency) visit(dependency);
        }
        output.push(plan);
      };
      for (const plan of group) visit(plan);
    }
    return output;
  };

  const validateProjectedRestore = async (
    payload: SceneRestorePayload,
  ): Promise<{ error?: ActionExecutionError; plan?: ProjectedRestorePlan }> => {
    const permitsTopologyChanges = capabilities.has('scene.restore.topology');
    const seenEnvironmentIds = new Set<string>();
    const plans: LayerRestorePlan[] = [];
    for (const environment of payload.envs ?? []) {
      if (seenEnvironmentIds.has(environment.id)) {
        return { error: { code: 'invalid_scene_restore', message: `Duplicate environment: ${environment.id}.` } };
      }
      seenEnvironmentIds.add(environment.id);

      const declaredEnvironment = binding.environments.find((entry) => entry.id === environment.id);
      if (!permitsTopologyChanges && (!declaredEnvironment || declaredEnvironment.type !== environment.type)) {
        return { error: { code: 'invalid_scene_restore', message: `Environment ${environment.id} does not match the declared topology.` } };
      }
      if (!permitsTopologyChanges && declaredEnvironment && declaredEnvironment.layers.length !== environment.layers.length) {
        return { error: { code: 'invalid_scene_restore', message: `Environment ${environment.id} has a different layer topology.` } };
      }

      const seenLayerIds = new Set<string>();
      for (const layer of environment.layers) {
        if (seenLayerIds.has(layer.layer_id)) {
          return { error: { code: 'invalid_scene_restore', message: `Duplicate layer: ${environment.id}/${layer.layer_id}.` } };
        }
        seenLayerIds.add(layer.layer_id);

        const declaredLayer = declaredEnvironment?.layers.find((entry) => entry.id === layer.layer_id);
        if (!permitsTopologyChanges && (!declaredLayer
          || declaredLayer.type !== layer.layer_type
          || JSON.stringify(declaredLayer.dependencyLayerIds ?? {}) !== JSON.stringify(layer.dependency_layer_ids ?? {}))) {
          return { error: { code: 'invalid_scene_restore', message: `Layer ${environment.id}/${layer.layer_id} does not match the declared topology.` } };
        }

        const incoming = new Map<string, { item: Record<string, ProtocolValue>; key: ItemDeleteKey }>();
        for (const item of layer.items ?? []) {
          try {
            const key = resolveItemKey(
              item as Record<string, ProtocolValue>,
              item as Record<string, ProtocolValue>,
              declaredLayer?.key as ItemKeySelector<Record<string, ProtocolValue>> | undefined,
            );
            if (incoming.has(key.storageKey)) {
              return { error: { code: 'invalid_scene_restore', message: `Duplicate item key in ${environment.id}/${layer.layer_id}.` } };
            }
            incoming.set(key.storageKey, {
              item: item as Record<string, ProtocolValue>,
              key: key.deleteKey,
            });
          } catch (error) {
            return { error: validationError(error) };
          }
        }

        if (binding.options.sceneRestore?.mode === 'imperative') {
          continue;
        }
        if (!declaredLayer?.restore) {
          return {
            error: {
              code: 'invalid_scene_restore',
              message: `Layer ${environment.id}/${layer.layer_id} has no declarative restore handler.`,
            },
          };
        }
        const itemCud = declaredLayer.items !== undefined || layer.items !== undefined;
        if (itemCud && (!declaredLayer.restore.create || !declaredLayer.restore.update || !declaredLayer.restore.delete)) {
          return {
            error: {
              code: 'invalid_scene_restore',
              message: `Layer ${environment.id}/${layer.layer_id} must provide create, update, and delete restore handlers.`,
            },
          };
        }
        if (layer.metadata !== undefined && !declaredLayer.restore.restoreMetadata) {
          return {
            error: {
              code: 'invalid_scene_restore',
              message: `Layer ${environment.id}/${layer.layer_id} does not restore metadata.`,
            },
          };
        }

        const current = new Map<string, ItemDeleteKey>();
        try {
          if (!itemCud) {
            // Metadata-only layers have no item ownership to reconcile.
          } else if (declaredLayer.restore.itemIds) {
            for (const itemKey of declaredLayer.restore.itemIds(model)) {
              const storageKey = stableStorageKey(itemKey);
              if (current.has(storageKey)) throw new Error(`Duplicate current item key in ${environment.id}/${layer.layer_id}.`);
              current.set(storageKey, itemKey);
            }
          } else if (declaredLayer.items) {
            const sourceItems = declaredLayer.items(model, { phase: 'sync', full: true });
            const records = projectLayerItems(model, sourceItems, declaredLayer.project);
            sourceItems.forEach((sourceItem, index) => {
              const itemKey = resolveItemKey(sourceItem, records[index]!, declaredLayer.key);
              if (current.has(itemKey.storageKey)) throw new Error(`Duplicate current item key in ${environment.id}/${layer.layer_id}.`);
              current.set(itemKey.storageKey, itemKey.deleteKey);
            });
          } else {
            throw new Error(`Layer ${environment.id}/${layer.layer_id} must provide restore.itemIds or items for declarative restore.`);
          }
          await declaredLayer.restore.validate?.(model, layer);
        } catch (error) {
          return { error: validationError(error) };
        }
        plans.push({
          environmentId: environment.id,
          layerId: layer.layer_id,
          dependencies: declaredLayer.dependencyLayerIds ?? {},
          inbound: layer,
          restore: declaredLayer.restore,
          itemCud,
          current,
          incoming,
        });
      }
    }

    const parameterIds = new Set<string>();
    for (const change of payload.parameters ?? []) {
      if (parameterIds.has(change.id)) {
        return { error: { code: 'invalid_scene_restore', message: `Duplicate parameter: ${change.id}.` } };
      }
      parameterIds.add(change.id);
      const parameter = parameterMap.get(change.id);
      if (!parameter) {
        return { error: { code: 'invalid_scene_restore', message: `Unknown parameter: ${change.id}.` } };
      }
      const validation = validateRestoredParameter(parameter.metadata(model, getCurrentConfig(binding, model, initialConfig)), change.value);
      if (validation) {
        return { error: { code: 'invalid_scene_restore', message: validation } };
      }
    }

    const sceneRestore = binding.options.sceneRestore;
    if (payload.time !== undefined && binding.options.time
      && sceneRestore?.mode !== 'imperative'
      && (sceneRestore?.mode !== 'compose' || !sceneRestore.restoreTime)) {
      return { error: { code: 'invalid_scene_restore', message: 'sceneRestore.restoreTime is required when the model owns time.' } };
    }
    try {
      await sceneRestore?.validate?.(model, payload, context);
    } catch (error) {
      return { error: validationError(error) };
    }
    return { plan: { layers: plans } };
  };

  const applyProjectedRestore = async (payload: SceneRestorePayload, plan: ProjectedRestorePlan): Promise<void> => {
    const sceneRestore = binding.options.sceneRestore;
    if (sceneRestore?.mode === 'imperative') {
      await sceneRestore.apply(model, payload, context);
      return;
    }

    await sceneRestore?.beforeApply?.(model, payload, context);
    for (const change of payload.parameters ?? []) {
      const parameter = parameterMap.get(change.id)!;
      const result = await parameter.apply(model, change, context, getCurrentConfig(binding, model, initialConfig));
      if (!result.accepted) throw new Error(`Parameter ${change.id} rejected restored value.`);
    }

    const ordered = orderedLayerPlans(plan.layers);
    for (const entry of ordered) {
      if (entry.inbound.metadata !== undefined) {
        await entry.restore.restoreMetadata!(model, entry.inbound.metadata);
      }
    }
    for (const entry of [...ordered].reverse()) {
      if (!entry.itemCud) continue;
      for (const [storageKey, key] of entry.current) {
        if (!entry.incoming.has(storageKey)) await entry.restore.delete!(model, key);
      }
    }
    for (const entry of ordered) {
      if (!entry.itemCud) continue;
      for (const [storageKey, { item, key }] of entry.incoming) {
        if (!entry.current.has(storageKey)) await entry.restore.create!(model, item, key);
      }
      for (const [storageKey, { item, key }] of entry.incoming) {
        if (entry.current.has(storageKey)) await entry.restore.update!(model, key, item);
      }
    }
    if (payload.time !== undefined) {
      if (sceneRestore?.mode === 'compose' && sceneRestore.restoreTime) {
        await sceneRestore.restoreTime(model, payload.time, context);
      } else {
        fallbackTime = payload.time;
      }
    }
    await sceneRestore?.afterApply?.(model, payload, context);
  };

  const encodeCheckpoint = (data: CheckpointData): Checkpoint => {
    if (data instanceof Uint8Array) {
      return { encoding: 'application/octet-stream', data: data.slice() };
    }
    return { encoding: 'application/msgpack', data: Uint8Array.from(encodeMessagePack(data)) };
  };

  const decodeCheckpoint = (checkpoint: Checkpoint): CheckpointData => {
    const bytes = checkpoint.data instanceof Uint8Array
      ? checkpoint.data
      : decodeBinaryString(checkpoint.data).bytes;
    if (checkpoint.encoding === 'application/octet-stream') return bytes;
    if (checkpoint.encoding === 'application/msgpack') return decodeMessagePack<ProtocolValue>(bytes);
    throw new Error(`Unsupported checkpoint encoding: ${checkpoint.encoding}.`);
  };

  session = new BaseSimulatorSession({
    simulatorInfo: {
      protocol_version: '0.3',
      binding: { name: 'tensnap-js', version: '0.3.0', language: 'JavaScript' },
      model: {
        id: binding.metadata.id,
        name: binding.metadata.name,
        description: binding.metadata.description,
        version: binding.metadata.version,
        state_schema_version: binding.metadata.stateSchemaVersion,
      },
      instance_id: instanceId,
      capabilities: [...capabilities],
      capability_details: binding.metadata.capabilityDetails,
    },
    async onDisconnect() {
      // Reconnect keeps one authoritative instance. Dispose is reserved for
      // host shutdown rather than a transient transport close.
    },
    async onStateSync(payload) {
      if (payload.model_id !== binding.metadata.id) {
        await session.emitter.error({
          code: 'model_mismatch',
          message: `Expected model ${binding.metadata.id}.`,
          request_id: payload.request_id,
        });
        return;
      }
      if (isBusy()) {
        await reportBusy(payload.request_id);
        return;
      }
      activeTransaction = 'state_sync';
      try {
        if (!initialized) {
          fallbackTime = 0;
          assetRegistry.clear();
          syncedItems.clear();
          await binding.options.init?.(model, context);
          rebuildDefinition();
          initialized = true;
        }
        rebuildDefinition();
        syncedItems.clear();
        await session.emitter.stateSyncBegin({
          request_id: payload.request_id,
          model_id: binding.metadata.id,
          instance_id: instanceId,
          mode: 'replace',
        });
        await context.replayDefinition();
        await pushState(context, 'sync', true);
        await session.emitter.stateSyncEnd({ request_id: payload.request_id, state_revision: String(++stateRevision) });
      } finally {
        activeTransaction = undefined;
      }
    },
    async onParamChange(payload) {
      if (isBusy()) {
        await reportBusy();
        return;
      }
      const parameter = parameterMap.get(payload.id);
      if (!parameter) {
        await session.emitter.error({ code: 'unknown_parameter', message: `Unknown parameter: ${payload.id}.` });
        return;
      }
      const previousConfig = getCurrentConfig(binding, model, initialConfig);
      const previous = parameter.metadata(model, previousConfig);
      const result = await parameter.apply(
        model,
        payload,
        context,
        previousConfig,
      );
      const nextConfig = getCurrentConfig(binding, model, initialConfig);
      const next = parameter.metadata(model, nextConfig);
      rebuildDefinition();

      if (!result.accepted || !Object.is(next.value, payload.value)) {
        await session.emitter.paramSync({ id: payload.id, value: next.value });
      }
      if (parameterDefinitionChanged(previous, next)) {
        await session.emitter.paramUpdate(next);
      }
    },
    async onActionInvoke(payload) {
      const action = currentDefinition.actions?.find((entry) => entry.id === payload.id);
      if (!action) {
        await session.emitter.actionResult({
          id: payload.id,
          request_id: payload.request_id,
          error: { code: 'unknown_action', message: `Unknown action: ${payload.id}` },
        });
        return;
      }
      if (isBusy()) {
        await session.emitter.actionResult({
          id: payload.id,
          request_id: payload.request_id,
          error: { code: 'busy', message: 'Wait for the active protocol operation to finish.' },
        });
        return;
      }
      const validation = validateActionInvocation(action, payload);
      if (validation.error) {
        await session.emitter.actionResult({ id: payload.id, request_id: payload.request_id, error: validation.error });
        return;
      }
      const resolvedPayload = validation.payload!;
      const targetError = invalidTarget(resolvedPayload);
      if (targetError) {
        await session.emitter.actionResult({ id: payload.id, request_id: payload.request_id, error: targetError });
        return;
      }
      const customAction = actionMap.get(resolvedPayload.id);
      actionInFlight = true;
      try {
        const defaultResult = await handleDefaultAction(resolvedPayload);
        const result = defaultResult ?? await customAction!.run(model, context, resolvedPayload) ?? false;
        if (customAction?.sync) {
          rebuildDefinition();
          await pushState(context, 'step', false);
        }
        await context.finishAction(resolvedPayload, result);
      } catch (error) {
        await session.emitter.actionResult({
          id: payload.id,
          request_id: payload.request_id,
          error: { code: 'action_failed', message: error instanceof Error ? error.message : String(error) },
        });
      } finally {
        actionInFlight = false;
      }
    },
    async onAssetSync(payload) {
      await context.syncAssets(payload);
    },
    async onSceneRestore(payload) {
      const cached = restoreResults.get(payload.request_id);
      if (cached) {
        await session.emitter.sceneRestoreBegin({ request_id: payload.request_id });
        await session.emitter.sceneRestoreEnd(structuredClone(cached));
        return;
      }
      if (payload.model_id !== binding.metadata.id) {
        await rejectRestore(payload, 'model_mismatch', `Expected model ${binding.metadata.id}.`);
        return;
      }
      if (payload.expected_instance_id !== undefined && payload.expected_instance_id !== instanceId) {
        await rejectRestore(payload, 'instance_mismatch', 'scene_restore expected_instance_id does not match this binding instance.');
        return;
      }
      if (payload.state_schema_version !== undefined && payload.state_schema_version !== binding.metadata.stateSchemaVersion) {
        await rejectRestore(payload, 'state_schema_mismatch', 'scene_restore state schema version does not match this model.');
        return;
      }
      if (isBusy()) {
        await rejectRestore(payload, 'busy', 'Wait for the active protocol operation to finish.');
        return;
      }
      const hasProjectedState = payload.time !== undefined || payload.parameters !== undefined || payload.envs !== undefined;
      if (hasProjectedState && !capabilities.has('scene.restore.projected')) {
        await rejectRestore(payload, 'unsupported_capability', 'This binding does not provide projected scene restore.');
        return;
      }
      if (payload.checkpoint !== undefined && !capabilities.has('scene.restore.checkpoint')) {
        await rejectRestore(payload, 'unsupported_capability', 'This binding does not provide checkpoint scene restore.');
        return;
      }
      if (!hasProjectedState && payload.checkpoint === undefined) {
        await rejectRestore(payload, 'invalid_scene_restore', 'scene_restore contains no restorable state.');
        return;
      }
      const validation = hasProjectedState
        ? await validateProjectedRestore(payload)
        : { plan: { layers: [] } };
      if (validation.error) {
        await rejectRestore(payload, validation.error.code, validation.error.message);
        return;
      }

      activeTransaction = 'scene_restore';
      try {
        const previousFallbackTime = fallbackTime;
        let rollbackData: CheckpointData | undefined;
        let preparationError: unknown;
        if (binding.options.captureCheckpoint && binding.options.restoreCheckpoint) {
          try {
            rollbackData = await binding.options.captureCheckpoint(model, context);
          } catch (error) {
            preparationError = error;
          }
        }
        await session.emitter.sceneRestoreBegin({ request_id: payload.request_id });
        if (preparationError !== undefined) {
          const result: SceneRestoreEndPayload = {
            request_id: payload.request_id,
            status: 'failed',
            error: {
              code: 'scene_restore_failed',
              message: `capture rollback checkpoint: ${preparationError instanceof Error ? preparationError.message : String(preparationError)}`,
            },
          };
          restoreResults.set(payload.request_id, result);
          await session.emitter.sceneRestoreEnd(result);
          return;
        }
        try {
          const previousDefinition = currentDefinition;
          if (payload.checkpoint !== undefined) {
            await binding.options.restoreCheckpoint!(model, decodeCheckpoint(payload.checkpoint), context);
          }
          if (hasProjectedState) await applyProjectedRestore(payload, validation.plan!);
          rebuildDefinition();
          await reconcileDefinitions(previousDefinition);
          await resetSyncedItems();
          await pushLayerState(context, 'sync', true);
          await context.setTime(currentTime());
          await pushMonitors(context);
          const result: SceneRestoreEndPayload = { request_id: payload.request_id, status: 'ok' };
          restoreResults.set(payload.request_id, result);
          await session.emitter.sceneRestoreEnd(result);
        } catch (error) {
          fallbackTime = previousFallbackTime;
          let message = error instanceof Error ? error.message : String(error);
          if (rollbackData !== undefined && binding.options.restoreCheckpoint) {
            try {
              await binding.options.restoreCheckpoint(model, rollbackData, context);
              rebuildDefinition();
            } catch (rollbackError) {
              message += `; rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`;
            }
          }
          const result: SceneRestoreEndPayload = {
            request_id: payload.request_id,
            status: 'failed',
            error: { code: 'scene_restore_failed', message },
          };
          restoreResults.set(payload.request_id, result);
          await session.emitter.sceneRestoreEnd(result);
        }
      } finally {
        activeTransaction = undefined;
      }
    },
    async onSceneCapture(payload: SceneCapturePayload) {
      if (!capabilities.has('scene.restore.checkpoint')) {
        await session.emitter.error({
          code: 'unsupported_capability',
          message: 'This binding does not provide checkpoint capture.',
          request_id: payload.request_id,
        });
        return;
      }
      if (isBusy()) {
        await reportBusy(payload.request_id);
        return;
      }
      try {
        const checkpoint = encodeCheckpoint(await binding.options.captureCheckpoint!(model, context));
        await session.emitter.sceneCaptureResult({
          request_id: payload.request_id,
          model_id: binding.metadata.id,
          state_schema_version: binding.metadata.stateSchemaVersion,
          checkpoint,
        });
      } catch (error) {
        await session.emitter.error({
          code: 'scene_capture_failed',
          message: error instanceof Error ? error.message : String(error),
          request_id: payload.request_id,
        });
      }
    },
    onRendererMessage(message: RendererToSimulatorMessage) {
      void message;
    },
  });

  return session;
}
