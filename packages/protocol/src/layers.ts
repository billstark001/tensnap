import { z } from 'zod';

/**
 * The five layer types built into the default TenSnap renderer registry.
 * Third-party layer types may still use open `layer_type` strings in the
 * generic protocol payloads.
 */
export const BuiltinLayerTypeSchema = z.enum(['background', 'grid', 'edge', 'trajectory', 'agent']);

export type BuiltinLayerType = z.infer<typeof BuiltinLayerTypeSchema>;

/** Agent ids are stable layer item keys and may be strings or numbers. */
export const AgentIdSchema = z.union([z.string(), z.number()]);

export type AgentId = z.infer<typeof AgentIdSchema>;

export const BUILTIN_AGENT_ICONS = [
  'arrow',
  'circle',
  'square',
  'triangle',
  'diamond',
  'star',
  'hexagon',
  'cross',
  'plus',
  'pentagon',
] as const;

/** Built-in symbolic agent icons rendered by the default agent layer. */
export const BuiltinAgentIconSchema = z.enum(BUILTIN_AGENT_ICONS);

/** Asset-backed icons use the `asset:<asset_id>` reference form. */
export const AssetAgentIconSchema = z.string().regex(/^asset:.+$/);

export const AgentIconSchema = z.union([BuiltinAgentIconSchema, AssetAgentIconSchema]);

export type BuiltinAgentIcon = z.infer<typeof BuiltinAgentIconSchema>;
export type AssetAgentIcon = z.infer<typeof AssetAgentIconSchema>;
export type AgentIcon = z.infer<typeof AgentIconSchema>;

/**
 * Common metadata accepted by all built-in layers. Dependencies are create-time
 * topology and live on `env_layer_create.dependency_layer_ids`, not in metadata.
 */
export const BaseLayerMetadataSchema = z.object({
  dependency_layer_ids: z.never().optional(),
  z_index: z.number().optional(),
}).loose();

export type BaseLayerMetadata = z.infer<typeof BaseLayerMetadataSchema>;

/**
 * Agent layer metadata. `coord_offset` selects integer grid-cell coordinates or
 * floating scene coordinates for x/y agent positions.
 */
export const AgentLayerMetadataSchema = BaseLayerMetadataSchema.extend({
  width: z.number().optional(),
  height: z.number().optional(),
  coord_offset: z.enum(['int', 'float']).optional(),
}).loose();

export type AgentLayerMetadata = z.infer<typeof AgentLayerMetadataSchema>;

/**
 * Agent items are keyed by `id`. They can represent grid agents or graph nodes;
 * graph-force fields (`vx`, `vy`, `fx`, `fy`) are renderer-maintained hints.
 */
export const AgentItemSchema = z.object({
  id: AgentIdSchema,
  color: z.string().optional(),
  icon: AgentIconSchema.optional(),
  size: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  vx: z.number().optional(),
  vy: z.number().optional(),
  fx: z.number().nullable().optional(),
  fy: z.number().nullable().optional(),
  heading: z.number().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
}).loose();

export type AgentItem = z.infer<typeof AgentItemSchema>;

/** Agent item updates are keyed by `id` and may carry any changed fields. */
export const AgentItemDiffSchema = z.object({
  id: AgentIdSchema,
}).loose();

export type AgentItemDiff = z.infer<typeof AgentItemDiffSchema>;

/**
 * Edge layer metadata configures graph layout forces and edge rendering
 * defaults. Edge layers depend on an agent layer through dependency key
 * `agent`.
 */
export const EdgeLayerMetadataSchema = BaseLayerMetadataSchema.extend({
  link_distance: z.number().optional(),
  charge_strength: z.number().optional(),
  centering_strength: z.number().optional(),
  collision_radius: z.number().optional(),
  max_component_distance: z.number().optional(),
  component_spacing: z.number().optional(),
}).loose();

export type EdgeLayerMetadata = z.infer<typeof EdgeLayerMetadataSchema>;

/** Edge items are keyed by the ordered pair (`source`, `target`). */
export const EdgeItemSchema = z.object({
  source: AgentIdSchema,
  target: AgentIdSchema,
  directed: z.boolean().optional(),
  style: z.enum(['solid', 'dashed', 'dotted']).optional(),
  width: z.number().optional(),
  color: z.string().optional(),
}).loose();

export type EdgeItem = z.infer<typeof EdgeItemSchema>;

/** Edge item updates are keyed by `source` and `target`. */
export const EdgeItemDiffSchema = z.object({
  source: AgentIdSchema,
  target: AgentIdSchema,
}).loose();

export type EdgeItemDiff = z.infer<typeof EdgeItemDiffSchema>;

/** Delete key for one edge item. */
export const EdgeItemKeySchema = z.object({
  source: AgentIdSchema,
  target: AgentIdSchema,
});

export type EdgeItemKey = z.infer<typeof EdgeItemKeySchema>;

/**
 * Trajectory layer metadata sets defaults for per-agent trajectory traces.
 * Trajectory layers depend on an agent layer through dependency key `agent`.
 *
 * Lifecycle defaults are `on_agent_delete: 'delete'`,
 * `on_state_sync: 'preserve'`, and `on_reset: 'clear'`. A retained deletion
 * closes the old trace segment so a later reuse of the same agent id starts a
 * separate line instead of connecting two lifetimes.
 */
export const TrajectoryLayerMetadataSchema = BaseLayerMetadataSchema.extend({
  length: z.number().optional(),
  width: z.number().optional(),
  color: z.string().optional(),
  /** What to do with a trace when its source agent is deleted. */
  on_agent_delete: z.enum(['delete', 'retain']).optional(),
  /** What to do with accumulated traces during a state-sync replay. */
  on_state_sync: z.enum(['preserve', 'clear']).optional(),
  /** What to do with accumulated traces when the renderer resets its scene. */
  on_reset: z.enum(['clear', 'preserve']).optional(),
}).loose();

export type TrajectoryLayerMetadata = z.infer<typeof TrajectoryLayerMetadataSchema>;

/** Per-agent trajectory config items are keyed by agent `id`. */
export const TrajectoryItemSchema = z.object({
  id: AgentIdSchema,
  length: z.number().optional(),
  width: z.number().optional(),
  color: z.string().optional(),
}).loose();

export type TrajectoryItem = z.infer<typeof TrajectoryItemSchema>;

/** Trajectory item updates are keyed by `id`. */
export const TrajectoryItemDiffSchema = z.object({
  id: AgentIdSchema,
}).loose();

export type TrajectoryItemDiff = z.infer<typeof TrajectoryItemDiffSchema>;

/** One historical trajectory sample stored by the renderer. */
export const TrajectoryPointSchema = z.object({
  x: z.number(),
  y: z.number(),
  time: z.number(),
  color: z.string().optional(),
});

export type TrajectoryPoint = z.infer<typeof TrajectoryPointSchema>;

/** Grid layer metadata controls parametric grid lines and optional scene size. */
export const GridLayerMetadataSchema = BaseLayerMetadataSchema.extend({
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

export type GridLayerMetadata = z.infer<typeof GridLayerMetadataSchema>;

export const BackgroundInterpolationSchema = z.enum(['nearest', 'linear']);

export type BackgroundInterpolation = z.infer<typeof BackgroundInterpolationSchema>;

/** Background image references point to a previously announced protocol asset. */
export const BackgroundAssetReferenceSchema = z.object({
  asset_id: z.string(),
  interpolation: BackgroundInterpolationSchema.optional(),
});

export type BackgroundAssetReference = z.infer<typeof BackgroundAssetReferenceSchema>;

/** Raw background source accepted by the built-in background layer metadata. */
export const BackgroundSourceSchema = z.union([
  z.string(),
  z.instanceof(Uint8Array),
  BackgroundAssetReferenceSchema,
]);

export type BackgroundSource = z.infer<typeof BackgroundSourceSchema>;

/** Background layer metadata stores color/image/asset source and interpolation. */
export const BackgroundLayerMetadataSchema = BaseLayerMetadataSchema.extend({
  background: BackgroundSourceSchema.optional(),
  interpolation: BackgroundInterpolationSchema.optional(),
}).loose();

export type BackgroundLayerMetadata = z.infer<typeof BackgroundLayerMetadataSchema>;

/** Dependency map shape used by edge and trajectory layers. */
export const AgentDependencyLayerIdsSchema = z.object({
  agent: z.string(),
}).loose();

export type AgentDependencyLayerIds = z.infer<typeof AgentDependencyLayerIdsSchema>;

const BuiltinLayerCreateBaseSchema = z.object({
  env_id: z.string(),
  layer_id: z.string(),
});

const ItemPayloadBaseSchema = z.object({
  env_id: z.string(),
  layer_id: z.string(),
});

/** Built-in `agent` layer create payload. Agent layers do not require dependency layers. */
export const AgentLayerCreatePayloadSchema = BuiltinLayerCreateBaseSchema.extend({
  layer_type: z.literal('agent'),
  data: AgentLayerMetadataSchema.optional(),
});

export type AgentLayerCreatePayload = z.infer<typeof AgentLayerCreatePayloadSchema>;

/** Built-in `edge` layer create payload. `dependency_layer_ids.agent` names the source agent layer. */
export const EdgeLayerCreatePayloadSchema = BuiltinLayerCreateBaseSchema.extend({
  layer_type: z.literal('edge'),
  dependency_layer_ids: AgentDependencyLayerIdsSchema,
  data: EdgeLayerMetadataSchema.optional(),
});

export type EdgeLayerCreatePayload = z.infer<typeof EdgeLayerCreatePayloadSchema>;

/** Built-in `trajectory` layer create payload. `dependency_layer_ids.agent` names the traced agent layer. */
export const TrajectoryLayerCreatePayloadSchema = BuiltinLayerCreateBaseSchema.extend({
  layer_type: z.literal('trajectory'),
  dependency_layer_ids: AgentDependencyLayerIdsSchema,
  data: TrajectoryLayerMetadataSchema.optional(),
});

export type TrajectoryLayerCreatePayload = z.infer<typeof TrajectoryLayerCreatePayloadSchema>;

/** Built-in `grid` layer create payload. Grid layers use metadata only and do not accept item messages. */
export const GridLayerCreatePayloadSchema = BuiltinLayerCreateBaseSchema.extend({
  layer_type: z.literal('grid'),
  data: GridLayerMetadataSchema.optional(),
});

export type GridLayerCreatePayload = z.infer<typeof GridLayerCreatePayloadSchema>;

/** Built-in `background` layer create payload. Background layers use metadata only and do not accept item messages. */
export const BackgroundLayerCreatePayloadSchema = BuiltinLayerCreateBaseSchema.extend({
  layer_type: z.literal('background'),
  data: BackgroundLayerMetadataSchema.optional(),
});

export type BackgroundLayerCreatePayload = z.infer<typeof BackgroundLayerCreatePayloadSchema>;

/** Union of the five built-in layer create payload specializations. */
export const BuiltinLayerCreatePayloadSchema = z.union([
  BackgroundLayerCreatePayloadSchema,
  GridLayerCreatePayloadSchema,
  EdgeLayerCreatePayloadSchema,
  TrajectoryLayerCreatePayloadSchema,
  AgentLayerCreatePayloadSchema,
]);

export type BuiltinLayerCreatePayload = z.infer<typeof BuiltinLayerCreatePayloadSchema>;

/** `item_create` payload specialization for built-in agent layers. */
export const AgentItemCreatePayloadSchema = ItemPayloadBaseSchema.extend({
  items: z.array(AgentItemSchema),
});

export type AgentItemCreatePayload = z.infer<typeof AgentItemCreatePayloadSchema>;

/** `item_update` payload specialization for built-in agent layers. */
export const AgentItemUpdatePayloadSchema = ItemPayloadBaseSchema.extend({
  items: z.array(AgentItemDiffSchema),
});

export type AgentItemUpdatePayload = z.infer<typeof AgentItemUpdatePayloadSchema>;

/** `item_delete` payload specialization for built-in agent layers, keyed by agent id. */
export const AgentItemDeletePayloadSchema = ItemPayloadBaseSchema.extend({
  items: z.array(AgentIdSchema),
});

export type AgentItemDeletePayload = z.infer<typeof AgentItemDeletePayloadSchema>;

/** `item_create` payload specialization for built-in edge layers. */
export const EdgeItemCreatePayloadSchema = ItemPayloadBaseSchema.extend({
  items: z.array(EdgeItemSchema),
});

export type EdgeItemCreatePayload = z.infer<typeof EdgeItemCreatePayloadSchema>;

/** `item_update` payload specialization for built-in edge layers. */
export const EdgeItemUpdatePayloadSchema = ItemPayloadBaseSchema.extend({
  items: z.array(EdgeItemDiffSchema),
});

export type EdgeItemUpdatePayload = z.infer<typeof EdgeItemUpdatePayloadSchema>;

/** `item_delete` payload specialization for built-in edge layers, keyed by source/target pairs. */
export const EdgeItemDeletePayloadSchema = ItemPayloadBaseSchema.extend({
  items: z.array(EdgeItemKeySchema),
});

export type EdgeItemDeletePayload = z.infer<typeof EdgeItemDeletePayloadSchema>;

/** `item_create` payload specialization for built-in trajectory layers. */
export const TrajectoryItemCreatePayloadSchema = ItemPayloadBaseSchema.extend({
  items: z.array(TrajectoryItemSchema),
});

export type TrajectoryItemCreatePayload = z.infer<typeof TrajectoryItemCreatePayloadSchema>;

/** `item_update` payload specialization for built-in trajectory layers. */
export const TrajectoryItemUpdatePayloadSchema = ItemPayloadBaseSchema.extend({
  items: z.array(TrajectoryItemDiffSchema),
});

export type TrajectoryItemUpdatePayload = z.infer<typeof TrajectoryItemUpdatePayloadSchema>;

/** `item_delete` payload specialization for built-in trajectory layers, keyed by agent id. */
export const TrajectoryItemDeletePayloadSchema = ItemPayloadBaseSchema.extend({
  items: z.array(AgentIdSchema),
});

export type TrajectoryItemDeletePayload = z.infer<typeof TrajectoryItemDeletePayloadSchema>;

/** Union of built-in layer `item_create` payload specializations. Grid and background layers have no items. */
export const BuiltinLayerItemCreatePayloadSchema = z.union([
  AgentItemCreatePayloadSchema,
  EdgeItemCreatePayloadSchema,
  TrajectoryItemCreatePayloadSchema,
]);

export type BuiltinLayerItemCreatePayload = z.infer<typeof BuiltinLayerItemCreatePayloadSchema>;

/** Union of built-in layer `item_update` payload specializations. Grid and background layers have no items. */
export const BuiltinLayerItemUpdatePayloadSchema = z.union([
  AgentItemUpdatePayloadSchema,
  EdgeItemUpdatePayloadSchema,
  TrajectoryItemUpdatePayloadSchema,
]);

export type BuiltinLayerItemUpdatePayload = z.infer<typeof BuiltinLayerItemUpdatePayloadSchema>;

/** Union of built-in layer `item_delete` payload specializations. Grid and background layers have no items. */
export const BuiltinLayerItemDeletePayloadSchema = z.union([
  AgentItemDeletePayloadSchema,
  EdgeItemDeletePayloadSchema,
  TrajectoryItemDeletePayloadSchema,
]);

export type BuiltinLayerItemDeletePayload = z.infer<typeof BuiltinLayerItemDeletePayloadSchema>;
