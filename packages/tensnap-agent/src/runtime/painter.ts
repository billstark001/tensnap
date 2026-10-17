import type { ScenarioSnapshot } from '@tensnap/core/scenario';
import type { SceneRenderOptions } from '../types';
import type { RenderTriggerMode } from '../types';

export function normalizeRenderBackgroundColor(
  value: string | undefined,
  fallback = '#000000',
): string {
  return value?.trim() || fallback;
}

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

export interface RenderTargetError {
  painterId: string;
  targetId?: string;
  code: 'render_failed' | 'persistence_failed' | 'render_missing';
  message: string;
}

/** A failed batch preserves all completed artifacts and target failures. */
export class RenderBatchError extends Error {
  constructor(
    readonly artifacts: RenderArtifact[],
    readonly errors: RenderTargetError[],
  ) {
    super(
      errors.map((error) => `${error.targetId ?? error.painterId}: ${error.message}`).join('; '),
    );
    this.name = 'RenderBatchError';
  }
}

export class RenderPersistenceError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
    this.name = 'RenderPersistenceError';
  }
}

export function renderTargetError(
  painterId: string,
  targetId: string | undefined,
  error: unknown,
): RenderTargetError {
  return {
    painterId,
    targetId,
    code: error instanceof RenderPersistenceError ? 'persistence_failed' : 'render_failed',
    message: error instanceof Error ? error.message : String(error),
  };
}
