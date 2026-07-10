import { AssetStore } from '../asset';
import { ChartStorage } from '../chart/ChartStorage';
import { instantiateChartMetadata } from '../chart/utils';
import {
  AgentStorage,
  BaseStorage,
  resolveTrajectoryLifecycle,
  TrajectoryStorage,
} from '../environment';
import { sanitizeParameter } from '../parameter';
import type {
  Action,
  ActionDeletePayload,
  ActionEndPayload,
  ActionStartPayload,
  AssetDataPayload,
  AssetDeletePayload,
  AssetMetaPayload,
  ChartDeletePayload,
  ChartGroupMetadata,
  ChartUpdatePayload,
  EnvCreatePayload,
  EnvDeletePayload,
  EnvLayerCreatePayload,
  EnvLayerDeletePayload,
  EnvLayerUpdatePayload,
  ItemCreatePayload,
  ItemDeletePayload,
  ItemUpdatePayload,
  LogPayload,
  MetadataUpdatePayload,
  NormalizedLogPayload,
  Parameter,
  ParameterChangePayload,
  ParameterDeletePayload,
  ParameterSyncPayload,
  RendererToSimulatorMessage,
  ScenarioEnvironmentType,
  ScreenshotRequestPayload,
  ScreenshotResponsePayload,
  StateSyncBoundaryPayload,
  SimulatorToRendererMessage,
  StateSyncRequest,
} from '@tensnap/protocol';
import {
  type ItemLayerController,
  type LayerControllerContext,
  type LayerDependencyChange,
  layerRegistry,
  LayerRegistryClass,
} from './layer-registry';
import type {
  ScenarioEnvironmentSnapshot,
  ScenarioEnvironmentState,
  ScenarioEventDetailMap,
  ScenarioEventType,
  ScenarioLayerSnapshot,
  ScenarioLayerState,
  ScenarioLayerStorage,
  ScenarioSnapshot,
} from './types';
import { LazyEventTarget } from '../utils/LazyEventTarget';

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface ScenarioOptions {
  charts?: ChartStorage;
  assets?: AssetStore;
  layerRegistry?: LayerRegistryClass;
}

export class Scenario extends LazyEventTarget {
  private metadataState: Record<string, unknown> = {};
  private readonly actionsState = new Map<string, Action>();
  private readonly parametersState = new Map<string, Parameter>();
  private readonly environmentsState = new Map<string, ScenarioEnvironmentState>();
  private readonly logsState: NormalizedLogPayload[] = [];
  private readonly chartState: ChartStorage;
  private readonly assetState: AssetStore;
  private stateSyncDepth = 0;
  readonly layerRegistry: LayerRegistryClass;

  constructor(options: ScenarioOptions = {}) {
    super();
    this.chartState = options.charts ?? new ChartStorage();
    this.assetState = options.assets ?? new AssetStore();
    this.layerRegistry = options.layerRegistry ?? layerRegistry;
  }

  get metadata(): Record<string, unknown> {
    return cloneValue(this.metadataState);
  }

  get time(): number | undefined {
    return typeof this.metadataState.time === 'number' ? this.metadataState.time : undefined;
  }

  get actions(): ReadonlyMap<string, Action> {
    return this.actionsState;
  }

  get parameters(): ReadonlyMap<string, Parameter> {
    return this.parametersState;
  }

  get environments(): ReadonlyMap<string, ScenarioEnvironmentState> {
    return this.environmentsState;
  }

  get charts(): ChartStorage {
    return this.chartState;
  }

  get assets(): AssetStore {
    return this.assetState;
  }

  get logs(): readonly NormalizedLogPayload[] {
    return this.logsState;
  }

  getEnvironment(id: string): ScenarioEnvironmentState | undefined {
    return this.environmentsState.get(id);
  }

  getParameter(id: string): Parameter | undefined {
    return this.parametersState.get(id);
  }

  getAction(id: string): Action | undefined {
    return this.actionsState.get(id);
  }

  apply(message: SimulatorToRendererMessage): void {
    switch (message.type) {
      case 'metadata_update':
        this.applyMetadata(message.payload as MetadataUpdatePayload);
        return;
      case 'state_sync_begin':
        this.beginStateSync();
        this.emit('state_sync:begin', message.payload as StateSyncBoundaryPayload);
        return;
      case 'state_sync_end':
        this.endStateSync();
        this.emit('state_sync:end', message.payload as StateSyncBoundaryPayload);
        return;
      case 'action_end':
        this.emit('action:end', message.payload as ActionEndPayload);
        return;
      case 'action_create':
        this.upsertAction(message.payload as Action, 'action:create');
        return;
      case 'action_update':
        this.upsertAction(message.payload as Action, 'action:update');
        return;
      case 'action_delete':
        this.deleteAction(message.payload as ActionDeletePayload);
        return;
      case 'env_create':
        this.createEnvironment(message.payload as EnvCreatePayload);
        return;
      case 'env_delete':
        this.deleteEnvironment(message.payload as EnvDeletePayload);
        return;
      case 'env_layer_create':
        this.createLayer(message.payload as EnvLayerCreatePayload);
        return;
      case 'env_layer_update':
        this.updateLayer(message.payload as EnvLayerUpdatePayload);
        return;
      case 'env_layer_delete':
        this.deleteLayer(message.payload as EnvLayerDeletePayload);
        return;
      case 'item_create':
        this.createItems(message.payload as ItemCreatePayload);
        return;
      case 'item_update':
        this.updateItems(message.payload as ItemUpdatePayload);
        return;
      case 'item_delete':
        this.deleteItems(message.payload as ItemDeletePayload);
        return;
      case 'param_create':
        this.upsertParameter(message.payload as Parameter, 'param:create');
        return;
      case 'param_update':
        this.upsertParameter(message.payload as Parameter, 'param:update');
        return;
      case 'param_delete':
        this.deleteParameter(message.payload as ParameterDeletePayload);
        return;
      case 'param_sync':
        this.syncParameter(message.payload as ParameterSyncPayload);
        return;
      case 'chart_create':
        this.createChart(message.payload as ChartGroupMetadata);
        return;
      case 'chart_update':
        this.updateChart(message.payload as ChartUpdatePayload);
        return;
      case 'chart_delete':
        this.deleteChart(message.payload as ChartDeletePayload);
        return;
      case 'asset_meta':
        this.receiveAssetMeta(message.payload as AssetMetaPayload);
        return;
      case 'asset_data':
        this.receiveAssetData(message.payload as AssetDataPayload);
        return;
      case 'asset_delete':
        this.deleteAssets(message.payload as AssetDeletePayload);
        return;
      case 'screenshot_request':
        this.emit('screenshot:request', message.payload as ScreenshotRequestPayload);
        return;
      case 'log':
        this.appendLog(message.payload as LogPayload);
        return;
      case 'error':
        this.appendLog({ level: 'error', message: (message.payload as { error: string }).error });
        return;
      default:
        return;
    }
  }

  createStateSyncMessage(requestId?: string): RendererToSimulatorMessage<StateSyncRequest> {
    // Internal state references are safe to include directly: this message is
    // serialized immediately by the caller and never mutated in-process.
    return {
      type: 'state_sync',
      payload: {
        request_id: requestId,
        parameters: [...this.parametersState.values()],
        actions: [...this.actionsState.values()],
        envs: [...this.environmentsState.values()].map((environment) => ({
          id: environment.id,
          type: environment.type,
          layers: [...environment.layers.values()].map((layer) => ({
            layer_id: layer.id,
            layer_type: layer.layerType,
          })),
        })),
        charts: this.chartState.getAllMeta(),
      },
    };
  }

  createParamChangeMessage(id: string, value: unknown): RendererToSimulatorMessage<ParameterChangePayload> {
    return { type: 'param_change', payload: { id, value } };
  }

  createActionStartMessage(id: string, continuous?: boolean, tickId?: string): RendererToSimulatorMessage<ActionStartPayload> {
    return { type: 'action_start', payload: { id, continuous, tick_id: tickId } };
  }

  createAssetSyncMessage(): RendererToSimulatorMessage<{ assets: Record<string, string> }> {
    return { type: 'asset_sync', payload: { assets: this.assetState.getHeldHashes() } };
  }

  createScreenshotResponseMessage(payload: ScreenshotResponsePayload): RendererToSimulatorMessage<ScreenshotResponsePayload> {
    return { type: 'screenshot_response', payload };
  }

  dump(): ScenarioSnapshot {
    return {
      metadata: cloneValue(this.metadataState),
      actions: [...this.actionsState.values()].map(cloneValue),
      parameters: [...this.parametersState.values()].map(cloneValue),
      environments: [...this.environmentsState.values()].map((environment) => this.snapshotEnvironment(environment)),
      charts: this.chartState.dump().map(cloneValue),
      logs: this.logsState.map(cloneValue),
    };
  }

  load(snapshot: ScenarioSnapshot): void {
    // Loading a persisted snapshot is a replacement operation, not a model
    // reset. Never carry over lifecycle-preserved live layers into it.
    this.reset({ preserveTrajectoryLayers: false });
    this.metadataState = cloneValue(snapshot.metadata);

    for (const action of snapshot.actions) {
      this.actionsState.set(action.id, cloneValue(action));
    }

    for (const parameter of snapshot.parameters) {
      this.parametersState.set(parameter.id, cloneValue(parameter));
    }

    for (const environment of snapshot.environments) {
      const restoredEnv: ScenarioEnvironmentState = {
        id: environment.id,
        type: environment.type,
        layers: new Map(),
        dependencyGraph: new Map(),
      };
      for (const layer of environment.layers) {
        const metadata = layer.metadata ?? {};
        const storage = this.createStorageForLayer(layer.layerType, metadata);
        storage.load(cloneValue(layer.storageSnapshot));
        restoredEnv.layers.set(layer.id, {
          id: layer.id,
          layerType: layer.layerType,
          metadata,
          storage,
          dependencyLayerIds: this.normalizeDependencyLayerIds(layer.dependencyLayerIds),
        });
        this.applyLayerMetadata(restoredEnv, restoredEnv.layers.get(layer.id)!);
      }
      this.environmentsState.set(restoredEnv.id, restoredEnv);
    }

    this.chartState.load(snapshot.charts.map(cloneValue));

    this.logsState.push(...snapshot.logs.map(cloneValue));
  }

  reset(options: { preserveTrajectoryLayers?: boolean } = {}): void {
    this.metadataState = {};
    this.actionsState.clear();
    this.parametersState.clear();
    const preservedTrajectoryEnvironments = new Map<string, ScenarioEnvironmentState>();
    for (const environment of this.environmentsState.values()) {
      const preservedLayers = new Map<string, ScenarioLayerState>();
      for (const layer of environment.layers.values()) {
        const shouldPreserve = options.preserveTrajectoryLayers !== false
          && layer.layerType === 'trajectory'
          && layer.storage instanceof TrajectoryStorage
          && resolveTrajectoryLifecycle(layer.metadata).onReset === 'preserve';
        if (shouldPreserve) {
          preservedLayers.set(layer.id, layer);
        } else {
          this.disposeLayer(environment, layer);
        }
      }
      if (preservedLayers.size > 0) {
        preservedTrajectoryEnvironments.set(environment.id, {
          id: environment.id,
          type: environment.type,
          layers: preservedLayers,
          dependencyGraph: new Map(),
        });
      }
    }
    this.environmentsState.clear();
    for (const environment of preservedTrajectoryEnvironments.values()) {
      this.environmentsState.set(environment.id, environment);
      for (const layer of environment.layers.values()) {
        this.reindexLayerDependencies(environment, layer);
      }
    }
    this.stateSyncDepth = 0;
    this.logsState.splice(0, this.logsState.length);
    this.chartState.load([]);
    this.assetState.clear();
    this.emit('reset', undefined);
  }

  // Payload properties are merged directly into metadataState. No clone needed
  // because websocket payloads are never mutated, so shared value references are safe.
  private applyMetadata(payload: MetadataUpdatePayload): void {
    Object.assign(this.metadataState, payload);
    this.emit('metadata:update', payload);
  }

  // Clone once for storage so internal state is isolated. Emit the original
  // payload directly — a second clone would be redundant.
  private upsertAction(payload: Action, eventType: 'action:create' | 'action:update'): void {
    this.actionsState.set(payload.id, cloneValue(payload));
    this.emit(eventType, payload);
  }

  private deleteAction(payload: ActionDeletePayload): void {
    this.actionsState.delete(payload.id);
    this.emit('action:delete', payload);
  }

  private createEnvironment(payload: EnvCreatePayload): void {
    const existing = this.environmentsState.get(payload.id);
    if (existing) {
      existing.type = payload.type;
    } else {
      this.environmentsState.set(payload.id, {
        id: payload.id,
        type: payload.type,
        layers: new Map(),
        dependencyGraph: new Map(),
      });
    }
    this.emit('env:create', payload);
  }

  private deleteEnvironment(payload: EnvDeletePayload): void {
    const environment = this.environmentsState.get(payload.id);
    if (environment) {
      for (const layer of environment.layers.values()) {
        this.disposeLayer(environment, layer);
      }
    }
    this.environmentsState.delete(payload.id);
    this.emit('env:delete', payload);
  }

  private createLayer(payload: EnvLayerCreatePayload): void {
    const environment = this.ensureEnvironment(payload.env_id);
    const metadata = payload.data ?? {};
    const dependencyLayerIds = this.normalizeDependencyLayerIds(payload.dependency_layer_ids);
    const existingLayer = environment.layers.get(payload.layer_id);

    if (existingLayer) {
      if (existingLayer.layerType !== payload.layer_type) {
        this.removeLayerFromDependencyGraph(environment, existingLayer.id);
        this.disposeLayer(environment, existingLayer);
        existingLayer.layerType = payload.layer_type;
        existingLayer.storage = this.createStorageForLayer(payload.layer_type, metadata);
      }

      existingLayer.metadata = metadata;
      existingLayer.dependencyLayerIds = dependencyLayerIds;
      this.applyLayerMetadata(environment, existingLayer);
      this.emit('layer:create', payload);
      return;
    }

    const storage = this.createStorageForLayer(payload.layer_type, metadata);
    environment.layers.set(payload.layer_id, {
      id: payload.layer_id,
      layerType: payload.layer_type,
      metadata,
      storage,
      dependencyLayerIds,
    });
    this.applyLayerMetadata(environment, environment.layers.get(payload.layer_id)!);
    this.emit('layer:create', payload);
  }

  private updateLayer(payload: EnvLayerUpdatePayload): void {
    const environment = this.ensureEnvironment(payload.env_id);
    const layer = this.ensureLayer(payload.env_id, payload.layer_id);
    for (const [key, value] of Object.entries(payload.data)) {
      if (key === 'dependency_layer_ids') {
        console.warn('env_layer_update cannot mutate dependency_layer_ids; recreate the layer instead.');
        continue;
      }
      layer.metadata[key] = value;
    }
    this.applyLayerMetadata(environment, layer);
    this.emit('layer:update', payload);
  }

  private deleteLayer(payload: EnvLayerDeletePayload): void {
    const environment = this.environmentsState.get(payload.env_id);
    const layer = environment?.layers.get(payload.layer_id);
    if (environment && layer) {
      this.removeLayerFromDependencyGraph(environment, layer.id);
      this.disposeLayer(environment, layer);
      environment?.layers.delete(payload.layer_id);
    }
    this.emit('layer:delete', payload);
  }

  private createItems(payload: ItemCreatePayload, expectedLayerType?: string): void {
    const environment = expectedLayerType
      ? this.ensureEnvironment(payload.env_id)
      : this.environmentsState.get(payload.env_id);
    const layer = expectedLayerType
      ? this.ensureLayer(payload.env_id, payload.layer_id, expectedLayerType)
      : environment?.layers.get(payload.layer_id);
    if (!environment || !layer) {
      console.warn(`Cannot create items for missing layer ${payload.layer_id} in environment ${payload.env_id}.`);
      return;
    }

    const controller = this.getLayerController(expectedLayerType ?? layer.layerType);
    if (!controller?.createItems) {
      console.warn(`Layer type ${(expectedLayerType ?? layer.layerType)} does not support item creation.`);
      return;
    }

    const previousLayerType = layer.layerType;
    if (!this.ensureRequiredDependencies(payload.env_id, layer, expectedLayerType ?? layer.layerType)) {
      return;
    }

    controller.createItems(this.createLayerControllerContext(environment, layer), payload.items);

    if (previousLayerType !== layer.layerType) {
      // layer.metadata is internal state — must clone before emitting.
      this.emit('layer:update', {
        env_id: payload.env_id,
        layer_id: payload.layer_id,
        data: cloneValue(layer.metadata),
      });
    }

    this.runDependencyLayerControllers(environment, layer, 'create', payload.items);

    this.emitLazy('item:create', () => payload);
  }

  private updateItems(payload: ItemUpdatePayload, expectedLayerType?: string): void {
    const environment = expectedLayerType
      ? this.ensureEnvironment(payload.env_id)
      : this.environmentsState.get(payload.env_id);
    const layer = expectedLayerType
      ? this.ensureLayer(payload.env_id, payload.layer_id, expectedLayerType)
      : environment?.layers.get(payload.layer_id);
    if (!environment || !layer) {
      console.warn(`Cannot update items for missing layer ${payload.layer_id} in environment ${payload.env_id}.`);
      return;
    }

    const controller = this.getLayerController(expectedLayerType ?? layer.layerType);
    if (!controller?.updateItems) {
      console.warn(`Layer type ${(expectedLayerType ?? layer.layerType)} does not support item updates.`);
      return;
    }

    const previousLayerType = layer.layerType;
    if (!this.ensureRequiredDependencies(payload.env_id, layer, expectedLayerType ?? layer.layerType)) {
      return;
    }

    controller.updateItems(this.createLayerControllerContext(environment, layer), payload.items);

    if (previousLayerType !== layer.layerType) {
      this.emit('layer:update', {
        env_id: payload.env_id,
        layer_id: payload.layer_id,
        data: cloneValue(layer.metadata),
      });
    }

    this.runDependencyLayerControllers(environment, layer, 'update', payload.items);

    this.emitLazy('item:update', () => payload);
  }

  private deleteItems(payload: ItemDeletePayload, expectedLayerType?: string): void {
    const environment = expectedLayerType
      ? this.ensureEnvironment(payload.env_id)
      : this.environmentsState.get(payload.env_id);
    const layer = expectedLayerType
      ? this.ensureLayer(payload.env_id, payload.layer_id, expectedLayerType)
      : environment?.layers.get(payload.layer_id);
    if (!environment || !layer) {
      console.warn(`Cannot delete items for missing layer ${payload.layer_id} in environment ${payload.env_id}.`);
      return;
    }

    const controller = this.getLayerController(expectedLayerType ?? layer.layerType);
    if (!controller?.deleteItems) {
      console.warn(`Layer type ${(expectedLayerType ?? layer.layerType)} does not support item deletion.`);
      return;
    }

    const previousLayerType = layer.layerType;
    controller.deleteItems(this.createLayerControllerContext(environment, layer), payload.items);

    if (previousLayerType !== layer.layerType) {
      this.emit('layer:update', {
        env_id: payload.env_id,
        layer_id: payload.layer_id,
        data: cloneValue(layer.metadata),
      });
    }

    this.runDependencyLayerControllers(environment, layer, 'delete', payload.items);

    this.emitLazy('item:delete', () => payload);
  }

  private ensureRequiredDependencies(envId: string, layer: ScenarioLayerState, layerType = layer.layerType): boolean {
    const environment = this.environmentsState.get(envId);
    if (!environment) {
      return false;
    }

    const requiredDependencyLayerTypes = this.layerRegistry.get(layerType)?.requiredDependencyLayerTypes ?? [];
    for (const dependencyType of requiredDependencyLayerTypes) {
      const dependencyLayerId = layer.dependencyLayerIds[dependencyType];
      if (!dependencyLayerId) {
        console.warn(`Layer ${layer.id} (${layerType}) is missing required dependency ${dependencyType}.`);
        return false;
      }
      if (!environment.layers.has(dependencyLayerId)) {
        console.warn(`Layer ${layer.id} (${layerType}) references missing dependency layer ${dependencyLayerId}.`);
        return false;
      }
    }

    return true;
  }

  private normalizeDependencyLayerIds(value: unknown): Record<string, string> {
    if (!isRecord(value)) {
      return {};
    }

    const result: Record<string, string> = {};
    for (const [layerType, layerId] of Object.entries(value)) {
      if (typeof layerId !== 'string') {
        continue;
      }
      if (!this.layerRegistry.has(layerType)) {
        console.warn(`Ignoring dependency on unknown layer type ${layerType}.`);
        continue;
      }
      result[layerType] = layerId;
    }
    return result;
  }

  // Clone payload once to produce the sanitized parameter stored as internal state.
  // Emit that same instance directly — a second clone to "protect" it is redundant
  // because the stored and emitted object are the same; callers must not mutate
  // event detail objects.
  private upsertParameter(payload: Parameter, eventType: 'param:create' | 'param:update'): void {
    const param = sanitizeParameter(cloneValue(payload) as Parameter) as Parameter;
    this.parametersState.set(param.id, param);
    this.emit(eventType, param);
  }

  private deleteParameter(payload: ParameterDeletePayload): void {
    this.parametersState.delete(payload.id);
    this.emit('param:delete', payload);
  }

  private syncParameter(payload: ParameterSyncPayload): void {
    const parameter = this.parametersState.get(payload.id);
    if (parameter) {
      // Clone value only: it may be a complex object that sanitizeParameter
      // mutates in place, so we still need an owned copy.
      parameter.value = cloneValue(payload.value as string | number | boolean);
      sanitizeParameter(parameter, true);
    }
    this.emit('param:sync', payload);
  }

  private createChart(payload: ChartGroupMetadata): void {
    // Clone before passing to instantiateChartMetadata since its contract
    // does not guarantee it leaves the argument unmodified.
    this.chartState.addGroup(instantiateChartMetadata(cloneValue(payload) as ChartGroupMetadata), true);
    this.emit('chart:create', payload);
  }

  private updateChart(payload: ChartUpdatePayload): void {
    if (payload.updates?.length) {
      // ChartStorage takes ownership; no need to clone an immutable payload array.
      this.chartState.push(this.time ?? 0, payload.updates);
    }
    if (payload.operations?.length) {
      for (const operation of payload.operations) {
        if (operation.operation === 'clear') {
          this.chartState.hasGroup(operation.id)
            ? this.chartState.clearGroups([operation.id])
            : this.chartState.clearMetas([operation.id]);
        }
      }
    }
    this.emit('chart:update', payload);
  }

  private deleteChart(payload: ChartDeletePayload): void {
    this.chartState.removeGroup(payload.id);
    this.emit('chart:delete', payload);
  }

  private receiveAssetMeta(payload: AssetMetaPayload): void {
    // Pass the array directly: AssetStore takes ownership and payload is never
    // mutated externally, so per-item cloning is unnecessary.
    this.assetState.receiveMetaBatch(payload.assets);
    this.emit('asset:meta', payload);
  }

  private receiveAssetData(payload: AssetDataPayload): void {
    void this.assetState.receiveData(payload.id, payload.hash, payload.mime, payload.data).then(() => {
      this.refreshBackgroundLayersForAsset(payload.id);
      this.emit('asset:data', payload);
    });
  }

  private deleteAssets(payload: AssetDeletePayload): void {
    this.assetState.deleteBatch(payload.ids);
    this.emit('asset:delete', payload);
  }

  private appendLog(payload: LogPayload): void {
    // Shallow spread is sufficient: LogPayload fields are primitives, so this
    // is equivalent in effect to a deep clone without the allocation overhead.
    const normalized: NormalizedLogPayload = {
      ...payload,
      level: payload.level ?? 'info',
      timestamp: payload.timestamp ?? Date.now(),
    };
    this.logsState.push(normalized);
    this.emit('log', normalized);
  }

  private ensureEnvironment(id: string, type: ScenarioEnvironmentType = '2d'): ScenarioEnvironmentState {
    let environment = this.environmentsState.get(id);
    if (!environment) {
      environment = { id, type, layers: new Map(), dependencyGraph: new Map() };
      this.environmentsState.set(id, environment);
    }
    return environment;
  }

  private ensureLayer(envId: string, layerId: string, layerType = 'agent'): ScenarioLayerState {
    const environment = this.ensureEnvironment(envId);
    let layer = environment.layers.get(layerId);
    if (!layer) {
      const metadata: Record<string, unknown> = {};
      layer = {
        id: layerId,
        layerType,
        metadata,
        storage: this.createStorageForLayer(layerType, metadata),
        dependencyLayerIds: {},
      };
      environment.layers.set(layerId, layer);
    }
    return layer;
  }

  private snapshotEnvironment(environment: ScenarioEnvironmentState): ScenarioEnvironmentSnapshot {
    return {
      id: environment.id,
      type: environment.type,
      layers: [...environment.layers.values()].map((layer): ScenarioLayerSnapshot => ({
        id: layer.id,
        layerType: layer.layerType,
        metadata: cloneValue(layer.metadata),
        dependencyLayerIds: cloneValue(layer.dependencyLayerIds),
        storageSnapshot: cloneValue(layer.storage.dump()),
      })),
    };
  }

  private createStorageForLayer(layerType: string, metadata: Record<string, unknown>): ScenarioLayerStorage {
    const factory = this.layerRegistry.get(layerType)?.storageFactory;
    if (factory) {
      return factory(metadata);
    }
    return new BaseStorage<Record<string, unknown>, any>(cloneValue(metadata));
  }

  private requireStorage<TStorage>(
    environment: ScenarioEnvironmentState,
    layer: ScenarioLayerState,
    ctor: new (...args: any[]) => TStorage,
    expectedLayerType: string,
  ): TStorage {
    if (layer.storage instanceof ctor) {
      return layer.storage;
    }
    const metadata = cloneValue(layer.metadata);
    layer.layerType = expectedLayerType;
    layer.storage = this.createStorageForLayer(expectedLayerType, metadata);
    this.applyLayerMetadata(environment, layer);
    return layer.storage as TStorage;
  }

  private applyLayerMetadata(environment: ScenarioEnvironmentState, layer: ScenarioLayerState): void {
    this.getLayerController(layer.layerType)?.applyMetadata?.(
      this.createLayerControllerContext(environment, layer),
    );
    this.reindexLayerDependencies(environment, layer);
  }

  private refreshBackgroundLayersForAsset(assetId: string): void {
    for (const environment of this.environmentsState.values()) {
      for (const layer of environment.layers.values()) {
        this.getLayerController(layer.layerType)?.onAssetDataReceived?.(
          this.createLayerControllerContext(environment, layer),
          assetId,
        );
      }
    }
  }

  private disposeLayer(environment: ScenarioEnvironmentState, layer: ScenarioLayerState): void {
    this.getLayerController(layer.layerType)?.dispose?.(
      this.createLayerControllerContext(environment, layer),
    );
  }

  private getLayerController(layerType: string): ItemLayerController | undefined {
    return this.layerRegistry.get(layerType)?.controller;
  }

  private createLayerControllerContext(
    environment: ScenarioEnvironmentState,
    layer: ScenarioLayerState,
  ): LayerControllerContext {
    return {
      envId: environment.id,
      environment,
      layer,
      assets: this.assetState,
      time: this.time,
      isStateSync: this.stateSyncDepth > 0,
      requireStorage: <TStorage>(ctor: new (...args: any[]) => TStorage, expectedLayerType: string) => (
        this.requireStorage(environment, layer, ctor, expectedLayerType)
      ),
    };
  }

  private reindexLayerDependencies(environment: ScenarioEnvironmentState, layer: ScenarioLayerState): void {
    this.removeLayerFromDependencyGraph(environment, layer.id);
    for (const dependencyLayerId of Object.values(layer.dependencyLayerIds)) {
      const dependents = environment.dependencyGraph.get(dependencyLayerId) ?? new Set<string>();
      dependents.add(layer.id);
      environment.dependencyGraph.set(dependencyLayerId, dependents);
    }
  }

  private beginStateSync(): void {
    if (this.stateSyncDepth === 0) {
      for (const environment of this.environmentsState.values()) {
        for (const layer of environment.layers.values()) {
          if (layer.layerType !== 'trajectory' || !(layer.storage instanceof TrajectoryStorage)) {
            continue;
          }
          if (resolveTrajectoryLifecycle(layer.metadata).onStateSync === 'clear') {
            layer.storage.clearTrajectories();
          }
        }
      }
    }
    this.stateSyncDepth += 1;
  }

  private endStateSync(): void {
    if (this.stateSyncDepth === 0) {
      return;
    }
    this.stateSyncDepth -= 1;
    if (this.stateSyncDepth > 0) {
      return;
    }

    // Reconcile once after the entire replay has settled. Doing this per
    // message would incorrectly remove traces before their source agent layer
    // is replayed, and would add avoidable work to large reconnects.
    for (const environment of this.environmentsState.values()) {
      for (const layer of environment.layers.values()) {
        if (layer.layerType !== 'trajectory' || !(layer.storage instanceof TrajectoryStorage)) {
          continue;
        }
        const agentLayerId = layer.dependencyLayerIds.agent;
        const agentLayer = typeof agentLayerId === 'string'
          ? environment.layers.get(agentLayerId)
          : undefined;
        const liveIds = agentLayer?.storage instanceof AgentStorage
          ? agentLayer.storage.getAgentIds()
          : [];
        layer.storage.reconcileAgentIds(
          liveIds,
          resolveTrajectoryLifecycle(layer.metadata).onAgentDelete,
        );
      }
    }
  }

  private removeLayerFromDependencyGraph(environment: ScenarioEnvironmentState, layerId: string): void {
    environment.dependencyGraph.delete(layerId);
    for (const [dependencyLayerId, dependents] of environment.dependencyGraph.entries()) {
      dependents.delete(layerId);
      if (dependents.size === 0) {
        environment.dependencyGraph.delete(dependencyLayerId);
      }
    }
  }

  private runDependencyLayerControllers(
    environment: ScenarioEnvironmentState,
    sourceLayer: ScenarioLayerState,
    kind: 'create' | 'update',
    items: Record<string, unknown>[],
  ): void;
  private runDependencyLayerControllers(
    environment: ScenarioEnvironmentState,
    sourceLayer: ScenarioLayerState,
    kind: 'delete',
    items: ItemDeletePayload['items'],
  ): void;
  private runDependencyLayerControllers(
    environment: ScenarioEnvironmentState,
    sourceLayer: ScenarioLayerState,
    kind: LayerDependencyChange['kind'],
    items: Record<string, unknown>[] | ItemDeletePayload['items'],
  ): void {
    const dependentLayerIds = environment.dependencyGraph.get(sourceLayer.id);
    if (!dependentLayerIds || dependentLayerIds.size === 0) {
      return;
    }

    // items originates from an immutable websocket payload, so passing it
    // by reference is safe — no clone required.
    const change: LayerDependencyChange = kind === 'delete'
      ? {
        kind,
        sourceLayer,
        items: items as ItemDeletePayload['items'],
      }
      : {
        kind,
        sourceLayer,
        items: items as Record<string, unknown>[],
      };

    for (const dependentLayerId of dependentLayerIds) {
      const dependentLayer = environment.layers.get(dependentLayerId);
      if (!dependentLayer) {
        continue;
      }
      this.getLayerController(dependentLayer.layerType)?.onDependencyItemsChanged?.(
        this.createLayerControllerContext(environment, dependentLayer),
        change,
      );
    }
  }

  private emit<T extends ScenarioEventType>(type: T, detail: ScenarioEventDetailMap[T]): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  private emitLazy<T extends ScenarioEventType>(type: T, detail: () => ScenarioEventDetailMap[T]): void {
    this.dispatchLazy(type, () => new CustomEvent(type, { detail: detail() }));
  }
}
