import { z, ZodType } from 'zod';
import type { AssetStore } from '../asset';
import type { AgentId, TrajectoryPoint } from '../environment';
import type { ItemDeletePayload } from '../protocol';
import {
  AgentStorage,
  BackgroundStorage,
  EdgeStorage,
  GridEnvStorage,
} from '../environment/storages';
import type { RenderableAgent } from '../environment/storages';
import { TrajectoryStorage } from '../environment/storages/TrajectoryStorage';
import {
  BackgroundAssetReferenceSchema,
  BackgroundInterpolationSchema,
  BackgroundSourceSchema,
  isBackgroundAssetReference,
} from '../environment/types';
import {
  AgentDiffSchema,
  AgentSchema,
  EdgeDataSchema,
  EdgeDiffSchema,
  TrajectoryConfigDiffSchema,
  TrajectoryConfigSchema,
} from '../protocol';
import type { ScenarioEnvironmentState, ScenarioLayerState } from './types';

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

export interface LayerTypeDefinition {
  layer_type: string;
  label?: string;
  metadataSchema?: ZodType;
  itemSchema?: ZodType;
  itemDiffSchema?: ZodType;
  primaryKeyFields?: string[];
  requiredDependencyLayerTypes?: string[];
  storageFactory?: (metadata: Record<string, unknown>) => LayerStorage;
  controller?: ItemLayerController;
  view?: LayerViewDefinition;
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

type AgentItem = Readonly<RenderableAgent>;
type AgentItemDiff = Readonly<Partial<RenderableAgent> & { id: AgentId }>;
type EdgeItem = z.infer<typeof EdgeDataSchema>;
type EdgeItemDiff = z.infer<typeof EdgeDiffSchema>;
type TrajectoryItem = z.infer<typeof TrajectoryConfigSchema>;
type TrajectoryItemDiff = z.infer<typeof TrajectoryConfigDiffSchema>;

// #region Built-in controllers
const agentLayerController: ItemLayerController<AgentItem, AgentItemDiff> = {
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
};

const edgeLayerController: ItemLayerController<EdgeItem, EdgeItemDiff> = {
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

    const time = typeof context.time === 'number' ? context.time : 0;
    for (const agent of sourceLayer.storage.getData().agents.values()) {
      if (storage.getEntry(agent.id) || agent.x === undefined || agent.y === undefined) {
        continue;
      }
      const point: TrajectoryPoint = { x: agent.x, y: agent.y, time };
      storage.appendTrajectoryPoint(agent.id, point);
    }
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
      const ids = getAgentIds(change.items);
      if (!ids) {
        return;
      }
      storage.deleteItems(ids);
      return;
    }
    if ((change.kind !== 'create' && change.kind !== 'update') || !(change.sourceLayer.storage instanceof AgentStorage)) {
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

// #region Built-in metadata schemas
const BaseLayerMetadataSchema = z.object({
  dependency_layer_ids: z.never().optional(),
  z_index: z.number().optional(),
}).loose();

const AgentLayerMetadataSchema = BaseLayerMetadataSchema.extend({
  width: z.number().optional(),
  height: z.number().optional(),
  coord_offset: z.enum(['int', 'float']).optional(),
}).loose();

const EdgeLayerMetadataSchema = BaseLayerMetadataSchema.extend({
  link_distance: z.number().optional(),
  charge_strength: z.number().optional(),
  centering_strength: z.number().optional(),
  collision_radius: z.number().optional(),
  max_component_distance: z.number().optional(),
  component_spacing: z.number().optional(),
}).loose();

const GridLayerMetadataSchema = BaseLayerMetadataSchema.extend({
  width: z.number().optional(),
  height: z.number().optional(),
  x_origin: z.number().optional(),
  x_unit: z.number().optional(),
  x_interval: z.number().optional(),
  x_ratio: z.number().int().min(2).optional(),
  y_origin: z.number().optional(),
  y_unit: z.number().optional(),
  y_interval: z.number().optional(),
  y_ratio: z.number().int().min(2).optional(),
  stroke_color: z.string().optional(),
}).loose();

const TrajectoryLayerMetadataSchema = BaseLayerMetadataSchema.extend({
  length: z.number().optional(),
  width: z.number().optional(),
  color: z.string().optional(),
}).loose();

const BackgroundLayerMetadataSchema = BaseLayerMetadataSchema.extend({
  background: BackgroundSourceSchema.optional(),
  interpolation: BackgroundInterpolationSchema.optional(),
}).loose();
// #endregion

export {
  BackgroundAssetReferenceSchema,
  BackgroundInterpolationSchema,
  BackgroundLayerMetadataSchema,
  BackgroundSourceSchema,
};

// #region Built-in layer registrations
registerLayerType({
  layer_type: 'agent',
  label: 'Agent Layer',
  metadataSchema: AgentLayerMetadataSchema,
  itemSchema: AgentSchema,
  itemDiffSchema: AgentDiffSchema,
  primaryKeyFields: ['id'],
  storageFactory: (_metadata) => new AgentStorage(),
  controller: agentLayerController,
  view: {
    getSceneBounds: getMetadataSceneBounds,
    sceneBoundsPriority: 10,
  },
});

registerLayerType({
  layer_type: 'edge',
  label: 'Edge Layer',
  metadataSchema: EdgeLayerMetadataSchema,
  itemSchema: EdgeDataSchema,
  itemDiffSchema: EdgeDiffSchema,
  primaryKeyFields: ['source', 'target'],
  requiredDependencyLayerTypes: ['agent'],
  storageFactory: (_metadata) => new EdgeStorage(),
  controller: edgeLayerController,
});

registerLayerType({
  layer_type: 'trajectory',
  label: 'Trajectory Layer',
  metadataSchema: TrajectoryLayerMetadataSchema,
  itemSchema: TrajectoryConfigSchema,
  itemDiffSchema: TrajectoryConfigDiffSchema,
  primaryKeyFields: ['id'],
  requiredDependencyLayerTypes: ['agent'],
  storageFactory: (metadata) => new TrajectoryStorage(metadata as any),
  controller: trajectoryLayerController,
});

registerLayerType({
  layer_type: 'grid',
  label: 'Grid Layer',
  metadataSchema: GridLayerMetadataSchema,
  storageFactory: (metadata) => new GridEnvStorage(metadata as any),
  controller: gridLayerController,
  view: {
    getSceneBounds: getMetadataSceneBounds,
    sceneBoundsPriority: 0,
    viewMetadataPriority: 0,
  },
});

registerLayerType({
  layer_type: 'background',
  label: 'Background Layer',
  metadataSchema: BackgroundLayerMetadataSchema,
  storageFactory: (_metadata) => new BackgroundStorage(),
  controller: backgroundLayerController,
});
// #endregion