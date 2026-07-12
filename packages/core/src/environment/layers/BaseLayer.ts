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
import type { EnvironmentLayerHost, EnvironmentViewFitMode, IResizableLayer } from '../host';
import { Viewport, Unsubscribe, IStorage, StorageListener } from '../types';

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, width: 1, height: 1 };

export abstract class BaseLayer implements IResizableLayer {

  // #region Abstract members

  abstract readonly defaultZIndex: number;

  // #endregion

  // #region Internal state

  protected readonly group: Group;
  private _host: EnvironmentLayerHost | null = null;
  private _zIndex: number;
  private _interactionEnabled = false;
  private readonly _unsubscribes: Unsubscribe[] = [];
  protected _viewport: Viewport;
  protected _fitMode: EnvironmentViewFitMode;

  constructor() {
    this._viewport = { ...DEFAULT_VIEWPORT };
    this._fitMode = 'contain';
    // zIndex is set lazily to defaultZIndex after construction
    this._zIndex = -1; // sentinel; resolved on first addLayer
    this.group = new Group();
    // Resolve zIndex from abstract property after subclass constructor runs.
    // We use queueMicrotask so the subclass getter is already defined.
    queueMicrotask(() => {
      if (this._zIndex === -1) this._zIndex = this.defaultZIndex;
    });
  }

  // #endregion

  // #region z-index
  get zIndex(): number {
    return this._zIndex !== -1 ? this._zIndex : this.defaultZIndex;
  }

  setZIndex(z: number): void {
    this._zIndex = z;
  }

  get interactionEnabled(): boolean {
    return this._interactionEnabled;
  }

  setInteractionEnabled(enabled: boolean): void {
    if (this._interactionEnabled === enabled) {
      return;
    }

    this._interactionEnabled = enabled;
    this.onInteractionChanged(enabled);
  }

  attachToHost(host: EnvironmentLayerHost): void {
    if (this._host === host) {
      return;
    }

    if (this._host) {
      this.detachFromHost();
    }

    this._host = host;
    this._viewport = host.viewport;
    this._fitMode = host.fitMode;
    host.leafer.add(this.group);
    this.onAttached(host);
    this.setInteractionEnabled(host.interactionEnabled);
  }

  detachFromHost(): void {
    if (!this._host) {
      return;
    }

    const host = this._host;
    this.setInteractionEnabled(false);
    this.onDetached(host);
    host.leafer.remove(this.group);
    this._host = null;
  }

  reattachTo(parent: Leafer): void {
    parent.remove(this.group);
    parent.add(this.group);
  }

  protected get host(): EnvironmentLayerHost | null {
    return this._host;
  }

  protected get view(): EnvironmentLayerHost {
    if (!this._host) {
      throw new Error(`${this.constructor.name} is not attached to an environment host.`);
    }

    return this._host;
  }

  // #endregion

  // #region Viewport to pixel transformation helpers

  /**
   * Get the container pixel dimensions.
   */
  protected getContainerSize(): { width: number; height: number } {
    return this._host?.getSurfaceSize() ?? { width: 1, height: 1 };
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
   * Return the scene-coordinate rectangle mapped onto the complete surface.
   * With `contain`/`cover`, this differs from the logical viewport in the
   * letterboxed or cropped axis. Infinite layers (such as a grid) use it so
   * they cover the canvas instead of stopping at the fitted scene bounds.
   */
  protected getCanvasSceneCoverage(
    viewport: Viewport = this._viewport,
    fitMode: EnvironmentViewFitMode = this._fitMode,
  ): Viewport {
    const container = this.getContainerSize();
    const scale = this.calculateViewportScale(viewport, fitMode);
    const renderedWidth = viewport.width * scale.scaleX;
    const renderedHeight = viewport.height * scale.scaleY;
    const padX = (container.width - renderedWidth) / 2;
    const padY = (container.height - renderedHeight) / 2;

    return {
      x: viewport.x - padX / scale.scaleX,
      y: viewport.y - padY / scale.scaleY,
      width: container.width / scale.scaleX,
      height: container.height / scale.scaleY,
    };
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

  // #endregion

  // #region Storage subscriptions

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

  // #endregion

  // #region Lifecycle

  protected onAttached(_host: EnvironmentLayerHost): void {
    // Subclasses can override to react to host attachment.
  }

  protected onDetached(_host: EnvironmentLayerHost): void {
    // Subclasses can override to react to host detachment.
  }

  protected onInteractionChanged(_enabled: boolean): void {
    // Subclasses can override when they need host-controlled interaction wiring.
  }

  /** Called by EnvironmentView when viewport changes. */
  abstract onViewportChange(viewport: Viewport, fitMode: EnvironmentViewFitMode): void;

  destroy(): void {
    this.detachFromHost();
    this._unsubscribes.forEach((u) => u());
    this._unsubscribes.length = 0;
    this.group.remove();
    this.group.clear();
  }

  // #endregion
}
