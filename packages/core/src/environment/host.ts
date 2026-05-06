import type { Leafer } from '@leafer-ui/core';
import type { Viewport } from './types';

export type EnvironmentViewType = 'design' | 'board' | 'document' | 'custom';
export type EnvironmentViewFitMode = 'stretch' | 'contain' | 'cover';

export interface EnvironmentSurfaceSize {
  width: number;
  height: number;
}

export interface EnvironmentLayerHost {
  readonly leafer: Leafer;
  readonly viewport: Viewport;
  readonly fitMode: EnvironmentViewFitMode;
  readonly interactionEnabled: boolean;
  getSurfaceSize(): EnvironmentSurfaceSize;
  setCanvasSmoothing?(enabled: boolean, quality?: 'low' | 'medium' | 'high'): void;
}

export interface IResizableLayer {
  readonly zIndex: number;
  attachToHost(host: EnvironmentLayerHost): void;
  detachFromHost(): void;
  setInteractionEnabled?(enabled: boolean): void;
  onViewportChange(viewport: Viewport, fitMode: EnvironmentViewFitMode): void;
  reattachTo(parent: Leafer): void;
  destroy(): void;
}