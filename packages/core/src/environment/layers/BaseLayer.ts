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

import { Group, Leafer } from '@leafer-ui/core';
import { EnvironmentViewFitMode, IResizableLayer } from '../EnvironmentView';
import { Viewport, Unsubscribe, IStorage, StorageListener } from '../types';
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
  protected _viewport: Viewport;
  protected _fitMode: EnvironmentViewFitMode;

  constructor(view: EnvironmentView) {
    this.view = view;
    this._viewport = view.viewport;
    this._fitMode = view.fitMode;
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

  reattachTo(parent: Leafer): void {
    parent.remove(this.group);
    parent.add(this.group);
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
   * For 'contain' and 'cover', returns a uniform scale (scaleX === scaleY).
   * For 'stretch', returns independent per-axis scales.
   */
  protected calculateViewportScale(
    viewport: Viewport,
    fitMode: EnvironmentViewFitMode = this._fitMode
  ): { scaleX: number; scaleY: number } {
    const container = this.getContainerSize();
    const rawX = container.width / viewport.width;
    const rawY = container.height / viewport.height;
    if (fitMode === 'contain') {
      const s = Math.min(rawX, rawY);
      return { scaleX: s, scaleY: s };
    } else if (fitMode === 'cover') {
      const s = Math.max(rawX, rawY);
      return { scaleX: s, scaleY: s };
    }
    return { scaleX: rawX, scaleY: rawY };
  }

  /**
   * Apply viewport transformation to the layer's group.
   * This translates and scales the group to show the correct portion of the scene.
   * 
   * Note: Leafer-UI uses top-left origin, so we need to flip Y.
   */
  protected applyViewportTransform(viewport: Viewport, fitMode: EnvironmentViewFitMode): void {
    this._viewport = viewport;
    this._fitMode = fitMode;
    const container = this.getContainerSize();
    const scale = this.calculateViewportScale(viewport, fitMode);
    
    // For contain/cover, center the rendered area inside the container.
    // padX/padY are positive for contain (letterbox/pillarbox) and
    // negative for cover (the scene overflows, we center the overflow).
    const renderedWidth = viewport.width * scale.scaleX;
    const renderedHeight = viewport.height * scale.scaleY;
    const padX = (container.width - renderedWidth) / 2;
    const padY = (container.height - renderedHeight) / 2;

    // Transform: scale + flip Y, then translate so the viewport's bottom-left
    // corner maps to pixel (padX, container.height - padY).
    const offsetX = padX - viewport.x * scale.scaleX;
    const offsetY = container.height - padY + viewport.y * scale.scaleY;

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
  protected registerStorage<T, TDelta>(
    storage: IStorage<T, TDelta>,
    handler: StorageListener<T, TDelta>
  ): Unsubscribe {
    const unsub = storage.subscribe(handler);
    this._unsubscribes.push(unsub);
    return unsub;
  }

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  /** Called by EnvironmentView when viewport changes. */
  abstract onViewportChange(viewport: Viewport, fitMode: EnvironmentViewFitMode): void;

  destroy(): void {
    this._unsubscribes.forEach((u) => u());
    this._unsubscribes.length = 0;
    this.group.remove();
    this.group.clear();
  }
}
