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

export interface ItemLayerController {
  applyMetadata?(context: LayerControllerContext): void;
  createItems?(context: LayerControllerContext, items: Record<string, unknown>[]): void;
  updateItems?(context: LayerControllerContext, items: Record<string, unknown>[]): void;
  deleteItems?(context: LayerControllerContext, items: DeleteItems): void;
  onDependencyItemsChanged?(context: LayerControllerContext, change: LayerDependencyChange): void;
  onAssetDataReceived?(context: LayerControllerContext, assetId: string): void;
  dispose?(context: LayerControllerContext): void;
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
}

export interface LayerValidationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: z.ZodError;
}

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

function getInterpolation(value: unknown): 'nearest' | 'linear' {
  return value === 'linear' ? 'linear' : 'nearest';
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

const agentLayerController: ItemLayerController = {
  createItems: (context, items) => {
    context.requireStorage(AgentStorage, 'agent').addAgents(items as any[]);
  },
  updateItems: (context, items) => {
    context.requireStorage(AgentStorage, 'agent').updateAgents(items as any[]);
  },
  deleteItems: (context, items) => {
    const ids = getAgentIds(items);
    if (!ids) {
      return;
    }
    context.requireStorage(AgentStorage, 'agent').removeAgents(ids);
  },
};

const edgeLayerController: ItemLayerController = {
  createItems: (context, items) => {
    context.requireStorage(EdgeStorage, 'edge').addEdges(items as any[]);
  },
  updateItems: (context, items) => {
    context.requireStorage(EdgeStorage, 'edge').updateEdges(items as any[]);
  },
  deleteItems: (context, items) => {
    const edgePairs = getEdgePairs(items);
    if (!edgePairs) {
      return;
    }
    context.requireStorage(EdgeStorage, 'edge').removeEdgePairs(edgePairs as any[]);
  },
};

const trajectoryLayerController: ItemLayerController = {
  applyMetadata: (context) => {
    context.requireStorage(TrajectoryStorage, 'trajectory').setConfig({
      length: typeof context.layer.metadata.length === 'number' ? context.layer.metadata.length : undefined,
      width: typeof context.layer.metadata.width === 'number' ? context.layer.metadata.width : undefined,
      color: typeof context.layer.metadata.color === 'string' ? context.layer.metadata.color : undefined,
    });
  },
  createItems: (context, items) => {
    context.requireStorage(TrajectoryStorage, 'trajectory').upsertConfigs(items as any[]);
  },
  updateItems: (context, items) => {
    context.requireStorage(TrajectoryStorage, 'trajectory').upsertConfigs(items as any[]);
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
    if (change.kind !== 'update' || !(change.sourceLayer.storage instanceof AgentStorage)) {
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
    const storage = context.requireStorage(BackgroundStorage, 'background');
    const background = context.layer.metadata.background;
    const interpolation = getInterpolation(context.layer.metadata.interpolation);
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

const DependencyLayerIdsSchema = z.record(z.string(), z.string());

const BaseLayerMetadataSchema = z.object({
  dependency_layer_ids: DependencyLayerIdsSchema.optional(),
  z_index: z.number().optional(),
}).loose();

const AgentLayerMetadataSchema = BaseLayerMetadataSchema.extend({
  width: z.number().optional(),
  height: z.number().optional(),
  coord_offset: z.enum(['int', 'float']).optional(),
}).loose();

const EdgeLayerMetadataSchema = BaseLayerMetadataSchema.extend({
  linkDistance: z.number().optional(),
  chargeStrength: z.number().optional(),
  centeringStrength: z.number().optional(),
  collisionRadius: z.number().optional(),
  maxComponentDistance: z.number().optional(),
  componentSpacing: z.number().optional(),
}).loose();

const GridLayerMetadataSchema = BaseLayerMetadataSchema.extend({
  xOrigin: z.number().optional(),
  xUnit: z.number().optional(),
  xInterval: z.number().optional(),
  xRatio: z.number().int().min(2).optional(),
  yOrigin: z.number().optional(),
  yUnit: z.number().optional(),
  yInterval: z.number().optional(),
  yRatio: z.number().int().min(2).optional(),
  strokeColor: z.string().optional(),
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

export {
  BackgroundAssetReferenceSchema,
  BackgroundInterpolationSchema,
  BackgroundLayerMetadataSchema,
  BackgroundSourceSchema,
};

registerLayerType({
  layer_type: 'agent',
  label: 'Agent Layer',
  metadataSchema: AgentLayerMetadataSchema,
  itemSchema: AgentSchema,
  itemDiffSchema: AgentDiffSchema,
  primaryKeyFields: ['id'],
  storageFactory: (_metadata) => new AgentStorage(),
  controller: agentLayerController,
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
});

registerLayerType({
  layer_type: 'background',
  label: 'Background Layer',
  metadataSchema: BackgroundLayerMetadataSchema,
  storageFactory: (_metadata) => new BackgroundStorage(),
  controller: backgroundLayerController,
});