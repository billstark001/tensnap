/**
 * environment/layers/BaseLayer.ts
 *
 * Abstract base class for all rendering layers.
 *
 * Each layer owns a leafer-ui `Group` and manages its own subscriptions to
 * one or more Storage objects.  Concrete subclasses implement:
 *   - `defaultZIndex` — default rendering order
 *   - `onViewportChange(viewport)` — called when viewport changes
 *   - `destroy()` — cleanup (call super.destroy() to unsubscribe all)
 *
 * The layer transforms viewport coordinates (scene space) to pixel coordinates
 * by applying a scale transformation to its group.
 * 
 * Coordinate system: +x right, +y up (origin at bottom-left).
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
  protected readonly view: EnvironmentView;
  private _zIndex: number;
  private readonly _unsubscribes: Unsubscribe[] = [];

  constructor(view: EnvironmentView) {
    this.view = view;
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
  // Viewport to pixel transformation helpers
  // -------------------------------------------------------------------

  /**
   * Get the container pixel dimensions.
   */
  protected getContainerSize(): { width: number; height: number } {
    const rect = this.view.container.getBoundingClientRect();
    return {
      width: rect.width || this.view.container.clientWidth,
      height: rect.height || this.view.container.clientHeight,
    };
  }

  /**
   * Calculate the scale from scene coordinates to pixels.
   * Used to transform viewport to pixel space.
   */
  protected calculateViewportScale(viewport: Viewport): { scaleX: number; scaleY: number } {
    const container = this.getContainerSize();
    return {
      scaleX: container.width / viewport.width,
      scaleY: container.height / viewport.height,
    };
  }

  /**
   * Apply viewport transformation to the layer's group.
   * This translates and scales the group to show the correct portion of the scene.
   * 
   * Note: Leafer-UI uses top-left origin, so we need to flip Y.
   */
  protected applyViewportTransform(viewport: Viewport): void {
    const container = this.getContainerSize();
    const scale = this.calculateViewportScale(viewport);
    
    // Transform: translate to origin, scale, flip Y, translate to viewport position
    // For +y up coordinate system, we need to:
    // 1. Scale to pixel space
    // 2. Flip Y axis (multiply y by -1)
    // 3. Translate viewport position
    
    const offsetX = -viewport.x * scale.scaleX;
    const offsetY = container.height + viewport.y * scale.scaleY;
    
    this.group.set({
      x: offsetX,
      y: offsetY,
      scaleX: scale.scaleX,
      scaleY: -scale.scaleY, // Flip Y for +y up coordinate system
    });
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

  /** Called by EnvironmentView when viewport changes. */
  abstract onViewportChange(viewport: Viewport): void;

  destroy(): void {
    this._unsubscribes.forEach((u) => u());
    this._unsubscribes.length = 0;
    this.group.remove();
    this.group.clear();
  }
}
