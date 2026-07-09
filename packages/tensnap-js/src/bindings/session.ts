import type {
  AssetMeta,
  ChartUpdatePayload,
  Parameter,
  RendererToSimulatorMessage,
} from '@tensnap/protocol';
import type { SimulatorSession } from '../runtime';
import { SimulatorSession as BaseSimulatorSession } from '../runtime';
import { ScenarioRegistry } from '../scenario';
import { buildScenarioDefinition, getCurrentConfig } from './definition';
import { projectLayerItems } from './layers';
import type {
  BoundModelDefinition,
  ChartValueInput,
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
  textToBytes,
} from './utils';

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
  };

  const resetSyncedItems = async (): Promise<void> => {
    for (const { envId, layerId, deleteKeys } of syncedItems.values()) {
      const items = [...deleteKeys.values()];
      if (items.length === 0) {
        continue;
      }
      await session.emitter.itemDelete({
        env_id: envId,
        layer_id: layerId,
        items: items as ItemRecord[],
      });
    }
    syncedItems.clear();
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
      operations: chartIds.map((id) => ({ id, operation: 'clear' as const })),
    }),
    clearAllCharts() {
      const chartIds = (currentDefinition.charts ?? []).flatMap((chart) => (
        chart.dataList?.length ? chart.dataList.map((series) => series.id) : [chart.id]
      ));
      if (chartIds.length === 0) {
        return Promise.resolve();
      }
      return session.emitter.chartUpdate({
        operations: chartIds.map((id) => ({ id, operation: 'clear' as const })),
      });
    },
    createItems: (envId, layerId, items) => {
      if (items.length === 0) {
        return Promise.resolve();
      }
      return session.emitter.itemCreate({
        env_id: envId,
        layer_id: layerId,
        items: cloneItems(items),
      });
    },
    updateItems: (envId, layerId, items) => {
      if (items.length === 0) {
        return Promise.resolve();
      }
      return session.emitter.itemUpdate({
        env_id: envId,
        layer_id: layerId,
        items: cloneItems(items),
      });
    },
    deleteItems: (envId, layerId, items) => {
      if (items.length === 0) {
        return Promise.resolve();
      }
      return session.emitter.itemDelete({
        env_id: envId,
        layer_id: layerId,
        items: cloneItems(items),
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
          items: remove as ItemRecord[],
        });
      }
      if (create.length > 0) {
        await session.emitter.itemCreate({
          env_id: envId,
          layer_id: layerId,
          items: create,
        });
      }
      if (update.length > 0) {
        await session.emitter.itemUpdate({
          env_id: envId,
          layer_id: layerId,
          items: update,
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
    finishAction: (payload, shouldContinue = false) => session.emitter.actionEnd({
      id: payload.id,
      tick_id: payload.tick_id,
      continue: !!payload.continuous && shouldContinue,
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
      await session.emitter.assetMeta({
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
    const result = await binding.options.step?.(model, context);
    if (!binding.options.time) {
      fallbackTime += 1;
    }
    rebuildDefinition();
    await pushState(context, 'step', false);
    return Boolean(result ?? true);
  };

  const handleDefaultAction = async (
    payload: { id: string; continuous?: boolean; tick_id?: string },
  ): Promise<boolean | undefined> => {
    if (payload.id === 'start') {
      return runStep();
    }

    if (payload.id === 'step') {
      await runStep();
      return false;
    }

    if (payload.id === 'reset') {
      await resetSyncedItems();
      await context.clearAllCharts();
      fallbackTime = 0;
      if (binding.options.reset) {
        await binding.options.reset(model, context);
      } else {
        await binding.options.init?.(model, context);
      }
      rebuildDefinition();
      await context.replayDefinition();
      await pushState(context, 'reset', true);
      return false;
    }

    return undefined;
  };

  session = new BaseSimulatorSession({
    async onConnect() {
      fallbackTime = 0;
      assetRegistry.clear();
      syncedItems.clear();
      await binding.options.init?.(model, context);
      rebuildDefinition();
      await context.replayDefinition();
      await pushState(context, 'sync', true);
    },
    async onDisconnect() {
      await binding.options.dispose?.(model, context);
      assetRegistry.clear();
      syncedItems.clear();
    },
    async onStateSync(payload) {
      rebuildDefinition();
      syncedItems.clear();
      await session.emitter.stateSyncBegin({ request_id: payload.request_id });
      await context.replayDefinition();
      await pushState(context, 'sync', true);
      await session.emitter.stateSyncEnd({ request_id: payload.request_id });
    },
    async onParamChange(payload) {
      const parameter = parameterMap.get(payload.id);
      if (!parameter) {
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
    async onActionStart(payload) {
      const customAction = actionMap.get(payload.id);
      const result = await handleDefaultAction(payload)
        ?? (customAction
          ? await customAction.run(model, context, payload)
          : undefined)
        ?? false;
      if (customAction?.sync) {
        rebuildDefinition();
        await pushState(context, 'step', false);
      }
      await context.finishAction(payload, result);
    },
    async onAssetSync(payload) {
      await context.syncAssets(payload);
    },
    onRendererMessage(message: RendererToSimulatorMessage) {
      void message;
    },
  });

  return session;
}
