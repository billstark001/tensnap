import { z, ZodType } from 'zod';
import { AgentStorage, BackgroundStorage, EdgeStorage, GridEnvStorage } from '../environment/storages';
import {
  BackgroundAssetReferenceSchema,
  BackgroundInterpolationSchema,
  BackgroundSourceSchema,
} from '../environment/types';
import { AgentDiffSchema, AgentSchema, EdgeDataSchema, EdgeDiffSchema } from '../protocol';

export interface LayerStorage {
  dump(): unknown;
  load(snapshot: unknown): void;
}

export interface LayerTypeDefinition {
  layer_type: string;
  label?: string;
  metadataSchema?: ZodType;
  entitySchema?: ZodType;
  entityDiffSchema?: ZodType;
  storageFactory?: (metadata: Record<string, unknown>) => LayerStorage;
  hasAgents?: boolean;
  hasEdges?: boolean;
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

  validateEntity<T = unknown>(layerType: string, entity: unknown): LayerValidationResult<T> {
    const schema = this.defs.get(layerType)?.entitySchema;
    if (!schema) return { success: true, data: entity as T };
    const result = schema.safeParse(entity);
    return result.success ? { success: true, data: result.data as T } : { success: false, error: result.error };
  }

  validateEntityDiff<T = unknown>(layerType: string, diff: unknown): LayerValidationResult<T> {
    const schema = this.defs.get(layerType)?.entityDiffSchema;
    if (!schema) return { success: true, data: diff as T };
    const result = schema.safeParse(diff);
    return result.success ? { success: true, data: result.data as T } : { success: false, error: result.error };
  }
}

export const layerRegistry = new LayerRegistryClass();

export function registerLayerType(definition: LayerTypeDefinition): void {
  layerRegistry.register(definition);
}

const AgentLayerMetadataSchema = z.object({
  width: z.number().optional(),
  height: z.number().optional(),
  coord_offset: z.enum(['int', 'float']).optional(),
  trajectory_length: z.number().optional(),
  trajectory_color: z.string().optional(),
}).loose();

const EdgeLayerMetadataSchema = z.object({
  linkDistance: z.number().optional(),
  chargeStrength: z.number().optional(),
  centeringStrength: z.number().optional(),
  collisionRadius: z.number().optional(),
  maxComponentDistance: z.number().optional(),
  componentSpacing: z.number().optional(),
}).loose();

const GridLayerMetadataSchema = z.object({
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

const BackgroundLayerMetadataSchema = z.object({
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
  entitySchema: AgentSchema,
  entityDiffSchema: AgentDiffSchema,
  storageFactory: (_metadata) => new AgentStorage(),
  hasAgents: true,
});

registerLayerType({
  layer_type: 'edge',
  label: 'Edge Layer',
  metadataSchema: EdgeLayerMetadataSchema,
  entitySchema: EdgeDataSchema,
  entityDiffSchema: EdgeDiffSchema,
  storageFactory: (_metadata) => new EdgeStorage(),
  hasEdges: true,
});

registerLayerType({
  layer_type: 'grid',
  label: 'Grid Layer',
  metadataSchema: GridLayerMetadataSchema,
  storageFactory: (metadata) => new GridEnvStorage(metadata as any),
});

registerLayerType({
  layer_type: 'background',
  label: 'Background Layer',
  metadataSchema: BackgroundLayerMetadataSchema,
  storageFactory: (_metadata) => new BackgroundStorage(),
});