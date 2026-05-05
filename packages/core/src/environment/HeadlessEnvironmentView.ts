import { Leafer } from '@leafer-ui/core';
import { BaseEnvironmentView, type BaseEnvironmentViewOptions } from './BaseEnvironmentView';
import type { EnvironmentViewType } from './host';

export interface HeadlessLeaferConfig {
  width: number;
  height: number;
  pixelRatio?: number;
  type?: EnvironmentViewType;
}

export interface HeadlessEnvironmentViewOptions extends BaseEnvironmentViewOptions {
  width: number;
  height: number;
  pixelRatio?: number;
  type?: EnvironmentViewType;
  /**
   * Optional runtime hook for platform-specific Leafer initialization.
   * Node consumers can use this to register a canvas backend before creating the Leafer instance.
   */
  initializeRuntime?: () => void;
  createLeafer?: (config: HeadlessLeaferConfig) => Leafer;
}

export class HeadlessEnvironmentView extends BaseEnvironmentView {
  constructor(options: HeadlessEnvironmentViewOptions) {
    const width = Math.max(1, Math.round(options.width));
    const height = Math.max(1, Math.round(options.height));
    const config: HeadlessLeaferConfig = {
      width,
      height,
      pixelRatio: options.pixelRatio,
      type: options.type ?? 'design',
    };

    options.initializeRuntime?.();
    const leafer = options.createLeafer?.(config) ?? new Leafer(config);

    super(leafer, { width, height }, {
      fitMode: options.fitMode,
      initialViewport: options.initialViewport,
      enableLayerInteraction: options.enableLayerInteraction ?? false,
    });
  }

  setSize(width: number, height: number): void {
    this.updateSurfaceSize(width, height);
  }

  renderFrame(sync = true): void {
    this.leafer.forceRender(undefined, sync);
  }

  waitReady(): Promise<void> {
    return new Promise((resolve) => {
      this.leafer.waitReady(resolve);
    });
  }

  waitViewReady(): Promise<void> {
    return new Promise((resolve) => {
      this.leafer.waitViewReady(resolve);
    });
  }
}