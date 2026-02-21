/**
 * environment/storages/BaseStorage.ts
 *
 * Generic reactive data container.
 *
 * Usage:
 *   const store = new BaseStorage({ count: 0 });
 *   store.subscribe(data => console.log(data.count));
 *   store.update(d => ({ ...d, count: d.count + 1 }));
 */

import { StorageListener, IMutableStorage, Unsubscribe } from '../types';

export class BaseStorage<T, TDelta = never> implements IMutableStorage<T, TDelta> {
  protected _data: T;
  private readonly _listeners = new Set<StorageListener<T, TDelta>>();

  constructor(initialData: T) {
    this._data = initialData;
  }

  // -------------------------------------------------------------------------
  // IStorage
  // -------------------------------------------------------------------------

  getData(): T {
    return this._data;
  }

  subscribe(listener: StorageListener<T, TDelta>): Unsubscribe {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  // -------------------------------------------------------------------------
  // IMutableStorage
  // -------------------------------------------------------------------------

  setData(data: T): void {
    this._data = data;
    this._notify();
  }

  /**
   * Functional update — receives current data and returns new data.
   * Only notifies if the reference actually changed.
   */
  update(fn: (current: T) => T): void {
    const next = fn(this._data);
    if (next !== this._data) {
      this._data = next;
      this._notify();
    }
  }

  /**
   * Silent write — updates the internal data WITHOUT notifying listeners.
   * Useful for back-channel position writes from physics simulations.
   */
  setSilent(data: T): void {
    this._data = data;
  }

  /** Manually fire all listeners with the current data. */
  notify(delta?: TDelta): void {
    this._notify(delta);
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private _notify(delta?: TDelta): void {
    this._listeners.forEach((l) => l(this._data, delta));
  }
}
