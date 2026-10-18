import { appendImageOutputSuffix } from './image-output';
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

/** Fixed request input shared read-only across painters; copy any nested values before mutation. */
export interface RenderRequest {
  at: string;
  reason: string;
  trigger: RenderTriggerMode | 'explicit';
  snapshot: ScenarioSnapshot;
  options: SceneRenderOptions;
  assets: Record<string, RenderAssetSource>;
}

/** Published read-only output; detach reusable buffers/metadata before returning it. */
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
  /** Borrow the stable request for this asynchronous render; never mutate its scene, options or assets. */
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

/** Shared live/offline batch contract: preserve partial failures and disambiguate output paths. */
export async function renderPainterBatch(
  painters: readonly ScenePainter[],
  request: RenderRequest,
  onFailure?: (painter: ScenePainter, error: unknown) => Promise<void>,
): Promise<RenderArtifact[]> {
  const artifacts: RenderArtifact[] = [];
  const errors: RenderTargetError[] = [];
  const disambiguate = Boolean(
    request.options.outputPath &&
    !request.options.envId &&
    !request.options.chartId &&
    painters.length > 1,
  );
  for (const painter of painters) {
    try {
      const input = disambiguate
        ? {
            ...request,
            options: {
              ...request.options,
              outputPath: appendImageOutputSuffix(
                request.options.outputPath!,
                painter.id,
                request.options.format ?? 'png',
              ),
            },
          }
        : request;
      artifacts.push(...((await painter.render(input)) ?? []));
    } catch (error) {
      if (error instanceof RenderBatchError) {
        artifacts.push(...error.artifacts);
        errors.push(...error.errors);
      } else
        errors.push(
          renderTargetError(painter.id, request.options.envId ?? request.options.chartId, error),
        );
      await onFailure?.(painter, error);
    }
  }
  if (!artifacts.length && !errors.length)
    errors.push({
      painterId: '*',
      targetId: request.options.envId ?? request.options.chartId,
      code: 'render_missing',
      message: 'No render artifacts were produced.',
    });
  if (errors.length) throw new RenderBatchError(artifacts, errors);
  return artifacts;
}
