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
import { MonitorStorage } from '../monitor';
import type {
  Action,
  ActionDeletePayload,
  ActionResultPayload,
  ActionInvokePayload,
  AssetDataPayload,
  AssetDeletePayload,
  AssetMetadataPayload,
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
  MonitorDeletePayload,
  MonitorMetadata,
  MonitorUpdatePayload,
  NormalizedLogPayload,
  Parameter,
  ParameterChangePayload,
  ParameterDeletePayload,
  ParameterSyncPayload,
  RendererToSimulatorMessage,
  ScenarioEnvironmentType,
  ScreenshotRequestPayload,
  ScreenshotResponsePayload,
  StateSyncBeginPayload,
  StateSyncEndPayload,
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
import { createStateSyncInventory, createStateSyncRequest } from './state-sync-inventory';
import type {
  ScenarioEnvironmentSnapshot,
  ScenarioEnvironmentState,
  ScenarioDumpOptions,
  ScenarioEventDetailMap,
  ScenarioEventType,
  ScenarioLayerSnapshot,
  ScenarioLayerState,
  ScenarioLayerStorage,
  ScenarioSnapshot,
} from './types';
import { LazyEventTarget } from '../utils/LazyEventTarget';
import type { DiagnosticEvent } from '../diagnostics';

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function acceptsOptimisticParameterValue(parameter: Parameter, value: ParameterChangePayload['value']): boolean {
  switch (parameter.type) {
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'enum': return typeof value === 'string' && parameter.options.includes(value);
    case 'boolean': return typeof value === 'boolean';
    case 'string': return typeof value === 'string';
  }
}

export interface ScenarioOptions {
  charts?: ChartStorage;
  assets?: AssetStore;
  layerRegistry?: LayerRegistryClass;
  mutationRules?: 'strict' | 'legacy';
}

export class Scenario extends LazyEventTarget {
  private metadataState: Record<string, unknown> = {};
  private readonly actionsState = new Map<string, Action>();
  private readonly parametersState = new Map<string, Parameter>();
  private readonly environmentsState = new Map<string, ScenarioEnvironmentState>();
  private readonly logsState: NormalizedLogPayload[] = [];
  private readonly chartState: ChartStorage;
  private readonly monitorState = new MonitorStorage();
  private readonly assetState: AssetStore;
  private stateSyncDepth = 0;
  private resetDepth = 0;
  private metadataRevisionState = 0;
  private parameterRevisionState = 0;
  private mutationRules: 'strict' | 'legacy';
  readonly layerRegistry: LayerRegistryClass;

  constructor(options: ScenarioOptions = {}) {
    super();
    this.chartState = options.charts ?? new ChartStorage();
    this.assetState = options.assets ?? new AssetStore();
    this.layerRegistry = options.layerRegistry ?? layerRegistry;
    this.mutationRules = options.mutationRules ?? 'strict';
  }

  /** Called when a transport explicitly selects the v0.2 compatibility codec. */
  enableLegacyMutationRules(): void {
    this.mutationRules = 'legacy';
  }

  get metadata(): Record<string, unknown> {
    return cloneValue(this.metadataState);
  }

  get time(): number | undefined {
    return typeof this.metadataState.time === 'number' ? this.metadataState.time : undefined;
  }

  /** Revisions let read-mostly consumers reuse immutable derived views. */
  get metadataRevision(): number {
    return this.metadataRevisionState;
  }

  get parameterRevision(): number {
    return this.parameterRevisionState;
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

  get monitors(): MonitorStorage {
    return this.monitorState;
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

  /**
   * Apply the renderer's optimistic parameter echo without inventing a
   * simulator-originated `param_sync` message. A real `param_sync` can still
   * correct or reject this value when it arrives.
   */
  applyOptimisticParameterChange(id: string, value: ParameterChangePayload['value']): ParameterSyncPayload {
    const parameter = this.parametersState.get(id);
    if (!parameter) throw new Error(`Unknown parameter: ${id}.`);
    if (!acceptsOptimisticParameterValue(parameter, value)) {
      throw new Error(`Invalid value for parameter: ${id}.`);
    }
    const previous: ParameterSyncPayload = { id, value: cloneValue(parameter.value) };
    parameter.value = cloneValue(value) as string | number | boolean;
    sanitizeParameter(parameter, true);
    this.parameterRevisionState += 1;
    this.emit('param:optimistic', { id, value: cloneValue(parameter.value) });
    return previous;
  }

  apply(message: SimulatorToRendererMessage): void {
    if (this.mutationRules === 'strict') this.validateMutation(message);
    switch (message.type) {
      case 'metadata_update':
        this.applyMetadata(message.payload as MetadataUpdatePayload);
        return;
      case 'simulator_info':
        return;
      case 'state_sync_begin':
        this.beginStateSync();
        this.emit('state_sync:begin', message.payload as StateSyncBeginPayload);
        return;
      case 'state_sync_end':
        this.endStateSync();
        this.emit('state_sync:end', message.payload as StateSyncEndPayload);
        return;
      case 'action_result':
        this.emit('action:result', message.payload as ActionResultPayload);
        return;
      case 'action_create':
        this.createAction(message.payload as Action);
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
        this.createParameter(message.payload as Parameter);
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
      case 'monitor_create':
        this.createMonitor(message.payload as MonitorMetadata);
        return;
      case 'monitor_update':
        this.updateMonitor(message.payload as MonitorUpdatePayload);
        return;
      case 'monitor_delete':
        this.deleteMonitor(message.payload as MonitorDeletePayload);
        return;
      case 'asset_metadata':
        this.receiveAssetMeta(message.payload as AssetMetadataPayload);
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
        this.appendLog({ level: 'error', message: (message.payload as { message: string }).message });
        return;
      default:
        return;
    }
  }

  private validateMutation(message: SimulatorToRendererMessage): void {
    const payload = message.payload;
    switch (message.type) {
      case 'action_create':
        if (this.actionsState.has((payload as Action).id)) throw new Error(`action_create already exists: ${(payload as Action).id}`);
        return;
      case 'action_update':
        if (!this.actionsState.has((payload as Action).id)) throw new Error(`action_update does not exist: ${(payload as Action).id}`);
        return;
      case 'param_create':
        if (this.parametersState.has((payload as Parameter).id)) throw new Error(`param_create already exists: ${(payload as Parameter).id}`);
        return;
      case 'param_update':
        if (!this.parametersState.has((payload as Parameter).id)) throw new Error(`param_update does not exist: ${(payload as Parameter).id}`);
        return;
      case 'env_create':
        if (this.environmentsState.has((payload as EnvCreatePayload).id)) throw new Error(`env_create already exists: ${(payload as EnvCreatePayload).id}`);
        return;
      case 'env_layer_create': {
        const { env_id, layer_id } = payload as EnvLayerCreatePayload;
        const environment = this.environmentsState.get(env_id);
        if (!environment) throw new Error(`env_layer_create missing environment: ${env_id}`);
        if (environment.layers.has(layer_id)) throw new Error(`env_layer_create already exists: ${env_id}/${layer_id}`);
        return;
      }
      case 'env_layer_update': {
        const { env_id, layer_id } = payload as EnvLayerUpdatePayload;
        if (!this.environmentsState.get(env_id)?.layers.has(layer_id)) {
          throw new Error(`env_layer_update does not exist: ${env_id}/${layer_id}`);
        }
        return;
      }
      case 'item_create':
      case 'item_update': {
        const { env_id, layer_id, items } = payload as ItemCreatePayload | ItemUpdatePayload;
        const environment = this.environmentsState.get(env_id);
        const layer = environment?.layers.get(layer_id);
        if (!layer) throw new Error(`${message.type} missing layer: ${env_id}/${layer_id}`);
        const controller = this.getLayerController(layer.layerType);
        if (!controller?.getItemKeyExists && !controller?.getExistingItemKeys) {
          throw new Error(`${message.type} cannot check existing identities for layer type ${layer.layerType}`);
        }
        const context = this.createLayerControllerContext(environment!, layer);
        const hasKey = controller.getItemKeyExists?.(context);
        const hasWrongExistence = this.assertUniqueItemKeys(layer.layerType, items, message.type, hasKey);
        const existing = hasKey ? null : controller.getExistingItemKeys!(context, items);
        if (message.type === 'item_create' && (hasWrongExistence || (existing?.length ?? 0) > 0)) {
          throw new Error(`item_create already exists: ${env_id}/${layer_id}`);
        }
        if (message.type === 'item_update' && (hasWrongExistence || (existing?.length ?? items.length) !== items.length)) {
          throw new Error(`item_update does not exist: ${env_id}/${layer_id}`);
        }
        return;
      }
      case 'chart_create':
        if (this.chartState.hasGroup((payload as ChartGroupMetadata).id)) {
          throw new Error(`chart_create already exists: ${(payload as ChartGroupMetadata).id}`);
        }
        return;
    }
  }

  private assertUniqueItemKeys(
    layerType: string,
    items: Record<string, unknown>[],
    operation: 'item_create' | 'item_update',
    hasKey?: (key: unknown) => boolean,
  ): boolean {
    const fields = this.layerRegistry.get(layerType)?.primaryKeyFields;
    if (!fields?.length) throw new Error(`${operation} requires primary key fields for layer type ${layerType}`);
    let hasWrongExistence = false;
    if (fields.length === 1) {
      // Built-in agent and trajectory keys are primitive IDs. Avoid allocating
      // an array and JSON string for every item in a large update batch.
      // Non-primitive custom keys retain the existing serialized semantics.
      const field = fields[0];
      const primitiveKeys = new Set<string | number>();
      let allPrimitive = true;
      for (const item of items) {
        const value = item[field];
        if (value === undefined) throw new Error(`${operation} missing primary key for layer type ${layerType}`);
        if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) {
          allPrimitive = false;
          break;
        }
        if (primitiveKeys.has(value)) throw new Error(`${operation} repeats an identity in layer type ${layerType}`);
        primitiveKeys.add(value);
        if (hasKey && hasKey(value) !== (operation === 'item_update')) hasWrongExistence = true;
      }
      if (allPrimitive) return hasWrongExistence;
      hasWrongExistence = false;
    }
    const seen = new Set<string>();
    for (const item of items) {
      const values = fields.map((field) => item[field]);
      if (values.some((value) => value === undefined)) throw new Error(`${operation} missing primary key for layer type ${layerType}`);
      const key = JSON.stringify(values);
      if (seen.has(key)) throw new Error(`${operation} repeats an identity in layer type ${layerType}`);
      seen.add(key);
      if (hasKey && hasKey(fields.length === 1 ? values[0] : values) !== (operation === 'item_update')) {
        hasWrongExistence = true;
      }
    }
    return hasWrongExistence;
  }

  /** Advertise the current definitions for a read-only sync; simulator state remains authoritative. */
  createStateSyncMessage(modelId: string, requestId: string, instanceId?: string): RendererToSimulatorMessage<StateSyncRequest> {
    // The inventory projection is cheap; createStateSyncRequest takes its own
    // copy before returning a public protocol message.
    const inventory = createStateSyncInventory({
      parameters: this.parametersState.values(),
      actions: this.actionsState.values(),
      environments: [...this.environmentsState.values()].map((environment) => ({
        id: environment.id,
        type: environment.type,
        layers: environment.layers.values(),
      })),
      charts: this.chartState.getAllMeta(),
      monitors: this.monitorState.dump(),
    });
    return {
      type: 'state_sync',
      payload: createStateSyncRequest(modelId, requestId, instanceId, inventory),
    };
  }

  createParamChangeMessage(id: string, value: ParameterChangePayload['value']): RendererToSimulatorMessage<ParameterChangePayload> {
    return { type: 'param_change', payload: { id, value } };
  }

  createActionInvokeMessage(
    id: string,
    requestId: string,
    options: Pick<ActionInvokePayload, 'continuous' | 'target' | 'kwargs'> = {},
  ): RendererToSimulatorMessage<ActionInvokePayload> {
    return { type: 'action_invoke', payload: { id, request_id: requestId, ...options } };
  }

  createAssetSyncMessage(): RendererToSimulatorMessage<{ assets: Record<string, string> }> {
    return { type: 'asset_sync', payload: { assets: this.assetState.getHeldHashes() } };
  }

  createScreenshotResponseMessage(payload: ScreenshotResponsePayload): RendererToSimulatorMessage<ScreenshotResponsePayload> {
    return { type: 'screenshot_response', payload };
  }

  dump(options: ScenarioDumpOptions = {}): ScenarioSnapshot {
    return {
      metadata: cloneValue(this.metadataState),
      actions: [...this.actionsState.values()].map(cloneValue),
      parameters: [...this.parametersState.values()].map(cloneValue),
      environments: [...this.environmentsState.values()].map((environment) => this.snapshotEnvironment(environment)),
      charts: options.includeCharts === false ? [] : this.chartState.dump().map(cloneValue),
      monitors: options.includeMonitors === false ? [] : this.monitorState.dump(),
      logs: options.includeLogs === false ? [] : this.logsState.map(cloneValue),
      assets: options.includeAssets === false ? [] : this.assetState.dump(),
    };
  }

  load(snapshot: ScenarioSnapshot): void {
    // Loading a persisted snapshot is a replacement operation, not a model
    // reset. Never carry over lifecycle-preserved live layers into it.
    this.reset({ preserveTrajectoryLayers: false });
    this.metadataState = cloneValue(snapshot.metadata);
    this.metadataRevisionState += 1;

    for (const action of snapshot.actions) {
      this.actionsState.set(action.id, cloneValue(action));
    }

    for (const parameter of snapshot.parameters) {
      this.parametersState.set(parameter.id, cloneValue(parameter));
    }
    this.parameterRevisionState += 1;

    for (const environment of snapshot.environments) {
      const restoredEnv: ScenarioEnvironmentState = {
        id: environment.id,
        type: environment.type,
        layers: new Map(),
        dependencyGraph: new Map(),
      };
      for (const layer of environment.layers) {
        const metadata = cloneValue(layer.metadata ?? {});
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
    // Snapshot v1 predates monitors. Runtime callers may also be loading a
    // partially migrated archive, so treat an absent collection as empty.
    this.monitorState.load(snapshot.monitors ?? []);

    for (const log of snapshot.logs) this.logsState.push(cloneValue(log));
    this.assetState.load(snapshot.assets);
    for (const asset of snapshot.assets) {
      if (this.assetState.getUrl(asset.meta.id)) this.refreshBackgroundLayersForAsset(asset.meta.id);
    }
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
          const data = (layer.storage as TrajectoryStorage).getData();
          (layer.storage as TrajectoryStorage).closeTrajectories(data.trajectories.keys());
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
    this.resetDepth = 0;
    this.metadataRevisionState += 1;
    this.parameterRevisionState += 1;
    this.logsState.splice(0, this.logsState.length);
    this.chartState.load([]);
    this.monitorState.clear();
    this.assetState.clear();
    this.emit('reset', undefined);
  }

  /** Apply trajectory policy before the reserved reset action publishes state. */
  beginResetLifecycle(): void {
    if (this.resetDepth === 0) {
      for (const environment of this.environmentsState.values()) {
        for (const layer of environment.layers.values()) {
          if (layer.layerType !== 'trajectory' || !(layer.storage instanceof TrajectoryStorage)) continue;
          if (resolveTrajectoryLifecycle(layer.metadata).onReset === 'preserve') {
            layer.storage.closeTrajectories(layer.storage.getData().trajectories.keys());
          } else {
            layer.storage.clearTrajectories();
          }
        }
      }
    }
    this.resetDepth += 1;
  }

  /** End a reserved reset action boundary without changing model-owned state. */
  endResetLifecycle(): void {
    if (this.resetDepth > 0) this.resetDepth -= 1;
  }

  /**
   * Carry renderer-owned trace history into the final state-sync topology.
   * Simulator replay never contains trace points, so final layer metadata owns
   * the clear/preserve decision for replace and reconcile transactions alike.
   */
  applyStateSyncTrajectoryLifecycle(source: Scenario): void {
    for (const environment of this.environmentsState.values()) {
      const sourceEnvironment = source.environmentsState.get(environment.id);
      for (const layer of environment.layers.values()) {
        if (layer.layerType !== 'trajectory' || !(layer.storage instanceof TrajectoryStorage)) continue;
        if (resolveTrajectoryLifecycle(layer.metadata).onStateSync === 'clear') {
          layer.storage.clearTrajectories();
          continue;
        }
        const sourceLayer = sourceEnvironment?.layers.get(layer.id);
        if (sourceLayer?.layerType !== 'trajectory' || !(sourceLayer.storage instanceof TrajectoryStorage)) continue;
        layer.storage.setTrajectories(cloneValue(sourceLayer.storage.dump().trajectories));
      }
    }
  }

  // Payload properties are merged directly into metadataState. No clone needed
  // because websocket payloads are never mutated, so shared value references are safe.
  private applyMetadata(payload: MetadataUpdatePayload): void {
    Object.assign(this.metadataState, payload);
    this.metadataRevisionState += 1;
    this.emit('metadata:update', payload);
  }

  // Clone once for storage so internal state is isolated. Emit the original
  // payload directly — a second clone would be redundant.
  private createAction(payload: Action): void {
    if (this.mutationRules === 'legacy') this.actionsState.delete(payload.id);
    this.upsertAction(payload, 'action:create');
  }

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
      // Only a legacy session can reach this branch: strict mode rejected the
      // duplicate before any layer is disposed.
      for (const layer of existing.layers.values()) {
        this.disposeLayer(existing, layer);
      }
    }
    this.environmentsState.set(payload.id, {
      id: payload.id,
      type: payload.type,
      layers: new Map(),
      dependencyGraph: new Map(),
    });
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
    const metadata = payload.metadata ?? {};
    const dependencyLayerIds = this.normalizeDependencyLayerIds(payload.dependency_layer_ids);
    const existingLayer = environment.layers.get(payload.layer_id);

    if (existingLayer) {
      // Legacy replacement keeps dependents indexed against the stable id.
      this.unindexLayerDependencies(environment, existingLayer.id);
      this.disposeLayer(environment, existingLayer);
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
    for (const [key, value] of Object.entries(payload.metadata)) {
      if (key === 'dependency_layer_ids') {
        this.reportDiagnostic('immutable_layer_dependency', 'env_layer_update cannot mutate dependency_layer_ids; recreate the layer instead.', {
          envId: payload.env_id,
          layerId: payload.layer_id,
        });
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
      this.reportDiagnostic('items_missing_layer', `Cannot create items for missing layer ${payload.layer_id} in environment ${payload.env_id}.`, payload);
      return;
    }

    const controller = this.getLayerController(expectedLayerType ?? layer.layerType);
    if (!controller?.createItems) {
      this.reportDiagnostic('items_create_unsupported', `Layer type ${(expectedLayerType ?? layer.layerType)} does not support item creation.`, payload);
      return;
    }

    const previousLayerType = layer.layerType;
    if (!this.ensureRequiredDependencies(payload.env_id, layer, expectedLayerType ?? layer.layerType)) {
      return;
    }

    const context = this.createLayerControllerContext(environment, layer);
    if (this.mutationRules === 'legacy' && controller.deleteItems) {
      const keys = this.createItemDeleteKeys(expectedLayerType ?? layer.layerType, payload.items);
      if (keys) {
        const existingKeys = controller.getExistingItemKeys?.(context, payload.items) ?? keys;
        // A non-upsert create recreates only the addressed identities. Other
        // items in the layer remain untouched, preserving incremental births.
        controller.deleteItems(context, keys);
        if (existingKeys.length > 0) {
          this.runDependencyLayerControllers(environment, layer, 'delete', existingKeys);
        }
      }
    }

    controller.createItems(context, payload.items);

    if (previousLayerType !== layer.layerType) {
      // layer.metadata is internal state — must clone before emitting.
      this.emit('layer:update', {
        env_id: payload.env_id,
        layer_id: payload.layer_id,
        metadata: cloneValue(layer.metadata) as EnvLayerUpdatePayload['metadata'],
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
      this.reportDiagnostic('items_missing_layer', `Cannot update items for missing layer ${payload.layer_id} in environment ${payload.env_id}.`, payload);
      return;
    }

    const controller = this.getLayerController(expectedLayerType ?? layer.layerType);
    if (!controller?.updateItems) {
      this.reportDiagnostic('items_update_unsupported', `Layer type ${(expectedLayerType ?? layer.layerType)} does not support item updates.`, payload);
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
        metadata: cloneValue(layer.metadata) as EnvLayerUpdatePayload['metadata'],
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
      this.reportDiagnostic('items_missing_layer', `Cannot delete items for missing layer ${payload.layer_id} in environment ${payload.env_id}.`, payload);
      return;
    }

    const controller = this.getLayerController(expectedLayerType ?? layer.layerType);
    if (!controller?.deleteItems) {
      this.reportDiagnostic('items_delete_unsupported', `Layer type ${(expectedLayerType ?? layer.layerType)} does not support item deletion.`, payload);
      return;
    }

    const previousLayerType = layer.layerType;
    controller.deleteItems(this.createLayerControllerContext(environment, layer), payload.items);

    if (previousLayerType !== layer.layerType) {
      this.emit('layer:update', {
        env_id: payload.env_id,
        layer_id: payload.layer_id,
        metadata: cloneValue(layer.metadata) as EnvLayerUpdatePayload['metadata'],
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
        this.reportDiagnostic('dependency_missing', `Layer ${layer.id} (${layerType}) is missing required dependency ${dependencyType}.`, {
          envId,
          layerId: layer.id,
          layerType,
          dependencyType,
        });
        return false;
      }
      if (!environment.layers.has(dependencyLayerId)) {
        this.reportDiagnostic('dependency_target_missing', `Layer ${layer.id} (${layerType}) references missing dependency layer ${dependencyLayerId}.`, {
          envId,
          layerId: layer.id,
          layerType,
          dependencyType,
          dependencyLayerId,
        });
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
        this.reportDiagnostic('dependency_type_unknown', `Ignoring dependency on unknown layer type ${layerType}.`, { layerType });
        continue;
      }
      result[layerType] = layerId;
    }
    return result;
  }

  private createItemDeleteKeys(
    layerType: string,
    items: Record<string, unknown>[],
  ): ItemDeletePayload['items'] | null {
    const primaryKeyFields = this.layerRegistry.get(layerType)?.primaryKeyFields;
    if (!primaryKeyFields?.length) {
      this.reportDiagnostic('missing_primary_key', `Cannot recreate items for layer type ${layerType} without primary key fields; falling back to create semantics.`, { layerType });
      return null;
    }

    const objectKeys = items.map((item) => Object.fromEntries(
      primaryKeyFields.map((field) => [field, item[field]]),
    ));
    if (primaryKeyFields.length === 1) {
      const field = primaryKeyFields[0];
      const primitiveKeys = items.map((item) => item[field]);
      if (primitiveKeys.every((key) => typeof key === 'string' || typeof key === 'number')) {
        return primitiveKeys as Array<string | number>;
      }
    }
    return objectKeys as ItemDeletePayload['items'];
  }

  // Clone payload once to produce the sanitized parameter stored as internal state.
  // Emit that same instance directly — a second clone to "protect" it is redundant
  // because the stored and emitted object are the same; callers must not mutate
  // event detail objects.
  private createParameter(payload: Parameter): void {
    if (this.mutationRules === 'legacy') this.parametersState.delete(payload.id);
    this.upsertParameter(payload, 'param:create');
  }

  private upsertParameter(payload: Parameter, eventType: 'param:create' | 'param:update'): void {
    const param = sanitizeParameter(cloneValue(payload) as Parameter) as Parameter;
    this.parametersState.set(param.id, param);
    this.parameterRevisionState += 1;
    this.emit(eventType, param);
  }

  private deleteParameter(payload: ParameterDeletePayload): void {
    this.parametersState.delete(payload.id);
    this.parameterRevisionState += 1;
    this.emit('param:delete', payload);
  }

  private syncParameter(payload: ParameterSyncPayload): void {
    const parameter = this.parametersState.get(payload.id);
    if (parameter) {
      // Clone value only: it may be a complex object that sanitizeParameter
      // mutates in place, so we still need an owned copy.
      parameter.value = cloneValue(payload.value) as string | number | boolean;
      sanitizeParameter(parameter, true);
    }
    this.parameterRevisionState += 1;
    this.emit('param:sync', payload);
  }

  private createChart(payload: ChartGroupMetadata): void {
    // Clone before passing to instantiateChartMetadata since its contract
    // does not guarantee it leaves the argument unmodified.
    this.chartState.addGroup(instantiateChartMetadata(cloneValue(payload) as ChartGroupMetadata));
    this.emit('chart:create', payload);
  }

  private updateChart(payload: ChartUpdatePayload): void {
    if (payload.updates?.length) {
      // ChartStorage takes ownership; no need to clone an immutable payload array.
      this.chartState.push(this.time ?? 0, payload.updates, (message) => {
        this.reportDiagnostic('chart_metadata_missing', message, { updates: payload.updates });
      });
    }
    if (payload.operations?.length) {
      for (const operation of payload.operations) {
        if (operation.operation === 'clear') {
          if (operation.kind === 'all') this.chartState.clearAll();
          else if (operation.kind === 'group') this.chartState.clearGroups([operation.id]);
          else this.chartState.clearMetas([operation.id]);
        } else if (operation.kind === 'all') {
          this.chartState.truncateAll(operation.time, operation.inclusive);
        } else if (operation.kind === 'group') {
          this.chartState.truncateGroups([operation.id], operation.time, operation.inclusive);
        } else {
          this.chartState.truncateMetas([operation.id], operation.time, operation.inclusive);
        }
      }
    }
    this.emit('chart:update', payload);
  }

  private deleteChart(payload: ChartDeletePayload): void {
    if (payload.kind === 'group') this.chartState.removeGroup(payload.id);
    else this.chartState.removeMeta(payload.id);
    this.emit('chart:delete', payload);
  }

  private createMonitor(payload: MonitorMetadata): void {
    this.monitorState.create(payload);
    this.emit('monitor:create', payload);
  }

  private updateMonitor(payload: MonitorUpdatePayload): void {
    this.monitorState.update(payload);
    this.emit('monitor:update', payload);
  }

  private deleteMonitor(payload: MonitorDeletePayload): void {
    this.monitorState.delete(payload.id);
    this.emit('monitor:delete', payload);
  }

  private receiveAssetMeta(payload: AssetMetadataPayload): void {
    // Pass the array directly: AssetStore takes ownership and payload is never
    // mutated externally, so per-item cloning is unnecessary.
    const invalidated = this.assetState.receiveMetaBatch(payload.assets);
    for (const id of invalidated) this.refreshBackgroundLayersForAsset(id);
    this.emit('asset:metadata', payload);
  }

  private receiveAssetData(payload: AssetDataPayload): void {
    void this.assetState.receiveData(payload.id, payload.hash, payload.mime, payload.data).then(() => {
      if (this.assetState.get(payload.id)?.hash !== payload.hash) return;
      this.refreshBackgroundLayersForAsset(payload.id);
      this.emit('asset:data', payload);
    }).catch((error: unknown) => {
      this.reportDiagnostic('asset_data_invalid', `Cannot decode asset ${payload.id}: ${error instanceof Error ? error.message : String(error)}`, payload);
    });
  }

  private deleteAssets(payload: AssetDeletePayload): void {
    this.assetState.deleteBatch(payload.ids);
    for (const id of payload.ids) this.refreshBackgroundLayersForAsset(id);
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

  private reportDiagnostic(code: string, message: string, details?: unknown): void {
    this.emit('diagnostic', {
      timestamp: Date.now(),
      severity: 'warning',
      domain: 'runtime',
      source: 'scenario',
      code,
      message,
      ...(details === undefined ? {} : { details }),
      dedupeKey: `${code}:${message}`,
    } satisfies DiagnosticEvent);
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
      isReset: this.resetDepth > 0,
      reportWarning: (message) => this.reportDiagnostic('malformed_item_delete', message, {
        envId: environment.id,
        layerId: layer.id,
        layerType: layer.layerType,
      }),
      requireStorage: <TStorage>(ctor: new (...args: any[]) => TStorage, expectedLayerType: string) => (
        this.requireStorage(environment, layer, ctor, expectedLayerType)
      ),
    };
  }

  private reindexLayerDependencies(environment: ScenarioEnvironmentState, layer: ScenarioLayerState): void {
    this.unindexLayerDependencies(environment, layer.id);
    for (const dependencyLayerId of Object.values(layer.dependencyLayerIds)) {
      const dependents = environment.dependencyGraph.get(dependencyLayerId) ?? new Set<string>();
      dependents.add(layer.id);
      environment.dependencyGraph.set(dependencyLayerId, dependents);
    }
  }

  /** Remove only the dependency edges owned by this layer as a dependent. */
  private unindexLayerDependencies(environment: ScenarioEnvironmentState, layerId: string): void {
    for (const [dependencyLayerId, dependents] of environment.dependencyGraph.entries()) {
      dependents.delete(layerId);
      if (dependents.size === 0) {
        environment.dependencyGraph.delete(dependencyLayerId);
      }
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
    this.unindexLayerDependencies(environment, layerId);
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
