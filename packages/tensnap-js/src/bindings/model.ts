import type {
  Action,
  ActionStartPayload,
  AssetMeta,
  AssetSyncPayload,
  ChartGroupMetadata,
  ChartUpdatePayload,
  MetadataUpdatePayload,
  Parameter,
  ParameterChangePayload,
} from '@tensnap/protocol';
import type { SimulatorEmitter, SimulatorSession } from '../runtime';
import { SimulatorSession as BaseSimulatorSession } from '../runtime';
import {
  ScenarioRegistry,
  type ScenarioDefinition,
  type ScenarioEnvironmentDefinition,
} from '../scenario';
import { defineActions, defineScenario } from './define';

type MaybeFactory<TConfig, TValue> =
  | TValue
  | ((config: TConfig) => TValue);

type ItemRecord = Record<string, unknown>;
type ItemIdentifier = string | number;
type ChartValueInput = number | { value: number; time?: number };

interface PublishedAsset {
  hash: string;
  mime: string;
  data: Uint8Array;
  label?: string;
}

interface SyncedLayerState {
  envId: string;
  layerId: string;
  items: Map<ItemIdentifier, ItemRecord>;
}

export interface LifecycleActionLabels {
  start?: string;
  step?: string;
  reset?: string;
}

export interface ModelSessionContext<TConfig extends object> {
  readonly session: SimulatorSession;
  readonly emitter: SimulatorEmitter;
  readonly registry: ScenarioRegistry;
  getConfig(): TConfig;
  replayDefinition(): Promise<void>;
  sync(): Promise<void>;
  /**
   * Re-emit parameter definitions after the simulator normalizes or rejects a
   * renderer-proposed value, or when the parameter schema itself changes.
   * Accepted values should usually stay renderer-local until the next full sync.
   */
  refreshParameters(ids?: string | readonly string[]): Promise<void>;
  setTime(time: number): Promise<void>;
  metadata(payload: MetadataUpdatePayload): Promise<void>;
  setChartValues(
    values: Readonly<Record<string, ChartValueInput>>,
    time?: number,
  ): Promise<void>;
  updateCharts(payload: ChartUpdatePayload): Promise<void>;
  clearCharts(...chartIds: string[]): Promise<void>;
  clearAllCharts(): Promise<void>;
  createItems<TItem extends object>(
    envId: string,
    layerId: string,
    items: readonly TItem[],
  ): Promise<void>;
  updateItems<TItem extends object>(
    envId: string,
    layerId: string,
    items: readonly TItem[],
  ): Promise<void>;
  deleteItems<TItem extends object>(
    envId: string,
    layerId: string,
    items: readonly TItem[],
  ): Promise<void>;
  syncItems<TItem extends { id: ItemIdentifier }>(
    envId: string,
    layerId: string,
    items: readonly TItem[],
  ): Promise<void>;
  finishAction(
    payload: Pick<ActionStartPayload, 'id' | 'continuous' | 'tick_id'>,
    shouldContinue?: boolean,
  ): Promise<void>;
  publishAsset(
    id: string,
    mime: string,
    data: Uint8Array,
    label?: string,
  ): Promise<{ id: string; hash: string }>;
  syncAssets(payload: AssetSyncPayload): Promise<void>;
  clearPublishedAssets(): void;
}

export interface DefineModelOptions<
  TConfig extends object,
  TModel,
> {
  defaults?: TConfig;
  parameters?: MaybeFactory<TConfig, readonly Parameter[]>;
  actions?: MaybeFactory<TConfig, readonly Action[]>;
  environments?: MaybeFactory<TConfig, readonly ScenarioEnvironmentDefinition[]>;
  charts?: MaybeFactory<TConfig, readonly ChartGroupMetadata[]>;
  create(config: TConfig): TModel;
  getConfig?(model: TModel, initialConfig: TConfig): Partial<TConfig> | TConfig;
  init?(model: TModel, ctx: ModelSessionContext<TConfig>): void | Promise<void>;
  dispose?(model: TModel, ctx: ModelSessionContext<TConfig>): void | Promise<void>;
  sync?(model: TModel, ctx: ModelSessionContext<TConfig>): void | Promise<void>;
  step?(model: TModel, ctx: ModelSessionContext<TConfig>): boolean | void | Promise<boolean | void>;
  reset?(model: TModel, ctx: ModelSessionContext<TConfig>): void | Promise<void>;
  onParameterChange?(
    model: TModel,
    payload: ParameterChangePayload,
    ctx: ModelSessionContext<TConfig>,
  ): void | Promise<void>;
  onAction?(
    model: TModel,
    payload: ActionStartPayload,
    ctx: ModelSessionContext<TConfig>,
  ): boolean | void | Promise<boolean | void>;
  onAssetSync?(
    model: TModel,
    payload: AssetSyncPayload,
    ctx: ModelSessionContext<TConfig>,
  ): void | Promise<void>;
}

export interface DeclarativeModelBinding<TConfig extends object> {
  createScenario(config?: Partial<TConfig>): ScenarioDefinition;
  createSession(config?: Partial<TConfig>): SimulatorSession;
}

export type DeclarativeExampleBinding<
  TConfig extends object,
  TMetadata extends object,
> = TMetadata & DeclarativeModelBinding<TConfig>;

function resolveSection<TConfig extends object, TValue>(
  section: MaybeFactory<TConfig, TValue> | undefined,
  config: TConfig,
): TValue | undefined {
  if (typeof section === 'function') {
    return (section as (config: TConfig) => TValue)(config);
  }
  return section;
}

function cloneItems<TItem extends object>(items: readonly TItem[]): ItemRecord[] {
  return items as unknown as ItemRecord[];
}

function cloneItem<TItem extends object>(item: TItem): ItemRecord {
  return { ...(item as unknown as ItemRecord) };
}

function diffItem(
  previous: ItemRecord,
  current: ItemRecord,
  id: ItemIdentifier,
): ItemRecord | undefined {
  const diff: ItemRecord = {};
  let changed = false;
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);

  for (const key of keys) {
    if (key === 'id') {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(current, key)) {
      diff[key] = null;
      changed = true;
      continue;
    }
    if (!Object.is(previous[key], current[key])) {
      diff[key] = current[key];
      changed = true;
    }
  }

  if (!changed) {
    return undefined;
  }
  diff.id = id;
  return diff;
}

function getLayerKey(envId: string, layerId: string): string {
  return `${envId}:${layerId}`;
}

async function hashAssetData(data: Uint8Array): Promise<string> {
  const buffer = await globalThis.crypto.subtle.digest('SHA-256', data.slice());
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function defineLifecycleActions(
  labels: LifecycleActionLabels = {},
): readonly Action[] {
  return defineActions(
    {
      id: 'start',
      label: labels.start ?? 'Start',
      allowRuntimeChange: true,
      continuous: true,
    },
    {
      id: 'step',
      label: labels.step ?? 'Step',
      allowRuntimeChange: true,
      continuous: false,
    },
    {
      id: 'reset',
      label: labels.reset ?? 'Reset',
      allowRuntimeChange: true,
      continuous: false,
    },
  );
}

const DEFAULT_LIFECYCLE_ACTIONS = defineLifecycleActions();

function buildScenarioDefinition<TConfig extends object, TModel>(
  options: DefineModelOptions<TConfig, TModel>,
  config: TConfig,
): ScenarioDefinition {
  return defineScenario({
    parameters: resolveSection(options.parameters, config),
    actions: resolveSection(options.actions, config) ?? DEFAULT_LIFECYCLE_ACTIONS,
    environments: resolveSection(options.environments, config),
    charts: resolveSection(options.charts, config),
  });
}

export function defineModel<
  TConfig extends object,
  TModel,
>(options: DefineModelOptions<TConfig, TModel>): DeclarativeModelBinding<TConfig> {
  const resolveConfig = (overrides: Partial<TConfig> = {}): TConfig => ({
    ...((options.defaults ?? {}) as TConfig),
    ...overrides,
  });

  return {
    createScenario(config: Partial<TConfig> = {}): ScenarioDefinition {
      return buildScenarioDefinition(options, resolveConfig(config));
    },

    createSession(config: Partial<TConfig> = {}): SimulatorSession {
      const initialConfig = resolveConfig(config);
      const model = options.create(initialConfig);
      const assetRegistry = new Map<string, PublishedAsset>();
      const syncedItems = new Map<string, SyncedLayerState>();
      let currentDefinition = buildScenarioDefinition(options, initialConfig);
      let registry = ScenarioRegistry.from(currentDefinition);
      let session!: SimulatorSession;

      const getCurrentConfig = (): TConfig => ({
        ...initialConfig,
        ...(options.getConfig?.(model, initialConfig) ?? {}),
      });

      const rebuildDefinition = (): void => {
        currentDefinition = buildScenarioDefinition(options, getCurrentConfig());
        registry = ScenarioRegistry.from(currentDefinition);
      };

      const runSync = async (): Promise<void> => {
        await options.sync?.(model, context);
      };

      const resetSyncedItems = async (): Promise<void> => {
        for (const { envId, layerId, items } of syncedItems.values()) {
          if (items.size === 0) {
            continue;
          }
          await session.emitter.itemDelete({
            env_id: envId,
            layer_id: layerId,
            items: cloneItems(Array.from(items.keys(), (id) => ({ id }))),
          });
        }
        syncedItems.clear();
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
        getConfig: getCurrentConfig,
        replayDefinition: () => registry.replay(session.emitter),
        sync: runSync,
        async refreshParameters(ids) {
          const nextDefinition = buildScenarioDefinition(options, getCurrentConfig());
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
        setChartValues(values, time) {
          return session.emitter.chartUpdate({
            updates: Object.entries(values).map(([id, entry]) => {
              if (typeof entry === 'number') {
                return { id, value: entry, time };
              }
              return {
                id,
                value: entry.value,
                time: entry.time ?? time,
              };
            }),
          });
        },
        updateCharts: (payload) => session.emitter.chartUpdate(payload),
        clearCharts: (...chartIds) => session.emitter.chartUpdate({
          operations: chartIds.map((id) => ({ id, operation: 'clear' as const })),
        }),
        clearAllCharts() {
          const chartIds = (currentDefinition.charts ?? []).map((chart) => chart.id);
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
        async syncItems(envId, layerId, items) {
          const layerKey = getLayerKey(envId, layerId);
          const previousState = syncedItems.get(layerKey);
          const previousItems = previousState?.items ?? new Map<ItemIdentifier, ItemRecord>();
          const currentIds = new Set<ItemIdentifier>(items.map((item) => item.id));
          const currentItems = new Map<ItemIdentifier, ItemRecord>();
          const create: Array<(typeof items)[number]> = [];
          const update: ItemRecord[] = [];

          for (const item of items) {
            const snapshot = cloneItem(item);
            currentItems.set(item.id, snapshot);

            const previous = previousItems.get(item.id);
            if (!previous) {
              create.push(item);
              continue;
            }

            const diff = diffItem(previous, snapshot, item.id);
            if (diff) {
              update.push(diff);
            }
          }

          const remove = Array.from(previousItems.keys())
            .filter((id) => !currentIds.has(id))
            .map((id) => ({ id }));

          if (remove.length > 0) {
            await session.emitter.itemDelete({
              env_id: envId,
              layer_id: layerId,
              items: cloneItems(remove),
            });
          }
          if (create.length > 0) {
            await session.emitter.itemCreate({
              env_id: envId,
              layer_id: layerId,
              items: cloneItems(create),
            });
          }
          if (update.length > 0) {
            await session.emitter.itemUpdate({
              env_id: envId,
              layer_id: layerId,
              items: cloneItems(update),
            });
          }

          syncedItems.set(layerKey, {
            envId,
            layerId,
            items: currentItems,
          });
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

      const handleDefaultAction = async (
        payload: ActionStartPayload,
      ): Promise<boolean | undefined> => {
        if (payload.id === 'start') {
          return options.step
            ? Boolean(await options.step(model, context))
            : false;
        }

        if (payload.id === 'step') {
          if (options.step) {
            await options.step(model, context);
          }
          return false;
        }

        if (payload.id === 'reset') {
          await resetSyncedItems();
          if (options.reset) {
            await options.reset(model, context);
          } else if (options.init) {
            await options.init(model, context);
            rebuildDefinition();
            await context.replayDefinition();
            await runSync();
          }
          return false;
        }

        return undefined;
      };

      session = new BaseSimulatorSession({
        async onConnect() {
          assetRegistry.clear();
          syncedItems.clear();
          await options.init?.(model, context);
          rebuildDefinition();
          await context.replayDefinition();
          await runSync();
        },
        async onDisconnect() {
          await options.dispose?.(model, context);
          assetRegistry.clear();
          syncedItems.clear();
        },
        async onStateSync(payload) {
          rebuildDefinition();
          syncedItems.clear();
          await session.emitter.stateSyncBegin({ request_id: payload.request_id });
          await context.replayDefinition();
          await runSync();
          await session.emitter.stateSyncEnd({ request_id: payload.request_id });
        },
        async onParamChange(payload) {
          await options.onParameterChange?.(model, payload, context);
        },
        async onActionStart(payload) {
          const shouldContinue = await handleDefaultAction(payload)
            ?? await options.onAction?.(model, payload, context)
            ?? false;
          await context.finishAction(payload, shouldContinue);
        },
        async onAssetSync(payload) {
          if (options.onAssetSync) {
            await options.onAssetSync(model, payload, context);
            return;
          }
          await context.syncAssets(payload);
        },
      });

      return session;
    },
  };
}

export function defineExample<
  TConfig extends object,
  TModel,
  TMetadata extends object,
>(
  metadata: TMetadata,
  options: DefineModelOptions<TConfig, TModel>,
): DeclarativeExampleBinding<TConfig, TMetadata> {
  return {
    ...metadata,
    ...defineModel(options),
  };
}
