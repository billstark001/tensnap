/**
 * environment/EnvironmentView.ts
 *
 * Root canvas host.  Holds a single Leafer instance, manages Layer z-ordering,
 * and propagates throttled resize events to all registered layers.
 *
 * Layers are kept in a sorted list (ascending zIndex).  When the container
 * resizes, each layer receives `onViewportChange(width, height)`.
 */

import { Leafer } from 'leafer-ui';
import { Viewport } from './types';
import { throttle, disableCanvasSmoothing } from './utils';

export interface IResizableLayer {
  readonly zIndex: number;
  /** Called (throttled) when the container size changes. */
  onViewportChange(viewport: Viewport): void;
  destroy(): void;
}

const DEFAULT_RESIZE_THROTTLE_MS = 100;

export class EnvironmentView {
  readonly container: HTMLElement;
  readonly leafer: Leafer;

  private _viewport: Viewport;
  private layers: IResizableLayer[] = [];
  private resizeObserver: ResizeObserver;

  constructor(
    container: HTMLElement,
    options: {
      /** Leafer canvas type — 'design' enables built-in pan/zoom. */
      type?: 'design' | 'board' | 'document' | 'custom';
      throttleMs?: number;
      pixelRatio?: number;
    } = {}
  ) {
    this.container = container;

    const rect = container.getBoundingClientRect();
    this._viewport = {
      width: rect.width || container.clientWidth,
      height: rect.height || container.clientHeight,
    };

    this.leafer = new Leafer({
      view: container,
      width: this._viewport.width,
      height: this._viewport.height,
      type: options.type ?? 'design',
      pixelRatio: options.pixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1),
    });

    const throttleMs = options.throttleMs ?? DEFAULT_RESIZE_THROTTLE_MS;
    const handleResize = throttle(this._onResize.bind(this), throttleMs);

    this.resizeObserver = new ResizeObserver(() => handleResize());
    this.resizeObserver.observe(container);
  }

  // -------------------------------------------------------------------------
  // Viewport
  // -------------------------------------------------------------------------

  get viewport(): Viewport {
    return { ...this._viewport };
  }

  /** Programmatically resize the canvas (also notifies all layers). */
  setViewport(width: number, height: number): void {
    this._viewport = { width, height };
    this.leafer.set({ width, height });
    this._applyCanvasSmoothing();
    this._notifyLayers();
  }

  private _onResize(): void {
    const rect = this.container.getBoundingClientRect();
    const w = rect.width || this.container.clientWidth;
    const h = rect.height || this.container.clientHeight;
    if (w === this._viewport.width && h === this._viewport.height) return;
    this.setViewport(w, h);
  }

  // -------------------------------------------------------------------------
  // Layer management
  // -------------------------------------------------------------------------

  /**
   * Register a layer.  The layer is inserted at the correct z-index position.
   * Leafer renders children in insertion order, so we re-insert after sorting.
   */
  addLayer(layer: IResizableLayer): void {
    this.layers.push(layer);
    this._sortAndReattach();
    // Immediately deliver current viewport
    layer.onViewportChange({ ...this._viewport });
  }

  removeLayer(layer: IResizableLayer): void {
    const idx = this.layers.indexOf(layer);
    if (idx !== -1) this.layers.splice(idx, 1);
  }

  /** Re-sort all layer groups by zIndex and re-add to Leafer in order. */
  private _sortAndReattach(): void {
    this.layers.sort((a, b) => a.zIndex - b.zIndex);
  }

  private _notifyLayers(): void {
    const vp = { ...this._viewport };
    this.layers.forEach((l) => l.onViewportChange(vp));
  }

  // -------------------------------------------------------------------------
  // Canvas quality helpers
  // -------------------------------------------------------------------------

  private _applyCanvasSmoothing(): void {
    setTimeout(() => {
      const canvas = this.container.querySelector('canvas');
      if (canvas) disableCanvasSmoothing(canvas);
    }, 0);
  }

  // -------------------------------------------------------------------------
  // Zoom / fit helpers (delegates to Leafer)
  // -------------------------------------------------------------------------

  fitToView(padding = 40, duration = 750): void {
    (this.leafer as any).zoomToFit?.(undefined, padding, duration);
  }

  // -------------------------------------------------------------------------
  // Destroy
  // -------------------------------------------------------------------------

  destroy(): void {
    this.resizeObserver.disconnect();
    this.layers.slice().forEach((l) => l.destroy());
    this.layers = [];
    this.leafer.destroy();
  }
}
