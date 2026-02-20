/**
 * environment/types/layer.ts
 *
 * Core interfaces for the Layer / Storage pattern.
 */

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
