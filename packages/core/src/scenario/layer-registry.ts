import { z, ZodType } from 'zod';
import type { AssetStore } from '../asset';
import {
  resolveTrajectoryLifecycle,
  type GraphEdge,
  type GridCoordOffset,
  type GraphEnvConfig,
  type OriginMode,
} from '../environment';
import type { ItemDeletePayload } from '@tensnap/protocol';
import {
  type AgentId,
  AgentItemDiffSchema,
  AgentItemSchema,
  AgentLayerMetadataSchema,
  BackgroundLayerMetadataSchema,
  EdgeItemDiffSchema,
  EdgeItemSchema,
  EdgeLayerMetadataSchema,
  GridLayerMetadataSchema,
  TrajectoryItemDiffSchema,
  TrajectoryItemSchema,
  TrajectoryLayerMetadataSchema,
  type TrajectoryPoint,
} from '@tensnap/protocol/layers';
import {
  AgentStorage,
  BackgroundStorage,
  EdgeStorage,
  GridEnvStorage,
} from '../environment/storages';
import type { AgentRenderState, AgentStorageSnapshot, BackgroundData, EdgeStorageSnapshot, GridEnvData, TrajectoryStorageSnapshot } from '../environment/storages';
import { TrajectoryStorage } from '../environment/storages/TrajectoryStorage';
import {
  getAssetIdFromIcon,
  isBackgroundAssetReference,
} from '../environment/types';
import type { ScenarioEnvironmentState, ScenarioLayerSnapshot, ScenarioLayerState } from './types';
import type { RenderLayerPlan } from './render-plan';

export interface LayerStorage {
  dump(): unknown;
  load(snapshot: unknown): void;
}

export interface LayerControllerContext {
  envId: string;
  environment: ScenarioEnvironmentState;
  layer: ScenarioLayerState;
  assets: AssetStore;
  time?: number;
  /** True while a state-sync replay is being applied. */
  isStateSync: boolean;
  requireStorage<TStorage>(ctor: new (...args: any[]) => TStorage, expectedLayerType: string): TStorage;
}

type DeleteItems = ItemDeletePayload['items'];

export interface LayerDependencyUpsertChange {
  kind: 'create' | 'update' | 'delete';
  sourceLayer: ScenarioLayerState;
  items: Record<string, unknown>[];
}

export interface LayerDependencyDeleteChange {
  kind: 'delete';
  sourceLayer: ScenarioLayerState;
  items: DeleteItems;
}

export type LayerDependencyChange =
  | LayerDependencyUpsertChange
  | LayerDependencyDeleteChange;

// #region Controller types
export interface ItemLayerController<
  TCreateItem extends Record<string, unknown> = Record<string, unknown>,
  TUpdateItem extends Record<string, unknown> = TCreateItem,
> {
  applyMetadata?(context: LayerControllerContext): void;
  /** Return keys which already exist before a create recreates its identities. */
  getExistingItemKeys?(context: LayerControllerContext, items: TCreateItem[]): DeleteItems;
  createItems?(context: LayerControllerContext, items: TCreateItem[]): void;
  updateItems?(context: LayerControllerContext, items: TUpdateItem[]): void;
  deleteItems?(context: LayerControllerContext, items: DeleteItems): void;
  onDependencyItemsChanged?(context: LayerControllerContext, change: LayerDependencyChange): void;
  onAssetDataReceived?(context: LayerControllerContext, assetId: string): void;
  dispose?(context: LayerControllerContext): void;
}

export interface LayerSceneBounds {
  width: number;
  height: number;
}

export interface LayerMetadataCarrier {
  layerType: string;
  metadata: Record<string, unknown>;
}

export interface LayerViewDefinition {
  getSceneBounds?: (metadata: Record<string, unknown>) => LayerSceneBounds | undefined;
  sceneBoundsPriority?: number;
  viewMetadataPriority?: number;
}

// #region Renderer types
/** The five role names built into the default registry. */
export const BUILTIN_RENDERER_ROLES = ['background', 'grid', 'edge', 'trajectory', 'agent'] as const;
export type BuiltinLayerRendererRole = typeof BUILTIN_RENDERER_ROLES[number];

export interface SnapshotAgentLayerData {
  coordOffset: GridCoordOffset;
  agents: AgentRenderState[];
}

export interface SnapshotTrajectoryLayerData {
  agentLayerId?: string;
  coordOffset: GridCoordOffset;
  config: TrajectoryStorageSnapshot['config'];
  configs: Map<string | number, TrajectoryStorageSnapshot['configs'][number]>;
  trajectories: TrajectoryStorageSnapshot['trajectories'];
}

/**
 * Context provided to LayerRendererDefinition.createLayer.
 * Bridges browser / headless differences in a single interface.
 */
export interface LayerCreateContext {
  /** Edge layers keyed by their linked agent layer id. Populated as layers are created. */
  linkedEdgeLayers: Map<string, { buildDragHandlers(): Record<string, unknown> }>;

  /** Asset URL resolver (browser: this.options.resolveAssetUrl, headless: pre-resolved map). */
  resolveAssetUrl?: (assetId: string) => string | null | undefined;

  /** Whether agent layers should respond to click events. */
  clickable?: boolean;

  /** Optional click handler for agent selection (browser only). */
  onAgentClick?: (agent: unknown) => void;

  /** Optional double-click handler (browser only, for graph-interaction layers). */
  onAgentDoubleClick?: (agent: unknown) => void;

  /** Override scene bounds (e.g. from headless resolveBackgroundBounds fallback). */
  fallbackBackgroundSceneBounds?: Partial<{ width: number; height: number }>;

  /** Show agent labels. */
  showLabel?: boolean;

  /** Optional read-only inspection highlight applied by the agent layer. */
  highlightedAgent?: { layerId: string; agentId: AgentId };

  /** Render graph edges at existing positions without starting a force layout. */
  readOnlyGraphLayout?: boolean;
}

/** Return value of createLayer — abstracts the ILayer interface used by both hosts. */
export interface CreatedLayerEntry {
  key: string;
  role: string;
  layerId: string;
  layer: { destroy(): void; setZIndex?(z: number): void; setSceneBounds?(bounds: LayerSceneBounds): void };
  storage?: AgentStorage;
}

/** Describes an inter-layer dependency that the plan engine can resolve. */
export interface LayerDependencyRule {
  /** The role that this layer depends on. */
  fromRole: string;
  /** What to inject from the depended-upon layer. */
  inject: string;
}

export interface LayerRendererDefinition {
  role: string;
  /**
   * Controls the relative render/reconcile order of this role within the
   * plan layer list. Lower values are processed first. Built-in priorities:
   * background=0, grid=1, edge=2, trajectory=3, agent=4.
   * Omit to append after all built-ins.
   */
  renderOrderPriority?: number;
  getZIndex?(metadata: Record<string, unknown>): number | undefined;
  getCoordOffset?(metadata: Record<string, unknown>): GridCoordOffset;
  /** Whether this layer type uses graph-interaction semantics (float coord, center origin). */
  getUsesGraphInteraction?(metadata: Record<string, unknown>): boolean;
  /** The origin mode for agent positioning. */
  getOriginMode?(metadata: Record<string, unknown>): OriginMode;
  /** Additional fit padding contributed by this layer type. */
  getFitPadding?(metadata: Record<string, unknown>): number | undefined;
  getGraphConfig?(metadata: Record<string, unknown>): GraphEnvConfig;
  getBackgroundSource?(metadata: Record<string, unknown>): unknown;
  getSnapshotGridData?(layer: ScenarioLayerSnapshot): GridEnvData | undefined;
  getSnapshotAgentLayer?(layer: ScenarioLayerSnapshot): SnapshotAgentLayerData | undefined;
  getSnapshotTrajectoryLayer?(layer: ScenarioLayerSnapshot): SnapshotTrajectoryLayerData | undefined;
  getSnapshotEdges?(layer: ScenarioLayerSnapshot): GraphEdge[];
  getSnapshotBackground?(layer: ScenarioLayerSnapshot): BackgroundData | null | undefined;

  /**
   * Factory method to create a visual layer from a RenderLayerPlan.
   * When absent, layer creation falls back to host-specific handling.
   */
  createLayer?(
    plan: RenderLayerPlan,
    context: LayerCreateContext,
  ): CreatedLayerEntry | null;

  /** Declares inter-role dependencies for topological plan ordering. */
  dependencies?: LayerDependencyRule[];
}
// #endregion

export interface LayerTypeDefinition {
  layer_type: string;
  label?: string;
  metadataSchema?: ZodType;
  itemSchema?: ZodType;
  itemDiffSchema?: ZodType;
  primaryKeyFields?: string[];
  requiredDependencyLayerTypes?: string[];
  storageFactory?: (metadata: Record<string, unknown>) => LayerStorage;
  /** Reconstruct a live storage object from a protocol snapshot. */
  fromSnapshot?: (snapshot: ScenarioLayerSnapshot) => LayerStorage;
  controller?: ItemLayerController;
  view?: LayerViewDefinition;
  renderer?: LayerRendererDefinition;
}

export interface LayerValidationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: z.ZodError;
}
// #endregion

export class LayerRegistryClass {
  private readonly defs = new Map<string, LayerTypeDefinition>();

  register(definition: LayerTypeDefinition): void {
    this.defs.set(definition.layer_type, { ...definition });
  }

  get(layerType: string): LayerTypeDefinition | undefined {
    return this.defs.get(layerType);
  }

  has(layerType: string): boolean {
    return this.defs.has(layerType);
  }

  getAll(): LayerTypeDefinition[] {
    return [...this.defs.values()];
  }

  validateMetadata<T = unknown>(layerType: string, data: Record<string, unknown>): LayerValidationResult<T> {
    const schema = this.defs.get(layerType)?.metadataSchema;
    if (!schema) return { success: true, data: data as T };
    const result = schema.safeParse(data);
    return result.success ? { success: true, data: result.data as T } : { success: false, error: result.error };
  }

  validateItem<T = unknown>(layerType: string, item: unknown): LayerValidationResult<T> {
    const schema = this.defs.get(layerType)?.itemSchema;
    if (!schema) return { success: true, data: item as T };
    const result = schema.safeParse(item);
    return result.success ? { success: true, data: result.data as T } : { success: false, error: result.error };
  }

  validateItemDiff<T = unknown>(layerType: string, diff: unknown): LayerValidationResult<T> {
    const schema = this.defs.get(layerType)?.itemDiffSchema;
    if (!schema) return { success: true, data: diff as T };
    const result = schema.safeParse(diff);
    return result.success ? { success: true, data: result.data as T } : { success: false, error: result.error };
  }

  /**
   * Create a visual layer from a RenderLayerPlan by delegating to the
   * registered LayerRendererDefinition.createLayer implementation.
   */
  createLayer(plan: RenderLayerPlan, context: LayerCreateContext): CreatedLayerEntry | null {
    const def = this.findDefinitionForRole(plan.role);
    if (def?.renderer?.createLayer) {
      return def.renderer.createLayer(plan, context);
    }

    return null;
  }

  /**
   * Return layer roles in ascending `renderOrderPriority` order.
   * Roles without a priority are appended last in registration order.
   */
  getRenderOrder(): string[] {
    const withPriority: Array<{ role: string; priority: number }> = [];
    const withoutPriority: string[] = [];

    for (const def of this.defs.values()) {
      const role = def.renderer?.role;
      if (!role) continue;
      const priority = def.renderer!.renderOrderPriority;
      if (priority === undefined) {
        withoutPriority.push(role);
      } else {
        withPriority.push({ role, priority });
      }
    }

    withPriority.sort((a, b) => a.priority - b.priority);
    return [...withPriority.map((e) => e.role), ...withoutPriority];
  }

  /**
   * Find the first LayerTypeDefinition whose renderer role matches the given role.
   * Used to look up the createLayer implementation from the plan's role.
   */
  getDefinitionByRole(role: string): LayerTypeDefinition | undefined {
    return this.findDefinitionForRole(role);
  }

  private findDefinitionForRole(role: string): LayerTypeDefinition | undefined {
    for (const def of this.defs.values()) {
      if (def.renderer?.role === role) {
        return def;
      }
    }
    return undefined;
  }
}

export const layerRegistry = new LayerRegistryClass();

export function registerLayerType(definition: LayerTypeDefinition): void {
  layerRegistry.register(definition);
}

function getLayerPriorityEntries<TLayer extends LayerMetadataCarrier>(
  layers: Iterable<TLayer>,
  registry: LayerRegistryClass,
  getPriority: (definition: LayerTypeDefinition) => number | undefined,
): Array<{ layer: TLayer; definition: LayerTypeDefinition; priority: number; index: number }> {
  const entries = [...layers].map((layer, index) => ({
    layer,
    definition: registry.get(layer.layerType),
    priority: undefined as number | undefined,
    index,
  }));

  return entries
    .map((entry) => ({
      ...entry,
      priority: entry.definition ? getPriority(entry.definition) : undefined,
    }))
    .filter((entry): entry is { layer: TLayer; definition: LayerTypeDefinition; priority: number; index: number } => (
      entry.definition !== undefined && entry.priority !== undefined
    ))
    .sort((left, right) => left.priority - right.priority || left.index - right.index);
}

export function findViewMetadataSource<TLayer extends LayerMetadataCarrier>(
  layers: Iterable<TLayer>,
  registry: LayerRegistryClass = layerRegistry,
): TLayer | undefined {
  return getLayerPriorityEntries(
    layers,
    registry,
    (definition) => definition.view?.viewMetadataPriority,
  )[0]?.layer;
}

export function findSceneBounds<TLayer extends LayerMetadataCarrier>(
  layers: Iterable<TLayer>,
  registry: LayerRegistryClass = layerRegistry,
): LayerSceneBounds | undefined {
  for (const entry of getLayerPriorityEntries(
    layers,
    registry,
    (definition) => definition.view?.sceneBoundsPriority,
  )) {
    const sceneBounds = entry.definition.view?.getSceneBounds?.(entry.layer.metadata ?? {});
    if (sceneBounds) {
      return sceneBounds;
    }
  }

  return undefined;
}

function getInterpolation(value: unknown): 'nearest' | 'linear' {
  return value === 'linear' ? 'linear' : 'nearest';
}

function getCoordOffset(metadata: Record<string, unknown>): GridCoordOffset {
  return metadata.coord_offset === 'float' ? 'float' : 'int';
}

function getUsesGraphInteraction(metadata: Record<string, unknown>): boolean {
  return metadata.uses_graph_interaction === true;
}

function getOriginMode(metadata: Record<string, unknown>): OriginMode {
  return metadata.origin_mode === 'center' ? 'center' : 'bottom-left';
}

function getMetadataSceneBounds(metadata: Record<string, unknown>): LayerSceneBounds | undefined {
  const { width, height } = metadata;
  if (typeof width === 'number' && typeof height === 'number') {
    return { width, height };
  }
  return undefined;
}

function isPrimitiveDeleteItems(items: DeleteItems): items is AgentId[] {
  return items.length > 0 && (typeof items[0] === 'string' || typeof items[0] === 'number');
}

function getAgentIds(items: DeleteItems): AgentId[] | null {
  if (items.length === 0) {
    return [];
  }
  if (isPrimitiveDeleteItems(items)) {
    const ids: AgentId[] = [];
    for (const item of items) {
      if (typeof item !== 'string' && typeof item !== 'number') {
        console.warn('Agent-like delete arrays cannot mix primitive ids and object keys.');
        return null;
      }
      ids.push(item);
    }
    return ids;
  }

  const ids: AgentId[] = [];
  for (const item of items) {
    if (typeof item === 'string' || typeof item === 'number') {
      console.warn('Agent-like delete arrays cannot mix primitive ids and object keys.');
      return null;
    }
    const id = item.id;
    if (typeof id === 'string' || typeof id === 'number') {
      ids.push(id);
    }
  }
  return ids;
}

function getEdgePairs(items: DeleteItems): Array<{ source: AgentId; target: AgentId }> | null {
  if (items.length === 0) {
    return [];
  }
  if (isPrimitiveDeleteItems(items)) {
    console.warn('Edge delete arrays must use object keys with source/target fields.');
    return null;
  }
  for (const item of items) {
    if (typeof item === 'string' || typeof item === 'number') {
      console.warn('Edge delete arrays cannot mix primitive ids and object keys.');
      return null;
    }
  }
  return items as Array<{ source: AgentId; target: AgentId }>;
}

type AgentItem = Readonly<AgentRenderState>;
type AgentItemDiff = Readonly<Partial<AgentRenderState> & { id: AgentId }>;
type EdgeItem = z.infer<typeof EdgeItemSchema>;
type EdgeItemDiff = z.infer<typeof EdgeItemDiffSchema>;
type TrajectoryItem = z.infer<typeof TrajectoryItemSchema>;
type TrajectoryItemDiff = z.infer<typeof TrajectoryItemDiffSchema>;

// #region Built-in renderer helpers
function isAgentStorageSnapshot(value: unknown): value is AgentStorageSnapshot {
  return typeof value === 'object' && value !== null && Array.isArray((value as { agents?: unknown[] }).agents);
}

function isEdgeStorageSnapshot(value: unknown): value is EdgeStorageSnapshot {
  return typeof value === 'object' && value !== null && Array.isArray((value as { edges?: unknown[] }).edges);
}

function isTrajectoryStorageSnapshot(value: unknown): value is TrajectoryStorageSnapshot {
  return (
    typeof value === 'object'
    && value !== null
    && Array.isArray((value as { configs?: unknown[] }).configs)
    && Array.isArray((value as { trajectories?: unknown[] }).trajectories)
  );
}

function isBackgroundData(value: unknown): value is BackgroundData {
  return (
    value === null
    || (
      typeof value === 'object'
      && value !== null
      && 'kind' in value
      && (value as { kind?: unknown }).kind !== undefined
    )
  );
}

function getBackgroundSource(metadata: Record<string, unknown>): unknown {
  return typeof metadata.background !== 'undefined' ? metadata.background : undefined;
}

function getSnapshotGridData(layer: ScenarioLayerSnapshot): GridEnvData | undefined {
  return layer.layerType === 'grid' ? structuredClone(layer.metadata as GridEnvData) : undefined;
}

function getSnapshotAgentLayer(layer: ScenarioLayerSnapshot): SnapshotAgentLayerData | undefined {
  if (!isAgentStorageSnapshot(layer.storageSnapshot)) {
    return undefined;
  }

  return {
    coordOffset: getCoordOffset(layer.metadata),
    agents: layer.storageSnapshot.agents.map((agent) => ({ ...agent })),
  };
}

function getSnapshotTrajectoryLayer(layer: ScenarioLayerSnapshot): SnapshotTrajectoryLayerData | undefined {
  if (!isTrajectoryStorageSnapshot(layer.storageSnapshot)) {
    return undefined;
  }

  return {
    agentLayerId: typeof layer.dependencyLayerIds?.agent === 'string' ? layer.dependencyLayerIds.agent : undefined,
    coordOffset: getCoordOffset(layer.metadata),
    config: { ...layer.storageSnapshot.config },
    configs: new Map(layer.storageSnapshot.configs.map((config) => [config.id, { ...config }])),
    trajectories: layer.storageSnapshot.trajectories.map((trajectory) => ({
      id: trajectory.id,
      points: trajectory.points.map((point) => ({ ...point })),
    })),
  };
}

function getSnapshotEdges(layer: ScenarioLayerSnapshot): GraphEdge[] {
  const metadata = (layer.metadata ?? {}) as Record<string, unknown>;
  const edgesFromStorage = isEdgeStorageSnapshot(layer.storageSnapshot)
    ? layer.storageSnapshot.edges.map((edge) => ({ ...edge })) as GraphEdge[]
    : [];
  const edgesFromMetadata = Array.isArray((metadata as { edges?: unknown[] }).edges)
    ? (metadata as { edges: GraphEdge[] }).edges.map((edge) => ({ ...edge }))
    : [];
  return [...edgesFromStorage, ...edgesFromMetadata];
}

function getSnapshotBackground(layer: ScenarioLayerSnapshot): BackgroundData | null | undefined {
  return isBackgroundData(layer.storageSnapshot) ? layer.storageSnapshot : undefined;
}
// #endregion

// #region Built-in controllers
const agentLayerController: ItemLayerController<AgentItem, AgentItemDiff> = {
  getExistingItemKeys: (context, items) => {
    const storage = context.requireStorage(AgentStorage, 'agent');
    return items.filter((item) => storage.hasAgent(item.id)).map((item) => item.id);
  },
  createItems: (context, items) => {
    context.requireStorage(AgentStorage, 'agent').addAgents(items);
  },
  updateItems: (context, items) => {
    context.requireStorage(AgentStorage, 'agent').updateAgents(items);
  },
  deleteItems: (context, items) => {
    const ids = getAgentIds(items);
    if (!ids) {
      return;
    }
    context.requireStorage(AgentStorage, 'agent').removeAgents(ids);
  },
  onAssetDataReceived: (context, assetId) => {
    const storage = context.requireStorage(AgentStorage, 'agent');
    const affectedAgents = [...storage.getData().agents.values()]
      .filter((agent) => getAssetIdFromIcon(agent.icon) === assetId)
      .map((agent) => ({ id: agent.id, icon: agent.icon }));

    if (affectedAgents.length === 0) {
      return;
    }

    // Re-emit matching agents so AgentLayer re-resolves asset URLs once data arrives.
    storage.updateAgents(affectedAgents);
  },
};

const edgeLayerController: ItemLayerController<EdgeItem, EdgeItemDiff> = {
  getExistingItemKeys: (context, items) => {
    const storage = context.requireStorage(EdgeStorage, 'edge');
    return items
      .filter((item) => storage.findEdge(item.source, item.target))
      .map((item) => ({ source: item.source, target: item.target }));
  },
  createItems: (context, items) => {
    context.requireStorage(EdgeStorage, 'edge').addEdges(items);
  },
  updateItems: (context, items) => {
    context.requireStorage(EdgeStorage, 'edge').updateEdges(items);
  },
  deleteItems: (context, items) => {
    const edgePairs = getEdgePairs(items);
    if (!edgePairs) {
      return;
    }
    context.requireStorage(EdgeStorage, 'edge').removeEdgePairs(edgePairs as any[]);
  },
};

const trajectoryLayerController: ItemLayerController<TrajectoryItem, TrajectoryItemDiff> = {
  applyMetadata: (context) => {
    const storage = context.requireStorage(TrajectoryStorage, 'trajectory');
    storage.setConfig({
      length: typeof context.layer.metadata.length === 'number' ? context.layer.metadata.length : undefined,
      width: typeof context.layer.metadata.width === 'number' ? context.layer.metadata.width : undefined,
      color: typeof context.layer.metadata.color === 'string' ? context.layer.metadata.color : undefined,
    });

    const agentLayerId = context.layer.dependencyLayerIds.agent;
    const sourceLayer = typeof agentLayerId === 'string'
      ? context.environment.layers.get(agentLayerId)
      : undefined;
    if (!(sourceLayer?.storage instanceof AgentStorage)) {
      return;
    }

    // A state-sync is a replay of already-known simulator state, not model
    // movement. Backfilling here would manufacture new trajectory samples on
    // every reconnect.
    if (context.isStateSync) {
      return;
    }

    const time = typeof context.time === 'number' ? context.time : 0;
    for (const agent of sourceLayer.storage.getData().agents.values()) {
      if (storage.getEntry(agent.id) || agent.x === undefined || agent.y === undefined) {
        continue;
      }
      const point: TrajectoryPoint = { x: agent.x, y: agent.y, time };
      storage.appendTrajectoryPoint(agent.id, point);
    }
  },
  getExistingItemKeys: (context, items) => {
    const storage = context.requireStorage(TrajectoryStorage, 'trajectory');
    const { configs } = storage.getData();
    return items
      .filter((item) => configs.has(item.id) || storage.getEntry(item.id) !== undefined)
      .map((item) => item.id);
  },
  createItems: (context, items) => {
    context.requireStorage(TrajectoryStorage, 'trajectory').upsertConfigs(items);
  },
  updateItems: (context, items) => {
    context.requireStorage(TrajectoryStorage, 'trajectory').upsertConfigs(items);
  },
  deleteItems: (context, items) => {
    const ids = getAgentIds(items);
    if (!ids) {
      return;
    }
    context.requireStorage(TrajectoryStorage, 'trajectory').deleteItems(ids);
  },
  onDependencyItemsChanged: (context, change) => {
    const storage = context.requireStorage(TrajectoryStorage, 'trajectory');
    if (change.kind === 'delete') {
      const ids = getAgentIds(change.items as DeleteItems);
      if (!ids) {
        return;
      }
      const lifecycle = resolveTrajectoryLifecycle(context.layer.metadata);
      if (lifecycle.onAgentDelete === 'retain') {
        storage.closeTrajectories(ids);
      } else {
        storage.deleteItems(ids);
      }
      return;
    }
    if ((change.kind !== 'create' && change.kind !== 'update') || !(change.sourceLayer.storage instanceof AgentStorage)) {
      return;
    }

    if (context.isStateSync) {
      return;
    }

    const time = typeof context.time === 'number' ? context.time : 0;
    for (const item of change.items) {
      const id = item.id;
      if (typeof id !== 'string' && typeof id !== 'number') {
        continue;
      }
      const agent = change.sourceLayer.storage.getAgent(id);
      if (!agent || agent.x === undefined || agent.y === undefined) {
        continue;
      }
      const point: TrajectoryPoint = { x: agent.x, y: agent.y, time };
      storage.appendTrajectoryPoint(id, point);
    }
  },
};

const gridLayerController: ItemLayerController = {
  applyMetadata: (context) => {
    context.requireStorage(GridEnvStorage, 'grid').setData(structuredClone(context.layer.metadata));
  },
};

const backgroundLayerController: ItemLayerController = {
  applyMetadata: (context) => {
    const { background, interpolation: metadataInterpolation } = context.layer.metadata;
    const storage = context.requireStorage(BackgroundStorage, 'background');
    const interpolation = getInterpolation(metadataInterpolation);
    if (
      typeof background === 'string'
      || background instanceof Uint8Array
      || background === undefined
      || background === null
    ) {
      void storage.setBackground(background ?? undefined, interpolation);
      return;
    }
    if (isBackgroundAssetReference(background)) {
      storage.setBackgroundUrl(context.assets.getUrl(background.asset_id), interpolation);
    }
  },
  onAssetDataReceived: (context, assetId) => {
    const background = context.layer.metadata.background;
    if (!isBackgroundAssetReference(background) || background.asset_id !== assetId) {
      return;
    }
    const interpolation = getInterpolation(
      background.interpolation ?? context.layer.metadata.interpolation,
    );
    context.requireStorage(BackgroundStorage, 'background').setBackgroundUrl(
      context.assets.getUrl(assetId),
      interpolation,
    );
  },
  dispose: (context) => {
    context.requireStorage(BackgroundStorage, 'background').destroy();
  },
};
// #endregion

// #region Built-in createLayer factories
import { AgentLayer, BackgroundLayer, EdgeLayer, GridLayer, TrajectoryLayer } from '../environment/layers';
import type {
  AgentLayerPlan,
  BackgroundLayerPlan,
  EdgeLayerPlan,
  GridLayerPlan,
  TrajectoryLayerPlan,
} from './render-plan';
// #endregion

function createBackgroundLayerFromPlan(
  plan: BackgroundLayerPlan,
  context: LayerCreateContext,
): CreatedLayerEntry {
  const sceneBounds = plan.sceneBounds
    ? { sceneBounds: plan.sceneBounds }
    : context.fallbackBackgroundSceneBounds
      ? { sceneBounds: context.fallbackBackgroundSceneBounds as LayerSceneBounds }
      : undefined;
  const layer = new BackgroundLayer(plan.storage, sceneBounds);
  if (plan.zIndex !== undefined) {
    layer.setZIndex(plan.zIndex);
  }

  return {
    key: plan.key,
    role: plan.role,
    layerId: plan.layerId,
    layer,
  };
}

function createGridLayerFromPlan(plan: GridLayerPlan): CreatedLayerEntry {
  const layer = new GridLayer(plan.storage);
  if (plan.zIndex !== undefined) {
    layer.setZIndex(plan.zIndex);
  }

  return {
    key: plan.key,
    role: plan.role,
    layerId: plan.layerId,
    layer,
  };
}

function createEdgeLayerFromPlan(
  plan: EdgeLayerPlan,
  context: LayerCreateContext,
): CreatedLayerEntry {
  const layer = new EdgeLayer(plan.storage, plan.agentStorage, {
    ...plan.config,
    readOnlyLayout: context.readOnlyGraphLayout,
  });
  if (plan.zIndex !== undefined) {
    layer.setZIndex(plan.zIndex);
  }
  // Register the edge layer so agent layers can find it for drag handlers
  context.linkedEdgeLayers.set(plan.agentLayerId, layer);

  return {
    key: plan.key,
    role: plan.role,
    layerId: plan.layerId,
    layer,
  };
}

function createTrajectoryLayerFromPlan(plan: TrajectoryLayerPlan): CreatedLayerEntry {
  const layer = new TrajectoryLayer(plan.storage, {
    coordOffset: plan.coordOffset,
    worldBounds: plan.worldBounds,
  });
  layer.setZIndex(plan.zIndex);

  return {
    key: plan.key,
    role: plan.role,
    layerId: plan.layerId,
    layer,
  };
}

function createAgentLayerFromPlan(
  plan: AgentLayerPlan,
  context: LayerCreateContext,
): CreatedLayerEntry {
  const linkedEdgeLayer = context.linkedEdgeLayers.get(plan.layerId);
  const layer = new AgentLayer(plan.storage, {
    ...(linkedEdgeLayer ? linkedEdgeLayer.buildDragHandlers() : {}),
    clickable: context.clickable ?? false,
    draggable: plan.usesGraphInteraction && !context.readOnlyGraphLayout,
    showLabel: context.showLabel ?? false,
    originMode: plan.originMode,
    coordOffset: plan.coordOffset,
    sceneBounds: plan.sceneBounds,
    resolveAssetUrl: context.resolveAssetUrl as ((assetId: string) => string | null) | undefined,
    highlightedAgentId: context.highlightedAgent?.layerId === plan.layerId
      ? context.highlightedAgent.agentId
      : undefined,
    onAgentClick: context.onAgentClick,
    onAgentDoubleClick: context.onAgentDoubleClick,
  });
  layer.setZIndex(plan.zIndex);

  return {
    key: plan.key,
    role: plan.role,
    layerId: plan.layerId,
    layer,
    storage: plan.storage,
  };
}
// #endregion

// #region Built-in layer registrations
// Each built-in registration includes:
//   - renderOrderPriority (drives getRenderOrder / host reconcile order)
//   - fromSnapshot (drives registry-based createLayerStorage in utils/plan.ts)
//   - dependencies (documents inter-role plan dependencies)

registerLayerType({
  layer_type: 'agent',
  label: 'Agent Layer',
  metadataSchema: AgentLayerMetadataSchema,
  itemSchema: AgentItemSchema,
  itemDiffSchema: AgentItemDiffSchema,
  primaryKeyFields: ['id'],
  storageFactory: (_metadata) => new AgentStorage(),
  fromSnapshot: (layer) => {
    const storage = new AgentStorage();
    storage.load(structuredClone(layer.storageSnapshot ?? {}));
    return storage;
  },
  controller: agentLayerController,
  view: {
    getSceneBounds: getMetadataSceneBounds,
    sceneBoundsPriority: 10,
  },
  renderer: {
    role: 'agent',
    renderOrderPriority: 4,
    getZIndex: (metadata) => typeof metadata.z_index === 'number' ? metadata.z_index : undefined,
    getCoordOffset,
    getUsesGraphInteraction,
    getOriginMode,
    getSnapshotAgentLayer,
    createLayer: (plan, context) => {
      if (plan.role !== 'agent') return null;
      return createAgentLayerFromPlan(plan as AgentLayerPlan, context);
    },
    dependencies: [{ fromRole: 'edge', inject: 'dragHandlers' }],
  },
});

registerLayerType({
  layer_type: 'edge',
  label: 'Edge Layer',
  metadataSchema: EdgeLayerMetadataSchema,
  itemSchema: EdgeItemSchema,
  itemDiffSchema: EdgeItemDiffSchema,
  primaryKeyFields: ['source', 'target'],
  requiredDependencyLayerTypes: ['agent'],
  storageFactory: (_metadata) => new EdgeStorage(),
  fromSnapshot: (layer) => {
    const storage = new EdgeStorage();
    const edgesFromStorage = isEdgeStorageSnapshot(layer.storageSnapshot)
      ? layer.storageSnapshot.edges.map((e) => structuredClone(e as GraphEdge))
      : [];
    const metadata = (layer.metadata ?? {}) as Record<string, unknown>;
    const edgesFromMetadata = Array.isArray(metadata.edges)
      ? (metadata.edges as GraphEdge[]).map((e) => structuredClone(e))
      : [];
    storage.setEdges([...edgesFromStorage, ...edgesFromMetadata]);
    return storage;
  },
  controller: edgeLayerController,
  renderer: {
    role: 'edge',
    renderOrderPriority: 2,
    getZIndex: (metadata) => typeof metadata.z_index === 'number' ? metadata.z_index : undefined,
    getGraphConfig: (metadata) => metadata as GraphEnvConfig,
    getSnapshotEdges,
    getFitPadding: () => 0.05,
    createLayer: (plan, context) => {
      if (plan.role !== 'edge') return null;
      return createEdgeLayerFromPlan(plan as EdgeLayerPlan, context);
    },
    dependencies: [{ fromRole: 'agent', inject: 'agentStorage' }],
  },
});

registerLayerType({
  layer_type: 'trajectory',
  label: 'Trajectory Layer',
  metadataSchema: TrajectoryLayerMetadataSchema,
  itemSchema: TrajectoryItemSchema,
  itemDiffSchema: TrajectoryItemDiffSchema,
  primaryKeyFields: ['id'],
  requiredDependencyLayerTypes: ['agent'],
  storageFactory: (metadata) => new TrajectoryStorage(metadata as any),
  fromSnapshot: (layer) => {
    const storage = new TrajectoryStorage();
    storage.load(structuredClone(layer.storageSnapshot ?? {}));
    return storage;
  },
  controller: trajectoryLayerController,
  renderer: {
    role: 'trajectory',
    renderOrderPriority: 3,
    getZIndex: (metadata) => typeof metadata.z_index === 'number' ? metadata.z_index : undefined,
    getCoordOffset,
    getSnapshotTrajectoryLayer,
    createLayer: (plan, _context) => {
      if (plan.role !== 'trajectory') return null;
      return createTrajectoryLayerFromPlan(plan as TrajectoryLayerPlan);
    },
    dependencies: [{ fromRole: 'agent', inject: 'agentMetadata' }],
  },
});

registerLayerType({
  layer_type: 'grid',
  label: 'Grid Layer',
  metadataSchema: GridLayerMetadataSchema,
  storageFactory: (metadata) => new GridEnvStorage(metadata as any),
  fromSnapshot: (layer) => {
    const storage = new GridEnvStorage();
    const merged: Record<string, unknown> = {
      ...(typeof layer.metadata === 'object' && layer.metadata !== null ? layer.metadata as Record<string, unknown> : {}),
      ...(typeof layer.storageSnapshot === 'object' && layer.storageSnapshot !== null && !Array.isArray(layer.storageSnapshot)
        ? layer.storageSnapshot as Record<string, unknown>
        : {}),
    };
    storage.setData(structuredClone(merged));
    return storage;
  },
  controller: gridLayerController,
  view: {
    getSceneBounds: getMetadataSceneBounds,
    sceneBoundsPriority: 0,
    viewMetadataPriority: 0,
  },
  renderer: {
    role: 'grid',
    renderOrderPriority: 1,
    getZIndex: (metadata) => typeof metadata.z_index === 'number' ? metadata.z_index : undefined,
    getSnapshotGridData,
    createLayer: (plan, _context) => {
      if (plan.role !== 'grid') return null;
      return createGridLayerFromPlan(plan as GridLayerPlan);
    },
  },
});

registerLayerType({
  layer_type: 'background',
  label: 'Background Layer',
  metadataSchema: BackgroundLayerMetadataSchema,
  storageFactory: (_metadata) => new BackgroundStorage(),
  fromSnapshot: (layer) => {
    const storage = new BackgroundStorage();
    storage.setData(isBackgroundData(layer.storageSnapshot) ? structuredClone(layer.storageSnapshot) : null);
    return storage;
  },
  controller: backgroundLayerController,
  renderer: {
    role: 'background',
    renderOrderPriority: 0,
    getZIndex: (metadata) => typeof metadata.z_index === 'number' ? metadata.z_index : undefined,
    getBackgroundSource,
    getSnapshotBackground,
    createLayer: (plan, context) => {
      if (plan.role !== 'background') return null;
      return createBackgroundLayerFromPlan(plan as BackgroundLayerPlan, context);
    },
  },
});
// #endregion
