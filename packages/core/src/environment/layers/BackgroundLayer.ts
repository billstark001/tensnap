/**
 * environment/layers/BackgroundLayer.ts
 *
 * Renders a single `Rect` that fills the visible viewport with either a CSS color
 * or an image (stretch-fit).
 *
 * Can optionally report scene bounds for the background area.
 *
 * Default z-index: 0
 */

import { Rect } from '@leafer-ui/core';
import { BaseLayer } from './BaseLayer';
import type { EnvironmentViewFitMode } from '../host';
import { BackgroundStorage, BackgroundData } from '../storages/BackgroundStorage';
import { Viewport, SceneBounds, OriginMode, IBoundedLayer } from '../types';

export interface BackgroundLayerConfig {
  /** 
   * Scene bounds for this background layer.
   * If provided, the layer will report these bounds to EnvironmentView.
   */
  sceneBounds?: SceneBounds | Partial<Viewport>;
  applySceneBoundsToView?: boolean; // If true, call fitToScene after applying new bounds (default: false)
  /**
   * Origin mode for the background.
   * Default: 'bottom-left'
   */
  originMode?: OriginMode;
}

type ParsedBackgroundLayerConfig = Omit<BackgroundLayerConfig, 'sceneBounds'> & { sceneBounds: SceneBounds };

export class BackgroundLayer extends BaseLayer implements IBoundedLayer {
  readonly defaultZIndex = 0;

  private readonly bg: Rect;
  private readonly config: ParsedBackgroundLayerConfig;
  private _interpolation: 'nearest' | 'linear' = 'nearest';
  private _smoothingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    storage?: BackgroundStorage,
    config: BackgroundLayerConfig = {}
  ) {
    super();
    this.config = config as ParsedBackgroundLayerConfig;
    this.setSceneBounds(config.sceneBounds || { x: 0, y: 0, width: 100, height: 100 });
    
    const { minX, minY, maxX, maxY } = this.config.sceneBounds;

    this.bg = new Rect({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      fill: '#00000000',
      cornerSmoothing: 0,
    });
    this.group.add(this.bg);

    if (storage) {
      this.registerStorage(storage, (data) => this._apply(data));
      // Apply initial value immediately
      this._apply(storage.getData());
    }
  }

  // #region IBoundedLayer implementation

  getSceneBounds(): SceneBounds | null {
    if (!this.config.applySceneBoundsToView) return null;
    return this.config.sceneBounds || null;
  }

  setSceneBounds(bounds: SceneBounds | Partial<Viewport>): void {
    if ('width' in bounds || 'height' in bounds) {
      const { x = 0, y = 0, width = 1, height = 1 } = bounds;
      this.config.sceneBounds = {
        minX: x,
        maxX: x + width,
        minY: y,
        maxY: y + height,
      };
    } else {
      this.config.sceneBounds = { ...bounds as SceneBounds };
    }
  }

  getOriginMode(): OriginMode {
    return this.config.originMode || 'bottom-left';
  }

  // #endregion

  // #region Viewport

  onViewportChange(viewport: Viewport, fitMode: EnvironmentViewFitMode): void {
    // Apply viewport transformation to group
    this.applyViewportTransform(viewport, fitMode);

    // Preserve image fill mode after resize
    const fill = this.bg.fill as any;
    if (fill?.type === 'image') {
      this.bg.set({ fill: { ...fill, mode: 'stretch' } });
    }

    // Re-apply canvas smoothing after viewport change (overrides EnvironmentView's disable)
    this._scheduleSmoothing();
  }

  // #endregion

  // #region Rendering

  private _apply(data: BackgroundData): void {
    if (!data) {
      this.bg.set({ fill: '#00000000' });
      this._interpolation = 'nearest';
      return;
    }
    const { minX = 0, minY = 0, maxX = 100, maxY = 100 } = this.config.sceneBounds || {};
    this.bg.set({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    });
    if (data.kind === 'color') {
      this.bg.set({ fill: data.value });
      this._interpolation = 'nearest';
    } else {
      this._interpolation = data.interpolation;
      this.bg.set({
        fill: { type: 'image', url: data.url, mode: 'stretch' },
      });
      this._scheduleSmoothing();
    }
  }

  /**
   * Apply canvas imageSmoothingEnabled after a short delay (so it runs
   * after EnvironmentView's own setTimeout-0 disableCanvasSmoothing).
   */
  private _scheduleSmoothing(): void {
    if (this._smoothingTimer !== null) clearTimeout(this._smoothingTimer);
    this._smoothingTimer = setTimeout(() => {
      this._smoothingTimer = null;
      const smooth = this._interpolation === 'linear';
      this.host?.setCanvasSmoothing?.(smooth, smooth ? 'high' : 'low');
    }, 50);
  }

  // #endregion

  // #region Lifecycle

  destroy(): void {
    if (this._smoothingTimer !== null) {
      clearTimeout(this._smoothingTimer);
      this._smoothingTimer = null;
    }
    super.destroy();
  }

  // #endregion
}
