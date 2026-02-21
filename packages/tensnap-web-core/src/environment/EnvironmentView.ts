/**
 * environment/EnvironmentView.ts
 *
 * Root canvas host. Holds a single Leafer instance, manages Layer z-ordering,
 * and propagates throttled resize events to all registered layers.
 *
 * Coordinate system: +x right, +y up (origin at bottom-left of scene).
 * Viewport represents the visible rendering area in scene coordinates.
 * Layers should only update their group transform to respond to viewport changes.
 * Scene bounds are calculated from all IBoundedLayer implementations.
 */

import { Leafer } from 'leafer-ui';
import { Viewport, SceneBounds, IBoundedLayer } from './types';
import { throttle, disableCanvasSmoothing } from './utils';

// #region Public types

export interface IResizableLayer {
  readonly zIndex: number;
  /** Called (throttled) when the container size or viewport changes. */
  onViewportChange(viewport: Viewport, fitMode: EnvironmentViewFitMode): void;
  /**
   * Remove this layer's Leafer subtree from its current parent and re-add it
   * to `parent`. Called by EnvironmentView to enforce z-index ordering
   * (Leafer renders children in insertion order).
   */
  reattachTo(parent: Leafer): void;
  destroy(): void;
}

export type EnvironmentViewFitMode = 'stretch' | 'contain' | 'cover';

export interface EnvironmentViewOptions {
  /** Leafer canvas type — 'design' enables built-in pan/zoom. */
  type?: 'design' | 'board' | 'document' | 'custom';
  fitMode?: EnvironmentViewFitMode;
  throttleMs?: number;
  pixelRatio?: number;
  /** Enable mouse-drag panning (default: false). */
  enablePan?: boolean;
  /** Enable mouse-wheel zoom (default: false). */
  enableWheelZoom?: boolean;
  /** Enable touch pinch-zoom and single-finger pan (default: false). */
  enableTouchZoom?: boolean;
}

export interface FitToSceneOptions {
  /**
   * Padding around the scene bounds as a fraction of the viewport size
   * (default: 0.1) or as absolute pixels when paddingUnit is 'pixels'.
   */
  padding?: number;
  paddingUnit?: 'fraction' | 'pixels';
}

// #endregion

// #region Module constants & helpers

const DEFAULT_RESIZE_THROTTLE_MS = 100;

type ListenerEntry = {
  target: EventTarget;
  type: string;
  handler: EventListener;
  /** Only `capture` is meaningful for removeEventListener matching; `passive` is ignored. */
  opts?: AddEventListenerOptions;
};

/**
 * Attach or detach a batch of event listeners in a single call.
 * `opts` are forwarded on add; only the `capture` flag matters on remove
 * (all listeners here use the default capture: false, so omitting opts is safe).
 */
function toggleListeners(enable: boolean, entries: ListenerEntry[]): void {
  for (const { target, type, handler, opts } of entries) {
    if (enable) target.addEventListener(type, handler, opts);
    else target.removeEventListener(type, handler);
  }
}

// #endregion

export class EnvironmentView {

  // #region Fields

  readonly container: HTMLElement;
  readonly leafer: Leafer;

  private _viewport: Viewport;
  private _fitMode: EnvironmentViewFitMode;
  private _containerSize: { width: number; height: number };
  private _layers: IResizableLayer[] = [];
  private _resizeObserver: ResizeObserver;

  // Interaction enable flags
  private _enablePan = false;
  private _enableWheelZoom = false;
  private _enableTouchZoom = false;

  // Tracks whether each listener group is currently attached
  private _panActive = false;
  private _wheelActive = false;
  private _touchActive = false;

  // Transient drag / pinch-zoom state
  private _isDragging = false;
  private _lastMouseX = 0;
  private _lastMouseY = 0;
  private _lastTouchDist = 0;

  // Pre-bound handler references required for later removeEventListener calls
  private readonly _handlers: Record<string, EventListener>;

  // #endregion

  // #region Constructor

  constructor(container: HTMLElement, options: EnvironmentViewOptions = {}) {
    this.container = container;

    const rect = container.getBoundingClientRect();
    this._containerSize = {
      width: rect.width || container.clientWidth,
      height: rect.height || container.clientHeight,
    };

    this._fitMode = options.fitMode ?? 'contain';
    this._viewport = {
      x: 0, y: 0,
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

    const handleResize = throttle(
      this._onResize.bind(this),
      options.throttleMs ?? DEFAULT_RESIZE_THROTTLE_MS,
    );
    this._resizeObserver = new ResizeObserver(handleResize);
    this._resizeObserver.observe(container);

    this._handlers = {
      mousedown: this._handleMouseDown.bind(this) as EventListener,
      mousemove: this._handleMouseMove.bind(this) as EventListener,
      mouseup: this._handleMouseUp.bind(this) as EventListener,
      wheel: this._handleWheel.bind(this) as EventListener,
      touchstart: this._handleTouchStart.bind(this) as EventListener,
      touchmove: this._handleTouchMove.bind(this) as EventListener,
      touchend: this._handleTouchEnd.bind(this) as EventListener,
    };

    if (options.enablePan) this.enablePan = true;
    if (options.enableWheelZoom) this.enableWheelZoom = true;
    if (options.enableTouchZoom) this.enableTouchZoom = true;
  }

  // #endregion

  // #region Viewport

  get viewport(): Viewport { return { ...this._viewport }; }
  get fitMode(): EnvironmentViewFitMode { return this._fitMode; }

  setViewport(x: number, y: number, width: number, height: number): void {
    this._viewport = { x, y, width, height };
    this._notifyLayers();
  }

  setFitMode(mode: EnvironmentViewFitMode): void {
    if (this._fitMode === mode) return;
    this._fitMode = mode;
    this._notifyLayers();
  }

  fitToScene({ padding = 0.1, paddingUnit = 'fraction' }: FitToSceneOptions = {}): void {
    const bounds = this.calculateSceneBounds();

    if (!bounds) {
      const w = Math.max(this._containerSize.width, 1);
      const h = Math.max(this._containerSize.height, 1);
      this.setViewport(-w / 2, -h / 2, w, h);
      return;
    }

    const sceneW = bounds.maxX - bounds.minX;
    const sceneH = bounds.maxY - bounds.minY;
    const padX = paddingUnit === 'pixels' ? padding : sceneW * padding;
    const padY = paddingUnit === 'pixels' ? padding : sceneH * padding;

    this.setViewport(
      bounds.minX - padX,
      bounds.minY - padY,
      sceneW + 2 * padX,
      sceneH + 2 * padY,
    );
  }

  calculateSceneBounds(): SceneBounds | null {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (const layer of this._layers) {
      if (!('getSceneBounds' in layer)) continue;
      const b = (layer as IResizableLayer & IBoundedLayer).getSceneBounds();
      if (!b) continue;
      if (b.minX < minX) minX = b.minX;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxY > maxY) maxY = b.maxY;
    }

    return isFinite(minX) ? { minX, maxX, minY, maxY } : null;
  }

  private _notifyLayers(): void {
    const vp = { ...this._viewport };
    for (const layer of this._layers) layer.onViewportChange(vp, this._fitMode);
  }

  // #endregion

  // #region Layer management

  addLayer(layer: IResizableLayer): void {
    this._layers.push(layer);
    this._sortAndReattach();
    layer.onViewportChange({ ...this._viewport }, this._fitMode);
  }

  removeLayer(layer: IResizableLayer): void {
    const idx = this._layers.indexOf(layer);
    if (idx !== -1) this._layers.splice(idx, 1);
  }

  /** Re-sort by zIndex and re-insert into Leafer to guarantee render order. */
  private _sortAndReattach(): void {
    this._layers.sort((a, b) => a.zIndex - b.zIndex);
    for (const layer of this._layers) layer.reattachTo(this.leafer);
  }

  // #endregion

  // #region Resize

  private _onResize(): void {
    const rect = this.container.getBoundingClientRect();
    const w = rect.width || this.container.clientWidth;
    const h = rect.height || this.container.clientHeight;
    if (w === this._containerSize.width && h === this._containerSize.height) return;

    this._containerSize = { width: w, height: h };
    this.leafer.set({ width: w, height: h });

    // Disable canvas smoothing after Leafer re-renders on the next tick
    setTimeout(() => {
      const canvas = this.container.querySelector('canvas');
      if (canvas) disableCanvasSmoothing(canvas);
    }, 0);

    this._notifyLayers();
  }

  // #endregion

  // #region Interaction — getters / setters

  get enablePan(): boolean { return this._enablePan; }
  set enablePan(value: boolean) {
    if (this._enablePan === value) return;
    this._enablePan = value;
    this._syncPanListeners();
    this._syncTouchListeners(); // single-finger pan shares touch events
  }

  get enableWheelZoom(): boolean { return this._enableWheelZoom; }
  set enableWheelZoom(value: boolean) {
    if (this._enableWheelZoom === value) return;
    this._enableWheelZoom = value;
    this._syncWheelListener();
  }

  get enableTouchZoom(): boolean { return this._enableTouchZoom; }
  set enableTouchZoom(value: boolean) {
    if (this._enableTouchZoom === value) return;
    this._enableTouchZoom = value;
    this._syncTouchListeners();
  }

  // #endregion

  // #region Interaction — coordinate mapping

  /**
   * Convert a canvas-space pixel coordinate to scene coordinates.
   * Canvas +y is down; scene +y is up.
   */
  private _canvasToScene(px: number, py: number): { x: number; y: number } {
    const { width: cW, height: cH } = this._containerSize;
    const { x: vx, y: vy, width: vW, height: vH } = this._viewport;

    if (this._fitMode === 'stretch') {
      return {
        x: vx + (px / cW) * vW,
        y: vy + ((cH - py) / cH) * vH,
      };
    }

    // 'contain' | 'cover': uniform scale with centred letterbox
    const scale = this._fitMode === 'cover'
      ? Math.max(cW / vW, cH / vH)
      : Math.min(cW / vW, cH / vH);
    const renderW = vW * scale;
    const renderH = vH * scale;
    const offsetX = (cW - renderW) / 2;
    const offsetY = (cH - renderH) / 2;

    return {
      x: vx + (px - offsetX) / scale,
      // py=offsetY → scene top (vy+vH); py=offsetY+renderH → scene bottom (vy)
      y: vy + (renderH + offsetY - py) / scale,
    };
  }

  /**
   * Zoom the viewport by `factor` (>1 = in, <1 = out),
   * keeping canvas point `(px, py)` pinned to its current scene position.
   */
  private _applyZoom(px: number, py: number, factor: number): void {
    const { x: vx, y: vy, width: vW, height: vH } = this._viewport;
    const { x: sx, y: sy } = this._canvasToScene(px, py);
    this.setViewport(
      sx - (sx - vx) / factor,
      sy - (sy - vy) / factor,
      vW / factor,
      vH / factor,
    );
  }

  // #endregion

  // #region Interaction — event handlers

  private _handleMouseDown(e: MouseEvent): void {
    if (!this._enablePan) return;
    this._isDragging = true;
    this._lastMouseX = e.clientX;
    this._lastMouseY = e.clientY;
    e.preventDefault();
  }

  private _handleMouseMove(e: MouseEvent): void {
    if (!this._isDragging || !this._enablePan) return;
    const { left, top } = this.container.getBoundingClientRect();
    const prev = this._canvasToScene(this._lastMouseX - left, this._lastMouseY - top);
    const cur = this._canvasToScene(e.clientX - left, e.clientY - top);
    const { x, y, width, height } = this._viewport;
    this.setViewport(x + prev.x - cur.x, y + prev.y - cur.y, width, height);
    this._lastMouseX = e.clientX;
    this._lastMouseY = e.clientY;
    e.preventDefault();
  }

  private _handleMouseUp(): void {
    this._isDragging = false;
  }

  private _handleWheel(e: WheelEvent): void {
    if (!this._enableWheelZoom) return;
    e.preventDefault();
    const { left, top } = this.container.getBoundingClientRect();
    // Normalize deltaY across deltaMode: 0 = px, 1 = lines, 2 = pages
    const delta = e.deltaY * (e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? 300 : 1);
    this._applyZoom(e.clientX - left, e.clientY - top, Math.pow(1.001, -delta));
  }

  private _handleTouchStart(e: TouchEvent): void {
    if (e.touches.length === 2 && this._enableTouchZoom) {
      const [t0, t1] = [e.touches[0], e.touches[1]];
      this._lastTouchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      this._isDragging = false;
      e.preventDefault();
    } else if (e.touches.length === 1 && this._enablePan) {
      this._isDragging = true;
      this._lastMouseX = e.touches[0].clientX;
      this._lastMouseY = e.touches[0].clientY;
      e.preventDefault();
    }
  }

  private _handleTouchMove(e: TouchEvent): void {
    const { left, top } = this.container.getBoundingClientRect();

    if (e.touches.length === 2 && this._enableTouchZoom) {
      const [t0, t1] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      if (this._lastTouchDist > 0) {
        this._applyZoom(
          (t0.clientX + t1.clientX) / 2 - left,
          (t0.clientY + t1.clientY) / 2 - top,
          dist / this._lastTouchDist,
        );
      }
      this._lastTouchDist = dist;
      e.preventDefault();
    } else if (e.touches.length === 1 && this._isDragging && this._enablePan) {
      const touch = e.touches[0];
      const prev = this._canvasToScene(this._lastMouseX - left, this._lastMouseY - top);
      const cur = this._canvasToScene(touch.clientX - left, touch.clientY - top);
      const { x, y, width, height } = this._viewport;
      this.setViewport(x + prev.x - cur.x, y + prev.y - cur.y, width, height);
      this._lastMouseX = touch.clientX;
      this._lastMouseY = touch.clientY;
      e.preventDefault();
    }
  }

  private _handleTouchEnd(e: TouchEvent): void {
    if (e.touches.length < 2) this._lastTouchDist = 0;
    if (e.touches.length === 0) this._isDragging = false;
  }

  // #endregion

  // #region Interaction — listener sync

  private _syncPanListeners(): void {
    const want = this._enablePan;
    if (want === this._panActive) return;
    toggleListeners(want, [
      { target: this.container, type: 'mousedown', handler: this._handlers.mousedown },
      { target: window, type: 'mousemove', handler: this._handlers.mousemove },
      { target: window, type: 'mouseup', handler: this._handlers.mouseup },
    ]);
    this._panActive = want;
    if (!want) this._isDragging = false;
  }

  private _syncWheelListener(): void {
    const want = this._enableWheelZoom;
    if (want === this._wheelActive) return;
    toggleListeners(want, [
      { target: this.container, type: 'wheel', handler: this._handlers.wheel, opts: { passive: false } },
    ]);
    this._wheelActive = want;
  }

  /** Touch listeners are shared between pinch-zoom and single-finger pan. */
  private _syncTouchListeners(): void {
    const want = this._enableTouchZoom || this._enablePan;
    if (want === this._touchActive) return;
    toggleListeners(want, [
      { target: this.container, type: 'touchstart', handler: this._handlers.touchstart, opts: { passive: false } },
      { target: this.container, type: 'touchmove', handler: this._handlers.touchmove, opts: { passive: false } },
      { target: this.container, type: 'touchend', handler: this._handlers.touchend },
    ]);
    this._touchActive = want;
    if (!want) { this._isDragging = false; this._lastTouchDist = 0; }
  }

  // #endregion

  // #region Destroy

  destroy(): void {
    this._resizeObserver.disconnect();
    this.enablePan = false;
    this.enableWheelZoom = false;
    this.enableTouchZoom = false;
    for (const layer of this._layers.slice()) layer.destroy();
    this._layers = [];
    this.leafer.destroy();
  }

  // #endregion
}