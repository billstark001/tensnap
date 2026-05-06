import type { Leafer } from '@leafer-ui/core';
import type { IBoundedLayer, SceneBounds, Viewport } from './types';
import type { EnvironmentLayerHost, EnvironmentSurfaceSize, EnvironmentViewFitMode, IResizableLayer } from './host';

export interface FitToSceneOptions {
  padding?: number;
  paddingUnit?: 'fraction' | 'pixels';
}

export interface BaseEnvironmentViewOptions {
  fitMode?: EnvironmentViewFitMode;
  enableLayerInteraction?: boolean;
  initialViewport?: Partial<Viewport>;
}

const MIN_VIEWPORT_EXTENT = 1e-6;

function sanitizeExtent(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) > MIN_VIEWPORT_EXTENT
    ? (value as number)
    : Math.max(fallback, MIN_VIEWPORT_EXTENT);
}

function normalizeViewport(
  viewport: Partial<Viewport> | undefined,
  surfaceSize: EnvironmentSurfaceSize,
): Viewport {
  const fallbackWidth = Math.max(surfaceSize.width, 1);
  const fallbackHeight = Math.max(surfaceSize.height, 1);
  return {
    x: Number.isFinite(viewport?.x) ? (viewport?.x as number) : 0,
    y: Number.isFinite(viewport?.y) ? (viewport?.y as number) : 0,
    width: sanitizeExtent(viewport?.width, fallbackWidth),
    height: sanitizeExtent(viewport?.height, fallbackHeight),
  };
}

export abstract class BaseEnvironmentView implements EnvironmentLayerHost {
  readonly leafer: Leafer;

  protected _viewport: Viewport;
  protected _fitMode: EnvironmentViewFitMode;
  protected _layers: IResizableLayer[] = [];
  private _surfaceSize: EnvironmentSurfaceSize;
  private _interactionEnabled: boolean;

  constructor(
    leafer: Leafer,
    surfaceSize: EnvironmentSurfaceSize,
    options: BaseEnvironmentViewOptions = {},
  ) {
    this.leafer = leafer;
    this._surfaceSize = {
      width: Math.max(1, Math.round(surfaceSize.width)),
      height: Math.max(1, Math.round(surfaceSize.height)),
    };
    this._fitMode = options.fitMode ?? 'contain';
    this._viewport = normalizeViewport(options.initialViewport, this._surfaceSize);
    this._interactionEnabled = options.enableLayerInteraction ?? false;
  }

  get viewport(): Viewport {
    return { ...this._viewport };
  }

  get fitMode(): EnvironmentViewFitMode {
    return this._fitMode;
  }

  get interactionEnabled(): boolean {
    return this._interactionEnabled;
  }

  get enableLayerInteraction(): boolean {
    return this._interactionEnabled;
  }

  set enableLayerInteraction(value: boolean) {
    if (this._interactionEnabled === value) {
      return;
    }

    this._interactionEnabled = value;
    for (const layer of this._layers) {
      layer.setInteractionEnabled?.(value);
    }
  }

  getSurfaceSize(): EnvironmentSurfaceSize {
    return { ...this._surfaceSize };
  }

  protected updateSurfaceSize(width: number, height: number): void {
    const next = {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    };
    if (next.width === this._surfaceSize.width && next.height === this._surfaceSize.height) {
      return;
    }

    this._surfaceSize = next;
    this.leafer.set(next);
    this._notifyLayers();
  }

  setViewport(x: number, y: number, width: number, height: number): void {
    const nextViewport = normalizeViewport({ x, y, width, height }, this._surfaceSize);
    this._viewport = nextViewport;
    this._notifyLayers();
  }

  setFitMode(mode: EnvironmentViewFitMode): void {
    if (this._fitMode === mode) {
      return;
    }

    this._fitMode = mode;
    this._notifyLayers();
  }

  fitToScene({ padding = 0.1, paddingUnit = 'fraction' }: FitToSceneOptions = {}): void {
    const bounds = this.calculateSceneBounds();

    if (!bounds) {
      const { width, height } = this._surfaceSize;
      this.setViewport(-width / 2, -height / 2, width, height);
      return;
    }

    const rawSceneW = bounds.maxX - bounds.minX;
    const rawSceneH = bounds.maxY - bounds.minY;
    const sceneW = sanitizeExtent(rawSceneW, this._viewport.width);
    const sceneH = sanitizeExtent(rawSceneH, this._viewport.height);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const padX = paddingUnit === 'pixels' ? padding : sceneW * padding;
    const padY = paddingUnit === 'pixels' ? padding : sceneH * padding;

    this.setViewport(
      centerX - sceneW / 2 - padX,
      centerY - sceneH / 2 - padY,
      sceneW + 2 * padX,
      sceneH + 2 * padY,
    );
  }

  calculateSceneBounds(): SceneBounds | null {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const layer of this._layers) {
      if (!('getSceneBounds' in layer)) {
        continue;
      }

      const bounds = (layer as IResizableLayer & IBoundedLayer).getSceneBounds();
      if (!bounds) {
        continue;
      }

      if (bounds.minX < minX) minX = bounds.minX;
      if (bounds.maxX > maxX) maxX = bounds.maxX;
      if (bounds.minY < minY) minY = bounds.minY;
      if (bounds.maxY > maxY) maxY = bounds.maxY;
    }

    return isFinite(minX) ? { minX, maxX, minY, maxY } : null;
  }

  addLayer(layer: IResizableLayer): void {
    if (this._layers.includes(layer)) {
      return;
    }

    this._layers.push(layer);
    layer.attachToHost(this);
    this._sortAndReattach();
    layer.onViewportChange({ ...this._viewport }, this._fitMode);
  }

  removeLayer(layer: IResizableLayer): void {
    const index = this._layers.indexOf(layer);
    if (index === -1) {
      return;
    }

    this._layers.splice(index, 1);
    layer.detachFromHost();
  }

  protected _notifyLayers(): void {
    const viewport = { ...this._viewport };
    for (const layer of this._layers) {
      layer.onViewportChange(viewport, this._fitMode);
    }
  }

  private _sortAndReattach(): void {
    this._layers.sort((left, right) => left.zIndex - right.zIndex);
    for (const layer of this._layers) {
      layer.reattachTo(this.leafer);
    }
  }

  destroy(): void {
    for (const layer of this._layers.slice()) {
      this.removeLayer(layer);
      layer.destroy();
    }
    this._layers = [];
    this.leafer.destroy();
  }
}