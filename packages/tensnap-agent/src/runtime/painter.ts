import type { ScenarioSnapshot } from '@tensnap/core/scenario';
import type { SceneRenderOptions } from '../types';
import type { RenderTriggerMode } from '../types';

export interface RenderAssetSource {
  id: string;
  hash: string;
  mime: string;
  source: string | Uint8Array;
}

export interface RenderRequest {
  at: string;
  reason: string;
  trigger: RenderTriggerMode | 'explicit';
  snapshot: ScenarioSnapshot;
  options: SceneRenderOptions;
  assets: Record<string, RenderAssetSource>;
}

export interface RenderArtifact {
  painterId: string;
  kind: 'environment' | 'chart' | 'composite';
  mime?: string;
  path?: string;
  data?: Uint8Array;
  metadata?: Record<string, unknown>;
}

export interface ScenePainter {
  readonly id: string;
  render(request: RenderRequest): Promise<RenderArtifact[] | void>;
}