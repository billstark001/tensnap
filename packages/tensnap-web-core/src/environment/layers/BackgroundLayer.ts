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

import { Rect } from 'leafer-ui';
import { BaseLayer } from './BaseLayer';
import { EnvironmentView } from '../EnvironmentView';
import { BackgroundStorage, BackgroundData } from '../storages/BackgroundStorage';
import { Viewport, SceneBounds, OriginMode, IBoundedLayer } from '../types';

export interface BackgroundLayerConfig {
  /** 
   * Scene bounds for this background layer.
   * If provided, the layer will report these bounds to EnvironmentView.
   */
  sceneBounds?: SceneBounds;
  /**
   * Origin mode for the background.
   * Default: 'bottom-left'
   */
  originMode?: OriginMode;
}

export class BackgroundLayer extends BaseLayer implements IBoundedLayer {
  readonly defaultZIndex = 0;

  private readonly bg: Rect;
  private readonly config: BackgroundLayerConfig;

  constructor(
    view: EnvironmentView,
    storage?: BackgroundStorage,
    config: BackgroundLayerConfig = {}
  ) {
    super(view);
    this.config = config;

    const container = this.getContainerSize();
    this.bg = new Rect({
      width: container.width,
      height: container.height,
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

  // -------------------------------------------------------------------------
  // IBoundedLayer implementation
  // -------------------------------------------------------------------------

  getSceneBounds(): SceneBounds | null {
    return this.config.sceneBounds || null;
  }

  getOriginMode(): OriginMode {
    return this.config.originMode || 'bottom-left';
  }

  // -------------------------------------------------------------------------
  // Viewport
  // -------------------------------------------------------------------------

  onViewportChange(viewport: Viewport): void {
    // Apply viewport transformation to group
    this.applyViewportTransform(viewport);
    
    // Update rect to fill the viewport
    this.bg.set({
      x: viewport.x,
      y: viewport.y,
      width: viewport.width,
      height: viewport.height,
    });
    
    // Preserve image fill mode after resize
    const fill = this.bg.fill as any;
    if (fill?.type === 'image') {
      this.bg.set({ fill: { ...fill, mode: 'stretch' } });
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private _apply(data: BackgroundData): void {
    if (!data) {
      this.bg.set({ fill: '#00000000' });
      return;
    }
    if (data.kind === 'color') {
      this.bg.set({ fill: data.value });
    } else {
      this.bg.set({
        fill: { type: 'image', url: data.url, mode: 'stretch' },
      });
    }
  }
}
