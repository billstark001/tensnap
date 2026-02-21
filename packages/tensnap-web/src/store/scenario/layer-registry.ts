/**
 * store/scenario/layer-registry.ts
 *
 * Layer Registry — maps layer_type strings to their metadata and entity schemas.
 *
 * Third-party code can extend the registry via `registerLayerType()`.
 * All four built-in layer types are registered at module load time.
 *
 * Usage
 * ─────
 *   import { layerRegistry, registerLayerType } from '@/store/scenario/layer-registry';
 *
 *   // Register a custom layer type
 *   registerLayerType({
 *     layer_type: 'heatmap',
 *     label: 'Heatmap Layer',
 *     metadataSchema: z.object({ colormap: z.string().optional() }).passthrough(),
 *   });
 *
 *   // Validate incoming layer metadata
 *   const result = layerRegistry.validateMetadata('heatmap', payload.data ?? {});
 *   if (!result.success) console.warn('Invalid heatmap metadata', result.error);
 */

import { z, ZodType } from 'zod';
import { AgentSchema, AgentDiffSchema, EdgeDataSchema, EdgeDiffSchema } from '@/types/api-schemas';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Definition of a single registered layer type.
 *
 * All fields except `layer_type` are optional; unknown layer types are allowed
 * at runtime so that the frontend can display them even without a schema.
 */
export interface LayerTypeDefinition {
  /**
   * Unique string identifier — e.g. `"agent"`, `"edge"`, `"grid"`, `"background"`.
   * Must match the `layer_type` field in `env_layer_create` / `env_layer_update`.
   */
  layer_type: string;

  /** Human-readable label shown in the UI. */
  label?: string;

  /**
   * Zod schema for the `data` field carried by
   * `env_layer_create` and `env_layer_update`.
   * Validation is advisory; malformed data is accepted with a warning.
   */
  metadataSchema?: ZodType;

  /**
   * Zod schema for full entity objects received via
   * `agent_create` or `edge_create`.
   * Only needed for layer types that manage large entity collections.
   */
  entitySchema?: ZodType;

  /**
   * Zod schema for entity diff objects received via
   * `agent_update` or `edge_update`.
   */
  entityDiffSchema?: ZodType;

  /**
   * Whether this layer type carries agent entities.
   * The store uses this to enable per-layer agent tracking.
   * Default: false.
   */
  hasAgents?: boolean;

  /**
   * Whether this layer type carries edge entities.
   * The store uses this to enable per-layer edge tracking.
   * Default: false.
   */
  hasEdges?: boolean;
}

/** Validation result returned by `layerRegistry.validateMetadata` / `validateEntity`. */
export interface LayerValidationResult<T = any> {
  success: boolean;
  data?: T;
  error?: z.ZodError;
}

// ---------------------------------------------------------------------------
// LayerRegistryClass
// ---------------------------------------------------------------------------

export class LayerRegistryClass {
  private _defs = new Map<string, LayerTypeDefinition>();

  /**
   * Register (or overwrite) a layer type definition.
   * Registrations made before the store is created take effect immediately.
   * Registrations made afterwards will apply to the next environment that uses that type.
   */
  register(definition: LayerTypeDefinition): void {
    if (this._defs.has(definition.layer_type)) {
      console.warn(
        `[LayerRegistry] Overwriting existing registration for layer_type "${definition.layer_type}".`
      );
    }
    this._defs.set(definition.layer_type, { ...definition });
  }

  /** Look up a layer type definition. Returns `undefined` for unknown types. */
  get(layer_type: string): LayerTypeDefinition | undefined {
    return this._defs.get(layer_type);
  }

  /** Whether a layer type has been registered. */
  has(layer_type: string): boolean {
    return this._defs.has(layer_type);
  }

  /** Return all registered layer type definitions. */
  getAll(): LayerTypeDefinition[] {
    return Array.from(this._defs.values());
  }

  // ── Validation helpers ──────────────────────────────────────────────────

  /**
   * Validate layer metadata (the `data` field of `env_layer_create` / `env_layer_update`).
   * Returns `{ success: true, data }` when there is no schema or validation passes.
   * Returns `{ success: false, error }` on schema mismatch.
   */
  validateMetadata<T = any>(
    layer_type: string,
    data: Record<string, any>
  ): LayerValidationResult<T> {
    const def = this._defs.get(layer_type);
    if (!def?.metadataSchema) return { success: true, data: data as T };
    const result = def.metadataSchema.safeParse(data);
    if (!result.success) return { success: false, error: result.error };
    return { success: true, data: result.data as T };
  }

  /**
   * Validate a single entity (agent or edge) against the entity schema.
   * Returns `{ success: true, data }` when there is no schema or validation passes.
   */
  validateEntity<T = any>(
    layer_type: string,
    entity: unknown
  ): LayerValidationResult<T> {
    const def = this._defs.get(layer_type);
    if (!def?.entitySchema) return { success: true, data: entity as T };
    const result = def.entitySchema.safeParse(entity);
    if (!result.success) return { success: false, error: result.error };
    return { success: true, data: result.data as T };
  }

  /**
   * Validate a single entity diff object.
   * Returns `{ success: true, data }` when there is no schema or validation passes.
   */
  validateEntityDiff<T = any>(
    layer_type: string,
    diff: unknown
  ): LayerValidationResult<T> {
    const def = this._defs.get(layer_type);
    if (!def?.entityDiffSchema) return { success: true, data: diff as T };
    const result = def.entityDiffSchema.safeParse(diff);
    if (!result.success) return { success: false, error: result.error };
    return { success: true, data: result.data as T };
  }
}

// ---------------------------------------------------------------------------
// Global singleton
// ---------------------------------------------------------------------------

/** The global layer registry. Mutate via `register()` or `registerLayerType()`. */
export const layerRegistry = new LayerRegistryClass();

/**
 * Register a custom layer type with the global registry.
 * Call this before connecting to a WebSocket server so that incoming
 * `env_layer_create` messages for your custom type are validated correctly.
 *
 * @example
 * ```typescript
 * registerLayerType({
 *   layer_type: 'heatmap',
 *   label: 'Heatmap Layer',
 *   metadataSchema: z.object({ colormap: z.string().optional() }).passthrough(),
 * });
 * ```
 */
export function registerLayerType(definition: LayerTypeDefinition): void {
  layerRegistry.register(definition);
}

// ---------------------------------------------------------------------------
// Built-in layer type metadata schemas
// ---------------------------------------------------------------------------

/** Metadata schema for the `agent` layer type. */
const AgentLayerMetadataSchema = z.object({
  /** Grid width in cells (used for grid-mode agent positioning). */
  width: z.number().optional(),
  /** Grid height in cells. */
  height: z.number().optional(),
  /** Grid coordinate mapping mode. */
  coord_offset: z.enum(['int', 'float']).optional(),
  /** Default trajectory trail length (≤0 = unlimited). */
  trajectory_length: z.number().optional(),
  /** Default trajectory CSS color. */
  trajectory_color: z.string().optional(),
}).passthrough();

/** Metadata schema for the `edge` layer type (d3-force configuration). */
const EdgeLayerMetadataSchema = z.object({
  linkDistance: z.number().optional(),
  chargeStrength: z.number().optional(),
  centeringStrength: z.number().optional(),
  collisionRadius: z.number().optional(),
  maxComponentDistance: z.number().optional(),
  componentSpacing: z.number().optional(),
}).passthrough();

/** Metadata schema for the `grid` layer type (parametric grid overlay). */
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
}).passthrough();

/** Metadata schema for the `background` layer type. */
const BackgroundLayerMetadataSchema = z.object({
  /**
   * CSS color string, URL, raw binary image (`Uint8Array`), or an asset reference
   * `{ asset_id: string, interpolation?: "nearest" | "linear" }`.
   */
  background: z.union([
    z.string(),
    z.instanceof(Uint8Array),
    z.object({
      asset_id: z.string(),
      interpolation: z.enum(['nearest', 'linear']).optional(),
    }),
  ]).optional(),
  /** Image interpolation mode. Default: "nearest". */
  interpolation: z.enum(['nearest', 'linear']).optional(),
}).passthrough();

// ---------------------------------------------------------------------------
// Register built-in layer types
// ---------------------------------------------------------------------------

layerRegistry.register({
  layer_type: 'agent',
  label: 'Agent Layer',
  metadataSchema: AgentLayerMetadataSchema,
  entitySchema: AgentSchema,
  entityDiffSchema: AgentDiffSchema,
  hasAgents: true,
  hasEdges: false,
});

layerRegistry.register({
  layer_type: 'edge',
  label: 'Edge Layer',
  metadataSchema: EdgeLayerMetadataSchema,
  entitySchema: EdgeDataSchema,
  entityDiffSchema: EdgeDiffSchema,
  hasAgents: false,
  hasEdges: true,
});

layerRegistry.register({
  layer_type: 'grid',
  label: 'Grid Overlay Layer',
  metadataSchema: GridLayerMetadataSchema,
  hasAgents: false,
  hasEdges: false,
});

layerRegistry.register({
  layer_type: 'background',
  label: 'Background Layer',
  metadataSchema: BackgroundLayerMetadataSchema,
  hasAgents: false,
  hasEdges: false,
});
