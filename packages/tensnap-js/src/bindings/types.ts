import type {
  Action,
  ActionInvokePayload,
  ActionKwargDefinition,
  AssetSyncPayload,
  ChartGroupMetadata,
  ChartUpdatePayload,
  MetadataUpdatePayload,
  MonitorMetadata,
  Parameter,
  ParameterChangePayload,
  ProtocolValue,
  RestorableEnvironment,
  SceneRestorePayload,
  TrajectoryLayerMetadata,
} from '@tensnap/protocol';
import type { SimulatorEmitter, SimulatorSession } from '../runtime';
import type { ScenarioDefinition, ScenarioEnvironmentDefinition, ScenarioRegistry } from '../scenario';

export type MaybePromise<T> = T | Promise<T>;
export type MaybeFactory<TModel, TValue> = TValue | ((model: TModel) => TValue);
export type MaybeParameterFactory<TConfig extends object, TModel, TValue> =
  TValue | ((model: TModel, config: TConfig) => TValue);
export type ItemRecord = Record<string, unknown>;
export type PrimitiveItemKey = string | number;
export type ItemDeleteKey = PrimitiveItemKey | ItemRecord;
export type ChartValueInput = unknown | { value: unknown; time?: number };
/** Model-owned checkpoint data. The binding chooses its canonical wire encoding. */
export type CheckpointData = ProtocolValue | Uint8Array;
export type RestorableLayer = RestorableEnvironment['layers'][number];
export type ItemKeySelector<TItem> =
  | keyof TItem
  | readonly (keyof TItem | string)[]
  | ((item: TItem, record: ItemRecord) => ItemDeleteKey);

export interface PublishedAsset {
  hash: string;
  mime: string;
  data: Uint8Array<ArrayBuffer>;
  label?: string;
}

export interface SyncedLayerState {
  envId: string;
  layerId: string;
  items: Map<string, ItemRecord>;
  deleteKeys: Map<string, ItemDeleteKey>;
  keyFields: readonly string[];
}

export interface ResolvedItemKey {
  storageKey: string;
  deleteKey: ItemDeleteKey;
  keyFields: readonly string[];
}

export interface LifecycleActionLabels {
  start?: string;
  step?: string;
  stop?: string;
  reset?: string;
}

export interface SyncRecordsOptions<TItem extends object = ItemRecord> {
  key?: ItemKeySelector<TItem>;
}

export interface ModelSessionContext<TConfig extends object> {
  readonly session: SimulatorSession;
  readonly emitter: SimulatorEmitter;
  readonly registry: ScenarioRegistry;
  getConfig(): TConfig;
  replayDefinition(): Promise<void>;
  sync(): Promise<void>;
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
  setMonitor(id: string, value: ProtocolValue, revision?: string | number): Promise<void>;
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
  syncRecords<TItem extends object>(
    envId: string,
    layerId: string,
    items: readonly TItem[],
    options?: SyncRecordsOptions<TItem>,
  ): Promise<void>;
  syncItems<TItem extends object>(
    envId: string,
    layerId: string,
    items: readonly TItem[],
    options?: SyncRecordsOptions<TItem>,
  ): Promise<void>;
  finishAction(
    payload: Pick<ActionInvokePayload, 'id' | 'continuous' | 'request_id'>,
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

export interface DeclarativeModelBinding<TConfig extends object> {
  createScenario(config?: Partial<TConfig>): ScenarioDefinition;
  createSession(config?: Partial<TConfig>): SimulatorSession;
}

export type DeclarativeExampleBinding<
  TConfig extends object,
  TMetadata extends object,
> = TMetadata & DeclarativeModelBinding<TConfig>;

export interface ModelBuilderOptions<TConfig extends object, TModel> {
  defaults?: TConfig;
  create(config: TConfig): TModel;
  getConfig?(model: TModel, initialConfig: TConfig): Partial<TConfig> | TConfig;
  init?(model: TModel, ctx: ModelSessionContext<TConfig>): MaybePromise<void>;
  dispose?(model: TModel, ctx: ModelSessionContext<TConfig>): MaybePromise<void>;
  step?(model: TModel, ctx: ModelSessionContext<TConfig>): MaybePromise<boolean | void>;
  reset?(model: TModel, ctx: ModelSessionContext<TConfig>): MaybePromise<void>;
  stop?(model: TModel, ctx: ModelSessionContext<TConfig>): MaybePromise<void>;
  /** Projected restore strategy. Imperative and declarative layer restore cannot be mixed implicitly. */
  sceneRestore?: SceneRestoreOptions<TConfig, TModel>;
  /** Opt-in exact checkpoint restore. Called before projected state restoration. */
  restoreCheckpoint?(
    model: TModel,
    data: CheckpointData,
    ctx: ModelSessionContext<TConfig>,
  ): MaybePromise<void>;
  /** Opt-in exact checkpoint capture. Return model data; the binding owns wire encoding. */
  captureCheckpoint?(model: TModel, ctx: ModelSessionContext<TConfig>): MaybePromise<CheckpointData>;
  time?(model: TModel): number;
  lifecycleLabels?: LifecycleActionLabels;
}

export interface ImperativeSceneRestoreOptions<TConfig extends object, TModel> {
  mode: 'imperative';
  validate?(model: TModel, payload: SceneRestorePayload, ctx: ModelSessionContext<TConfig>): MaybePromise<void>;
  apply(model: TModel, payload: SceneRestorePayload, ctx: ModelSessionContext<TConfig>): MaybePromise<void>;
}

export interface ComposedSceneRestoreOptions<TConfig extends object, TModel> {
  mode: 'compose';
  validate?(model: TModel, payload: SceneRestorePayload, ctx: ModelSessionContext<TConfig>): MaybePromise<void>;
  beforeApply?(model: TModel, payload: SceneRestorePayload, ctx: ModelSessionContext<TConfig>): MaybePromise<void>;
  restoreTime?(model: TModel, time: number, ctx: ModelSessionContext<TConfig>): MaybePromise<void>;
  afterApply?(model: TModel, payload: SceneRestorePayload, ctx: ModelSessionContext<TConfig>): MaybePromise<void>;
}

export type SceneRestoreOptions<TConfig extends object, TModel> =
  | ImperativeSceneRestoreOptions<TConfig, TModel>
  | ComposedSceneRestoreOptions<TConfig, TModel>;

export interface ModelMetadata {
  id: string;
  name: string;
  description: string;
  version?: string;
  stateSchemaVersion?: string;
  capabilities?: readonly string[];
  capabilityDetails?: Record<string, ProtocolValue>;
  [key: string]: unknown;
}

export interface BaseParameterOptions<TConfig extends object, TModel, TValue> {
  label?: string;
  runtime?: boolean;
  get(model: TModel, config: TConfig): TValue;
  set?(
    model: TModel,
    value: TValue,
    ctx: ModelSessionContext<TConfig>,
  ): MaybePromise<void>;
}

export interface NumberParameterOptions<TConfig extends object, TModel>
  extends BaseParameterOptions<TConfig, TModel, number> {
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  normalize?(value: number, model: TModel, config: TConfig): number;
}

export interface BooleanParameterOptions<TConfig extends object, TModel>
  extends BaseParameterOptions<TConfig, TModel, boolean> {}

export interface StringParameterOptions<TConfig extends object, TModel>
  extends BaseParameterOptions<TConfig, TModel, string> {}

export interface EnumParameterOptions<
  TConfig extends object,
  TModel,
  TValue extends string = string,
> extends BaseParameterOptions<TConfig, TModel, TValue> {
  options: MaybeParameterFactory<TConfig, TModel, readonly TValue[]>;
  labels?: MaybeParameterFactory<TConfig, TModel, Readonly<Record<TValue, string>>>;
}

export interface ParameterChangeResult {
  accepted: boolean;
  value?: unknown;
}

export interface ParameterBinding<TConfig extends object, TModel> {
  id: string;
  metadata(model: TModel, config: TConfig): Parameter;
  apply(
    model: TModel,
    payload: ParameterChangePayload,
    ctx: ModelSessionContext<TConfig>,
    config: TConfig,
  ): MaybePromise<ParameterChangeResult>;
}

export interface EnvironmentOptions {
  type?: ScenarioEnvironmentDefinition['type'];
}

export interface LayerRuntimeContext {
  phase: 'sync' | 'step' | 'reset';
  full: boolean;
}

export type LayerProjector<TModel, TItem extends object> =
  (model: TModel, item: TItem) => ItemRecord;

/**
 * Declarative inverse for one complete restorable layer snapshot. The binding
 * computes C/U/D from stable keys; callbacks mutate only model-owned state.
 */
export interface LayerRestoreOptions<TModel> {
  /** Optional current key inventory. Omitted uses this layer's `items` projection and `key`. */
  itemIds?(model: TModel): Iterable<ItemDeleteKey>;
  /** Validate the complete inbound layer before any restore callback mutates the model. */
  validate?(model: TModel, layer: RestorableLayer): MaybePromise<void>;
  /** Apply complete layer metadata before item mutations. */
  restoreMetadata?(model: TModel, metadata: Record<string, ProtocolValue>): MaybePromise<void>;
  create?(model: TModel, item: Record<string, ProtocolValue>, key: ItemDeleteKey): MaybePromise<void>;
  update?(model: TModel, key: ItemDeleteKey, item: Record<string, ProtocolValue>): MaybePromise<void>;
  delete?(model: TModel, key: ItemDeleteKey): MaybePromise<void>;
}

export interface LayerOptions<TModel, TItem extends object = ItemRecord> {
  type: string;
  metadata?: MaybeFactory<TModel, Record<string, unknown> | undefined>;
  dependencyLayerIds?: Record<string, string>;
  items?(model: TModel, ctx: LayerRuntimeContext): readonly TItem[];
  updates?(model: TModel, ctx: LayerRuntimeContext): readonly Partial<TItem>[];
  project?: LayerProjector<TModel, TItem>;
  updateProject?: LayerProjector<TModel, Partial<TItem> & object>;
  key?: ItemKeySelector<TItem>;
  updateKey?: ItemKeySelector<Partial<TItem> & object>;
  restore?: LayerRestoreOptions<TModel>;
}

/** Typed first-class trajectory metadata normalized to canonical wire keys. */
export interface TrajectoryLayerOptions<TModel, TItem extends object = ItemRecord>
  extends Omit<LayerOptions<TModel, TItem>, 'type' | 'metadata'> {
  metadata?: MaybeFactory<TModel, TrajectoryLayerMetadata | undefined>;
  length?: number;
  width?: number;
  color?: string;
  zIndex?: number;
  onAgentDelete?: TrajectoryLayerMetadata['on_agent_delete'];
  onStateSync?: TrajectoryLayerMetadata['on_state_sync'];
  onReset?: TrajectoryLayerMetadata['on_reset'];
}

export interface LayerBinding<TModel, TItem extends object = ItemRecord>
  extends LayerOptions<TModel, TItem> {
  id: string;
}

export interface EnvironmentBinding<TModel> {
  id: string;
  type: ScenarioEnvironmentDefinition['type'];
  layers: LayerBinding<TModel, any>[];
}

export interface ChartOptions<TConfig extends object, TModel> {
  label?: string;
  color?: string;
  get(model: TModel, config: TConfig): unknown;
}

export interface ChartSeriesOptions<TConfig extends object, TModel> {
  id: string;
  label?: string;
  color?: string;
  get(model: TModel, config: TConfig): unknown;
}

export interface ChartBinding<TConfig extends object, TModel> {
  metadata(): ChartGroupMetadata;
  values(model: TModel, config: TConfig): Record<string, unknown>;
}

export interface MonitorOptions<TConfig extends object, TModel> {
  label?: string;
  renderHint?: MonitorMetadata['render_hint'];
  get(model: TModel, config: TConfig): ProtocolValue;
}

export interface MonitorBinding<TConfig extends object, TModel> {
  metadata(): MonitorMetadata;
  value(model: TModel, config: TConfig): ProtocolValue;
}

export interface ActionOptions<TConfig extends object, TModel> {
  label?: string;
  scope?: Action['scope'];
  kwargs?: readonly ActionKwargDefinition[];
  continuous?: boolean;
  runtime?: boolean;
  sync?: boolean;
  run(
    model: TModel,
    ctx: ModelSessionContext<TConfig>,
    payload: ActionInvokePayload,
  ): MaybePromise<boolean | void>;
}

export interface ActionBinding<TConfig extends object, TModel> {
  metadata: Action;
  sync: boolean;
  run(
    model: TModel,
    ctx: ModelSessionContext<TConfig>,
    payload: ActionInvokePayload,
  ): MaybePromise<boolean | void>;
}

export interface AssetOptions<TConfig extends object, TModel> {
  mime: string;
  label?: string;
  data: Uint8Array | string | ((model: TModel, config: TConfig) => MaybePromise<Uint8Array | string>);
}

export interface AssetBinding<TConfig extends object, TModel> extends AssetOptions<TConfig, TModel> {
  id: string;
}

export type FieldSelector<TModel, TItem extends object, TValue = unknown> =
  | keyof TItem
  | string
  | LiteralField<TValue>
  | ((item: TItem, model: TModel) => TValue);

export interface LiteralField<TValue> {
  readonly kind: 'literal';
  readonly value: TValue;
}

export interface ConfigNumberField {
  type: 'number';
  label?: string;
  runtime?: boolean;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  normalize?(value: number): number;
}

export interface ConfigBooleanField {
  type: 'boolean';
  label?: string;
  runtime?: boolean;
}

export interface ConfigStringField {
  type: 'string';
  label?: string;
  runtime?: boolean;
}

export interface ConfigEnumField<TValue extends string = string> {
  type: 'enum';
  label?: string;
  runtime?: boolean;
  options: readonly TValue[];
  labels?: Readonly<Record<TValue, string>>;
}

export type ConfigParamField =
  | ConfigNumberField
  | ConfigBooleanField
  | ConfigStringField
  | ConfigEnumField;

export type ConfigParamFieldMap<TSource extends object> = {
  [K in keyof TSource]?: ConfigParamField;
};

export interface ParamsFromConfigOptions<
  TConfig extends object,
  TModel,
  TSource extends object,
> {
  get(model: TModel, config: TConfig): TSource;
  set?(
    model: TModel,
    patch: Partial<TSource>,
    key: keyof TSource,
    value: TSource[keyof TSource],
    ctx: ModelSessionContext<TConfig>,
  ): MaybePromise<void>;
  fields?: ConfigParamFieldMap<TSource>;
  runtime?: boolean;
}

export interface BoundModelDefinition<TConfig extends object, TModel> {
  metadata: ModelMetadata;
  options: ModelBuilderOptions<TConfig, TModel>;
  lifecycleLabels?: LifecycleActionLabels;
  parameters: ParameterBinding<TConfig, TModel>[];
  environments: EnvironmentBinding<TModel>[];
  charts: ChartBinding<TConfig, TModel>[];
  monitors: MonitorBinding<TConfig, TModel>[];
  actions: ActionBinding<TConfig, TModel>[];
  assets: AssetBinding<TConfig, TModel>[];
}
