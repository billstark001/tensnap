/**
 * environment/layers/BackgroundLayer.ts
 *
 * Renders a single `Rect` that fills the canvas with either a CSS color
 * or an image (stretch-fit).
 *
 * Default z-index: 0
 */

import { Rect } from 'leafer-ui';
import { BaseLayer } from './BaseLayer';
import { EnvironmentView } from '../EnvironmentView';
import { BackgroundStorage, BackgroundData } from '../storages/BackgroundStorage';
import { Viewport } from '../types';

export class BackgroundLayer extends BaseLayer {
  readonly defaultZIndex = 0;

  private readonly bg: Rect;

  constructor(view: EnvironmentView, storage?: BackgroundStorage) {
    super(view);
    const { width, height } = view.viewport;

    this.bg = new Rect({
      width,
      height,
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
  // Viewport
  // -------------------------------------------------------------------------

  onViewportChange({ width, height }: Viewport): void {
    this.bg.set({ width, height });
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
