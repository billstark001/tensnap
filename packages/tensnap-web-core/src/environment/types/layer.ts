/**
 * environment/types/layer.ts
 *
 * Core interfaces for the Layer / Storage pattern.
 */

import { SceneBounds, OriginMode } from './viewport';

export type Unsubscribe = () => void;

export type StorageListener<T> = (data: T) => void;

/** A read-only view of a storage a layer can subscribe to. */
export interface IStorage<T = unknown> {
  subscribe(listener: StorageListener<T>): Unsubscribe;
  getData(): T;
}

/** A mutable storage. Layers that write back use this. */
export interface IMutableStorage<T = unknown> extends IStorage<T> {
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
