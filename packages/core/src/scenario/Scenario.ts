import { AssetStore } from '../asset';
import { ChartStorage } from '../chart/ChartStorage';
import { instantiateChartMetadata } from '../chart/utils';
import { AgentStorage, BackgroundStorage, BaseStorage, EdgeStorage, GridEnvStorage } from '../environment/storages';
import type { GridAgent, TrajectoryPoint } from '../environment';
import type { Action, Parameter } from '../parameter';
import { sanitizeParameter } from '../parameter';
import type {
  ActionCUPayload,
  ActionDeletePayload,
  ActionEndPayload,
  ActionStartPayload,
  AgentCreatePayload,
  AgentDeletePayload,
  AgentUpdatePayload,
  AssetDataPayload,
  AssetDeletePayload,
  AssetMetaPayload,
  ChartCreatePayload,
  ChartDeletePayload,
  ChartUpdatePayload,
  EdgeCreatePayload,
  EdgeDeletePayload,
  EdgeUpdatePayload,
  EnvCreatePayload,
  EnvDeletePayload,
  EnvLayerCreatePayload,
  EnvLayerDeletePayload,
  EnvLayerUpdatePayload,
  LogPayload,
  MetadataUpdatePayload,
  NormalizedLogPayload,
  ParameterChangePayload,
  ParameterCUPayload,
  ParameterDeletePayload,
  ParameterSyncPayload,
  RendererToSimulatorMessage,
  ScenarioEnvironmentType,
  SimulatorToRendererMessage,
  StateSyncRequest,
} from '../protocol';
import { layerRegistry, LayerRegistryClass } from './layer-registry';
import type {
  ScenarioEnvironmentSnapshot,
  ScenarioEnvironmentState,
  ScenarioEventDetailMap,
  ScenarioEventType,
  ScenarioLayerSnapshot,
  ScenarioLayerState,
  ScenarioStorage,
  ScenarioSnapshot,
} from './types';

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function getInterpolation(value: unknown): 'nearest' | 'linear' {
  return value === 'linear' ? 'linear' : 'nearest';
}

export interface ScenarioOptions {
  charts?: ChartStorage;
  assets?: AssetStore;
  layerRegistry?: LayerRegistryClass;
}

export class Scenario extends EventTarget {
  private metadataState: Record<string, unknown> = {};
  private readonly actionsState = new Map<string, Action>();
  private readonly parametersState = new Map<string, Parameter>();
  private readonly environmentsState = new Map<string, ScenarioEnvironmentState>();
  private readonly logsState: NormalizedLogPayload[] = [];
  private readonly chartState: ChartStorage;
  private readonly assetState: AssetStore;
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
      case 'action_end':
        this.emit('action:end', message.payload as ActionEndPayload);
        return;
      case 'action_create':
        this.upsertAction(message.payload as ActionCUPayload, 'action:create');
        return;
      case 'action_update':
        this.upsertAction(message.payload as ActionCUPayload, 'action:update');
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
      case 'agent_create':
        this.createAgents(message.payload as AgentCreatePayload);
        return;
      case 'agent_update':
        this.updateAgents(message.payload as AgentUpdatePayload);
        return;
      case 'agent_delete':
        this.deleteAgents(message.payload as AgentDeletePayload);
        return;
      case 'edge_create':
        this.createEdges(message.payload as EdgeCreatePayload);
        return;
      case 'edge_update':
        this.updateEdges(message.payload as EdgeUpdatePayload);
        return;
      case 'edge_delete':
        this.deleteEdges(message.payload as EdgeDeletePayload);
        return;
      case 'param_create':
        this.upsertParameter(message.payload as ParameterCUPayload, 'param:create');
        return;
      case 'param_update':
        this.upsertParameter(message.payload as ParameterCUPayload, 'param:update');
        return;
      case 'param_delete':
        this.deleteParameter(message.payload as ParameterDeletePayload);
        return;
      case 'param_sync':
        this.syncParameter(message.payload as ParameterSyncPayload);
        return;
      case 'chart_create':
        this.createChart(message.payload as ChartCreatePayload);
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

  createStateSyncMessage(): RendererToSimulatorMessage<StateSyncRequest> {
    return {
      type: 'state_sync',
      payload: {
        parameters: [...this.parametersState.values()].map(cloneValue),
        actions: [...this.actionsState.values()].map(cloneValue),
        envs: [...this.environmentsState.values()].map((environment) => ({
          id: environment.id,
          type: environment.type,
          layers: [...environment.layers.values()].map((layer) => ({
            layer_id: layer.id,
            layer_type: layer.layerType,
          })),
        })),
        charts: this.chartState.getAllMeta().map(cloneValue),
      },
    };
  }

  createParamChangeMessage(id: string, value: unknown): RendererToSimulatorMessage<ParameterChangePayload> {
    return { type: 'param_change', payload: { id, value } };
  }

  createActionStartMessage(id: string, continuous?: boolean): RendererToSimulatorMessage<ActionStartPayload> {
    return { type: 'action_start', payload: { id, continuous } };
  }

  createAssetSyncMessage(): RendererToSimulatorMessage<{ assets: Record<string, string> }> {
    return { type: 'asset_sync', payload: { assets: this.assetState.getHeldHashes() } };
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
    this.reset();
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
          agentLayerRef: layer.agentLayerRef,
        });
        this.applyLayerMetadata(restoredEnv.layers.get(layer.id)!);
      }
      this.environmentsState.set(restoredEnv.id, restoredEnv);
    }

    this.chartState.load(snapshot.charts.map(cloneValue));

    this.logsState.push(...snapshot.logs.map(cloneValue));
  }

  reset(): void {
    this.metadataState = {};
    this.actionsState.clear();
    this.parametersState.clear();
    for (const environment of this.environmentsState.values()) {
      for (const layer of environment.layers.values()) {
        this.disposeLayer(layer);
      }
    }
    this.environmentsState.clear();
    this.logsState.splice(0, this.logsState.length);
    this.chartState.load([]);
    this.assetState.clear();
    this.emit('reset', undefined);
  }

  private applyMetadata(payload: MetadataUpdatePayload): void {
    Object.assign(this.metadataState, cloneValue(payload));
    this.emit('metadata:update', cloneValue(payload));
  }

  private upsertAction(payload: ActionCUPayload, eventType: 'action:create' | 'action:update'): void {
    this.actionsState.set(payload.id, cloneValue(payload));
    this.emit(eventType, cloneValue(payload));
  }

  private deleteAction(payload: ActionDeletePayload): void {
    this.actionsState.delete(payload.id);
    this.emit('action:delete', cloneValue(payload));
  }

  private createEnvironment(payload: EnvCreatePayload): void {
    this.environmentsState.set(payload.id, {
      id: payload.id,
      type: payload.type,
      layers: new Map(),
    });
    this.emit('env:create', cloneValue(payload));
  }

  private deleteEnvironment(payload: EnvDeletePayload): void {
    const environment = this.environmentsState.get(payload.id);
    if (environment) {
      for (const layer of environment.layers.values()) {
        this.disposeLayer(layer);
      }
    }
    this.environmentsState.delete(payload.id);
    this.emit('env:delete', cloneValue(payload));
  }

  private createLayer(payload: EnvLayerCreatePayload): void {
    const environment = this.ensureEnvironment(payload.env_id);
    const metadata = cloneValue(payload.data ?? {});
    const storage = this.createStorageForLayer(payload.layer_type, metadata);
    environment.layers.set(payload.layer_id, {
      id: payload.layer_id,
      layerType: payload.layer_type,
      metadata,
      storage,
      agentLayerRef:
        payload.layer_type === 'edge' && typeof metadata.agent_layer_id === 'string'
          ? metadata.agent_layer_id
          : undefined,
    });
    this.applyLayerMetadata(environment.layers.get(payload.layer_id)!);
    this.emit('layer:create', cloneValue(payload));
  }

  private updateLayer(payload: EnvLayerUpdatePayload): void {
    const layer = this.ensureLayer(payload.env_id, payload.layer_id);
    Object.assign(layer.metadata, cloneValue(payload.data));
    if (layer.layerType === 'edge' && typeof payload.data.agent_layer_id === 'string') {
      layer.agentLayerRef = payload.data.agent_layer_id;
    }
    this.applyLayerMetadata(layer);
    this.emit('layer:update', cloneValue(payload));
  }

  private deleteLayer(payload: EnvLayerDeletePayload): void {
    const environment = this.environmentsState.get(payload.env_id);
    const layer = environment?.layers.get(payload.layer_id);
    if (layer) {
      this.disposeLayer(layer);
      environment?.layers.delete(payload.layer_id);
    }
    this.emit('layer:delete', cloneValue(payload));
  }

  private createAgents(payload: AgentCreatePayload): void {
    const layer = this.ensureLayer(payload.env_id, payload.layer_id, 'agent');
    const storage = this.requireStorage(layer, AgentStorage, 'agent');
    storage.addAgents(payload.agents.map(cloneValue));
    this.emit('agent:create', cloneValue(payload));
  }

  private updateAgents(payload: AgentUpdatePayload): void {
    const layer = this.ensureLayer(payload.env_id, payload.layer_id, 'agent');
    const storage = this.requireStorage(layer, AgentStorage, 'agent');
    storage.updateAgents(payload.agents.map(cloneValue) as Array<{ id: string | number } & Record<string, unknown>>);
    this.updateGridTrajectories(payload.env_id, storage, payload.agents);
    this.emit('agent:update', cloneValue(payload));
  }

  private deleteAgents(payload: AgentDeletePayload): void {
    const layer = this.ensureLayer(payload.env_id, payload.layer_id, 'agent');
    const storage = this.requireStorage(layer, AgentStorage, 'agent');
    storage.removeAgents(payload.ids);
    this.emit('agent:delete', cloneValue(payload));
  }

  private updateGridTrajectories(
    envId: string,
    agentStorage: AgentStorage,
    updates: AgentUpdatePayload['agents'],
  ): void {
    const environment = this.environmentsState.get(envId);
    if (!environment || environment.type !== '2d') return;

    const gridLayer = [...environment.layers.values()].find(
      (candidate) => candidate.layerType === 'grid',
    );
    if (!(gridLayer?.storage instanceof GridEnvStorage)) return;

    const gridData = gridLayer.storage.getData();
    const currentTime = typeof this.metadataState.time === 'number' ? this.metadataState.time : 0;

    for (const update of updates) {
      const agent = agentStorage.getAgent(update.id);
      if (!agent) continue;

      const gridAgent = agent as GridAgent;
      if (gridAgent.x === undefined || gridAgent.y === undefined) continue;

      const trajectoryLength = gridAgent.trajectory_length ?? (gridData as Record<string, unknown>).trajectory_length;
      if (!trajectoryLength) continue;

      const point: TrajectoryPoint = {
        x: gridAgent.x,
        y: gridAgent.y,
        time: currentTime,
        color: gridAgent.trajectory_color ?? (gridData as Record<string, string | undefined>).trajectory_color,
      };

      const maxPoints = typeof trajectoryLength === 'number' && trajectoryLength > 0
        ? trajectoryLength + 1
        : undefined;
      agentStorage.appendTrajectoryPoint(update.id, point, maxPoints);
    }
  }

  private createEdges(payload: EdgeCreatePayload): void {
    const layer = this.ensureLayer(payload.env_id, payload.layer_id, 'edge');
    const storage = this.requireStorage(layer, EdgeStorage, 'edge');
    storage.addEdges(payload.edges.map(cloneValue));
    this.emit('edge:create', cloneValue(payload));
  }

  private updateEdges(payload: EdgeUpdatePayload): void {
    const layer = this.ensureLayer(payload.env_id, payload.layer_id, 'edge');
    const storage = this.requireStorage(layer, EdgeStorage, 'edge');
    storage.updateEdges(payload.edges.map(cloneValue));
    this.emit('edge:update', cloneValue(payload));
  }

  private deleteEdges(payload: EdgeDeletePayload): void {
    const layer = this.ensureLayer(payload.env_id, payload.layer_id, 'edge');
    const storage = this.requireStorage(layer, EdgeStorage, 'edge');
    storage.removeEdgePairs(payload.edges.map(cloneValue));
    this.emit('edge:delete', cloneValue(payload));
  }

  private upsertParameter(payload: ParameterCUPayload, eventType: 'param:create' | 'param:update'): void {
    const param = sanitizeParameter(cloneValue(payload) as Parameter) as Parameter;
    this.parametersState.set(param.id, param);
    this.emit(eventType, cloneValue(param));
  }

  private deleteParameter(payload: ParameterDeletePayload): void {
    this.parametersState.delete(payload.id);
    this.emit('param:delete', cloneValue(payload));
  }

  private syncParameter(payload: ParameterSyncPayload): void {
    const parameter = this.parametersState.get(payload.id);
    if (parameter) {
      Object.assign(parameter, { value: cloneValue(payload.value) });
      sanitizeParameter(parameter, true);
    }
    this.emit('param:sync', cloneValue(payload));
  }

  private createChart(payload: ChartCreatePayload): void {
    this.chartState.addGroup(instantiateChartMetadata(cloneValue(payload)), true);
    this.emit('chart:create', cloneValue(payload));
  }

  private updateChart(payload: ChartUpdatePayload): void {
    if (payload.updates?.length) {
      this.chartState.push(this.time ?? 0, cloneValue(payload.updates));
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
    this.emit('chart:update', cloneValue(payload));
  }

  private deleteChart(payload: ChartDeletePayload): void {
    this.chartState.removeGroup(payload.id);
    this.emit('chart:delete', cloneValue(payload));
  }

  private receiveAssetMeta(payload: AssetMetaPayload): void {
    this.assetState.receiveMetaBatch(payload.assets.map(cloneValue));
    this.emit('asset:meta', cloneValue(payload));
  }

  private receiveAssetData(payload: AssetDataPayload): void {
    void this.assetState.receiveData(payload.id, payload.hash, payload.mime, payload.data).then(() => {
      this.refreshBackgroundLayersForAsset(payload.id);
      this.emit('asset:data', cloneValue(payload));
    });
  }

  private deleteAssets(payload: AssetDeletePayload): void {
    this.assetState.deleteBatch(payload.ids);
    this.emit('asset:delete', cloneValue(payload));
  }

  private appendLog(payload: LogPayload): void {
    const normalized: NormalizedLogPayload = {
      ...cloneValue(payload),
      level: payload.level ?? 'info',
      timestamp: payload.timestamp ?? Date.now(),
    };
    this.logsState.push(normalized);
    this.emit('log', normalized);
  }

  private ensureEnvironment(id: string, type: ScenarioEnvironmentType = '2d'): ScenarioEnvironmentState {
    let environment = this.environmentsState.get(id);
    if (!environment) {
      environment = { id, type, layers: new Map() };
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
        storageSnapshot: cloneValue(layer.storage.dump()),
        agentLayerRef: layer.agentLayerRef,
      })),
    };
  }

  private createStorageForLayer(layerType: string, metadata: Record<string, unknown>): ScenarioStorage {
    const factory = this.layerRegistry.get(layerType)?.storageFactory;
    if (factory) {
      return factory(metadata);
    }
    return new BaseStorage<Record<string, unknown>, any>(cloneValue(metadata));
  }

  private requireStorage<TStorage>(
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
    this.applyLayerMetadata(layer);
    return layer.storage as TStorage;
  }

  private applyLayerMetadata(layer: ScenarioLayerState): void {
    if (layer.storage instanceof GridEnvStorage) {
      layer.storage.setData(cloneValue(layer.metadata));
      return;
    }

    if (layer.storage instanceof BackgroundStorage) {
      const background = layer.metadata.background;
      const interpolation = getInterpolation(layer.metadata.interpolation);
      if (
        typeof background === 'string'
        || background instanceof Uint8Array
        || background === undefined
        || background === null
      ) {
        void layer.storage.setBackground(background ?? undefined, interpolation);
        return;
      }

      if (typeof background === 'object' && background !== null && 'asset_id' in background) {
        const assetId = (background as { asset_id?: unknown }).asset_id;
        if (typeof assetId === 'string') {
          layer.storage.setBackgroundUrl(this.assetState.getUrl(assetId), interpolation);
          return;
        }
      }
    }
  }

  private refreshBackgroundLayersForAsset(assetId: string): void {
    for (const environment of this.environmentsState.values()) {
      for (const layer of environment.layers.values()) {
        if (!(layer.storage instanceof BackgroundStorage)) continue;
        const background = layer.metadata.background;
        if (typeof background !== 'object' || background === null || !('asset_id' in background)) continue;
        if ((background as { asset_id?: unknown }).asset_id !== assetId) continue;
        const interpolation = getInterpolation(
          (background as { interpolation?: unknown }).interpolation ?? layer.metadata.interpolation,
        );
        layer.storage.setBackgroundUrl(this.assetState.getUrl(assetId), interpolation);
      }
    }
  }

  private disposeLayer(layer: ScenarioLayerState): void {
    if (layer.storage instanceof BackgroundStorage) {
      layer.storage.destroy();
    }
  }

  private emit<T extends ScenarioEventType>(type: T, detail: ScenarioEventDetailMap[T]): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}