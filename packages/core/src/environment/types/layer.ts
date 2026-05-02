/**
 * environment/types/layer.ts
 *
 * Core interfaces for the Layer / Storage pattern.
 */

import { z } from 'zod';
import { SceneBounds, OriginMode } from './viewport';

export const BaseLayerMetadataSchema = z.object({
  dependency_layer_ids: z.never().optional(),
  z_index: z.number().optional(),
}).loose();

export type BaseLayerMetadata = z.infer<typeof BaseLayerMetadataSchema>;

export const AgentLayerMetadataSchema = BaseLayerMetadataSchema.extend({
  width: z.number().optional(),
  height: z.number().optional(),
  coord_offset: z.enum(['int', 'float']).optional(),
}).loose();

export type AgentLayerMetadata = z.infer<typeof AgentLayerMetadataSchema>;

export const EdgeLayerMetadataSchema = BaseLayerMetadataSchema.extend({
  link_distance: z.number().optional(),
  charge_strength: z.number().optional(),
  centering_strength: z.number().optional(),
  collision_radius: z.number().optional(),
  max_component_distance: z.number().optional(),
  component_spacing: z.number().optional(),
}).loose();

export type EdgeLayerMetadata = z.infer<typeof EdgeLayerMetadataSchema>;

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

export const TrajectoryLayerMetadataSchema = BaseLayerMetadataSchema.extend({
  length: z.number().optional(),
  width: z.number().optional(),
  color: z.string().optional(),
}).loose();

export type TrajectoryLayerMetadata = z.infer<typeof TrajectoryLayerMetadataSchema>;

export type Unsubscribe = () => void;

export type StorageListener<T, TDelta> = (data: T, delta?: TDelta) => void;

/** A read-only view of a storage a layer can subscribe to. */
export interface IStorage<T = unknown, TDelta = unknown> {
  subscribe(listener: StorageListener<T, TDelta>): Unsubscribe;
  getData(): T;
}

/** A mutable storage. Layers that write back use this. */
export interface IMutableStorage<T = unknown, TDelta = unknown> extends IStorage<T, TDelta> {
  setData(data: T): void;
}

/** A Layer registered into an EnvironmentView. */
export interface ILayer {
  readonly defaultZIndex: number;
  /** Effective z-index (may be overridden). */
  readonly zIndex: number;
  setZIndex(z: number): void;
  destroy(): void;
}

/**
 * Interface for layers that contribute to the scene bounding box.
 * EnvironmentView uses this to auto-calculate the scene extent.
 */
export interface IBoundedLayer extends ILayer {
  /**
   * Get the scene bounds contributed by this layer.
   * Returns null if the layer has no content or doesn't contribute to scene bounds.
   */
  getSceneBounds(): SceneBounds | null;
  
  /**
   * Get the origin mode for this layer's content.
   * Determines how the layer's content is positioned relative to its bounds.
   */
  getOriginMode(): OriginMode;
}
