/**
 * environment/EnvironmentView.ts
 *
 * Root canvas host.  Holds a single Leafer instance, manages Layer z-ordering,
 * and propagates throttled resize events to all registered layers.
 *
 * Coordinate system: +x right, +y up (origin at bottom-left of scene).
 *
 * Viewport represents the visible rendering area in scene coordinates.
 * Layers should only update their group transform to respond to viewport changes,
 * not modify internal element states.
 *
 * Scene bounds are calculated from all IBoundedLayer implementations.
 * EnvironmentView provides methods to reset viewport to fit the scene.
 */

import { Leafer } from 'leafer-ui';
import { Viewport, SceneBounds, IBoundedLayer } from './types';
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
  private _containerSize: { width: number; height: number };
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
    this._containerSize = {
      width: rect.width || container.clientWidth,
      height: rect.height || container.clientHeight,
    };

    // Initialize viewport to show origin with container dimensions
    this._viewport = {
      x: 0,
      y: 0,
      width: this._containerSize.width,
      height: this._containerSize.height,
    };

    this.leafer = new Leafer({
      view: container,
      width: this._containerSize.width,
      height: this._containerSize.height,
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

  /** 
   * Set the viewport to a specific region of the scene.
   * This defines what portion of the scene is visible.
   */
  setViewport(x: number, y: number, width: number, height: number): void {
    this._viewport = { x, y, width, height };
    this._notifyLayers();
  }

  /**
   * Reset viewport to cover the entire scene based on all bounded layers.
   * Calculates scene bounds once and fits viewport to it.
   */
  fitToScene(padding = 0.1): void {
    const bounds = this.calculateSceneBounds();
    if (!bounds) {
      // No bounded layers, just center on origin
      this.setViewport(
        -this._containerSize.width / 2,
        -this._containerSize.height / 2,
        this._containerSize.width,
        this._containerSize.height
      );
      return;
    }

    const sceneWidth = bounds.maxX - bounds.minX;
    const sceneHeight = bounds.maxY - bounds.minY;
    
    // Add padding
    const paddingX = sceneWidth * padding;
    const paddingY = sceneHeight * padding;
    
    const x = bounds.minX - paddingX;
    const y = bounds.minY - paddingY;
    const width = sceneWidth + 2 * paddingX;
    const height = sceneHeight + 2 * paddingY;

    this.setViewport(x, y, width, height);
  }

  /**
   * Calculate the bounding box of all content in the scene.
   * Queries all IBoundedLayer implementations.
   */
  calculateSceneBounds(): SceneBounds | null {
    const boundedLayers = this.layers.filter(
      (layer): layer is IResizableLayer & IBoundedLayer => 
        'getSceneBounds' in layer && typeof (layer as any).getSceneBounds === 'function'
    );

    if (boundedLayers.length === 0) return null;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const layer of boundedLayers) {
      const bounds = layer.getSceneBounds();
      if (!bounds) continue;

      minX = Math.min(minX, bounds.minX);
      maxX = Math.max(maxX, bounds.maxX);
      minY = Math.min(minY, bounds.minY);
      maxY = Math.max(maxY, bounds.maxY);
    }

    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
      return null;
    }

    return { minX, maxX, minY, maxY };
  }

  /** 
   * Update container size (when container resizes).
   * Maintains viewport scene coordinates but updates the rendering resolution.
   */
  private _onResize(): void {
    const rect = this.container.getBoundingClientRect();
    const w = rect.width || this.container.clientWidth;
    const h = rect.height || this.container.clientHeight;
    
    if (w === this._containerSize.width && h === this._containerSize.height) return;
    
    this._containerSize = { width: w, height: h };
    this.leafer.set({ width: w, height: h });
    this._applyCanvasSmoothing();
    
    // Viewport coordinates stay the same, layers will adjust their rendering
    this._notifyLayers();
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
  // Legacy compatibility
  // -------------------------------------------------------------------------

  /** @deprecated Use fitToScene() instead */
  fitToView(padding = 40, duration = 750): void {
    this.fitToScene(padding / this._containerSize.width);
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
