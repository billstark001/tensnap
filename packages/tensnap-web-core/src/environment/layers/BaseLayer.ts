/**
 * environment/layers/BaseLayer.ts
 *
 * Abstract base class for all rendering layers.
 *
 * Each layer owns a leafer-ui `Group` and manages its own subscriptions to
 * one or more Storage objects.  Concrete subclasses implement:
 *   - `defaultZIndex` — default rendering order
 *   - `onViewportChange(viewport)` — called when canvas size changes
 *   - `destroy()` — cleanup (call super.destroy() to unsubscribe all)
 */

import { Group } from 'leafer-ui';
import { IResizableLayer } from '../EnvironmentView';
import { Viewport, Unsubscribe, IStorage } from '../types';
import { EnvironmentView } from '../EnvironmentView';

export abstract class BaseLayer implements IResizableLayer {
  // -------------------------------------------------------------------
  // Abstract members
  // -------------------------------------------------------------------
  abstract readonly defaultZIndex: number;

  // -------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------
  protected readonly group: Group;
  private _zIndex: number;
  private readonly _unsubscribes: Unsubscribe[] = [];

  constructor(view: EnvironmentView) {
    // zIndex is set lazily to defaultZIndex after construction
    this._zIndex = -1; // sentinel; resolved on first addLayer
    this.group = new Group();
    view.leafer.add(this.group);
    // Resolve zIndex from abstract property after subclass constructor runs.
    // We use queueMicrotask so the subclass getter is already defined.
    queueMicrotask(() => {
      if (this._zIndex === -1) this._zIndex = this.defaultZIndex;
    });
  }

  // -------------------------------------------------------------------
  // z-index
  // -------------------------------------------------------------------
  get zIndex(): number {
    return this._zIndex !== -1 ? this._zIndex : this.defaultZIndex;
  }

  setZIndex(z: number): void {
    this._zIndex = z;
  }

  // -------------------------------------------------------------------
  // Storage subscriptions
  // -------------------------------------------------------------------

  /**
   * Subscribe to a storage and automatically unsubscribe on `destroy()`.
   * Returns the unsubscribe function if you need to detach manually.
   */
  protected registerStorage<T>(
    storage: IStorage<T>,
    handler: (data: T) => void
  ): Unsubscribe {
    const unsub = storage.subscribe(handler);
    this._unsubscribes.push(unsub);
    return unsub;
  }

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  /** Called by EnvironmentView after a throttled resize. */
  abstract onViewportChange(viewport: Viewport): void;

  destroy(): void {
    this._unsubscribes.forEach((u) => u());
    this._unsubscribes.length = 0;
    this.group.remove();
    this.group.clear();
  }
}
