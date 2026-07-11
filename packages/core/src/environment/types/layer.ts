/**
 * environment/types/layer.ts
 *
 * Core interfaces for the Layer / Storage pattern.
 */

import type { TrajectoryLayerMetadata } from '@tensnap/protocol/layers';
import { SceneBounds, OriginMode } from './viewport';

/**
 * Renderer-side lifecycle policy with explicit defaults for optional protocol
 * metadata.
 */
export interface TrajectoryLifecycle {
  onAgentDelete: NonNullable<TrajectoryLayerMetadata['on_agent_delete']>;
  onStateSync: NonNullable<TrajectoryLayerMetadata['on_state_sync']>;
  onReset: NonNullable<TrajectoryLayerMetadata['on_reset']>;
}

export function resolveTrajectoryLifecycle(metadata: Record<string, unknown>): TrajectoryLifecycle {
  return {
    onAgentDelete: metadata.on_agent_delete === 'retain' ? 'retain' : 'delete',
    onStateSync: metadata.on_state_sync === 'clear' ? 'clear' : 'preserve',
    onReset: metadata.on_reset === 'preserve' ? 'preserve' : 'clear',
  };
}

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
