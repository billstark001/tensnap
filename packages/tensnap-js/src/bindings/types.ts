import type {
  Action,
  ActionStartPayload,
  AssetSyncPayload,
  ChartGroupMetadata,
  ChartUpdatePayload,
  MetadataUpdatePayload,
  Parameter,
  ParameterChangePayload,
} from '@tensnap/protocol';
import type { SimulatorEmitter, SimulatorSession } from '../runtime';
import type { ScenarioDefinition, ScenarioEnvironmentDefinition, ScenarioRegistry } from '../scenario';

export type MaybePromise<T> = T | Promise<T>;
export type MaybeFactory<TModel, TValue> = TValue | ((model: TModel) => TValue);
export type ItemRecord = Record<string, unknown>;
export type PrimitiveItemKey = string | number;
export type ItemDeleteKey = PrimitiveItemKey | ItemRecord;
export type ChartValueInput = unknown | { value: unknown; time?: number };
export type ItemKeySelector<TItem> =
  | keyof TItem
  | readonly (keyof TItem | string)[]
  | ((item: TItem, record: ItemRecord) => ItemDeleteKey);

export interface PublishedAsset {
  hash: string;
  mime: string;
  data: Uint8Array;
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
  time?(model: TModel): number;
  lifecycleLabels?: LifecycleActionLabels;
}

export interface ModelMetadata {
  id: string;
  name: string;
  description: string;
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
  options: readonly TValue[];
  labels?: Readonly<Record<TValue, string>>;
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

export interface LayerOptions<TModel, TItem extends object = ItemRecord> {
  type: string;
  data?: MaybeFactory<TModel, Record<string, unknown> | undefined>;
  dependencyLayerIds?: Record<string, string>;
  items?(model: TModel, ctx: LayerRuntimeContext): readonly TItem[];
  updates?(model: TModel, ctx: LayerRuntimeContext): readonly Partial<TItem>[];
  project?: LayerProjector<TModel, TItem>;
  updateProject?: LayerProjector<TModel, Partial<TItem> & object>;
  key?: ItemKeySelector<TItem>;
  updateKey?: ItemKeySelector<Partial<TItem> & object>;
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

export interface ActionOptions<TConfig extends object, TModel> {
  label?: string;
  continuous?: boolean;
  runtime?: boolean;
  sync?: boolean;
  run(
    model: TModel,
    ctx: ModelSessionContext<TConfig>,
    payload: ActionStartPayload,
  ): MaybePromise<boolean | void>;
}

export interface ActionBinding<TConfig extends object, TModel> {
  metadata: Action;
  sync: boolean;
  run(
    model: TModel,
    ctx: ModelSessionContext<TConfig>,
    payload: ActionStartPayload,
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
  actions: ActionBinding<TConfig, TModel>[];
  assets: AssetBinding<TConfig, TModel>[];
}
