import type { TrajectoryPoint } from '@tensnap/protocol/layers';
import type { GlobalTrajectoryConfig } from '../types';

export const DEFAULT_TRAJECTORY_LENGTH = 1000;
export const DEFAULT_TRAJECTORY_WIDTH = 2;
export const DEFAULT_TRAJECTORY_COLOR = 'rgba(66, 133, 244, 0.5)';

export const DEFAULT_TRAJECTORY_CONFIG: GlobalTrajectoryConfig = {
  length: DEFAULT_TRAJECTORY_LENGTH,
  width: DEFAULT_TRAJECTORY_WIDTH,
  color: DEFAULT_TRAJECTORY_COLOR,
};

type TrajectoryConfigLike = Partial<Pick<GlobalTrajectoryConfig, 'length' | 'width' | 'color'>> | null | undefined;

export interface ResolvedTrajectoryRenderStyle {
  width: number;
  color: string;
}

export interface TrajectoryWorldBounds {
  width?: number;
  height?: number;
}

export function resolveTrajectoryLength(value: number | undefined, fallback = DEFAULT_TRAJECTORY_LENGTH): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

export function resolveTrajectoryWidth(value: number | undefined, fallback = DEFAULT_TRAJECTORY_WIDTH): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

export function resolveTrajectoryColor(value: string | undefined, fallback = DEFAULT_TRAJECTORY_COLOR): string {
  return typeof value === 'string' && value.length > 0
    ? value
    : fallback;
}

export function resolveTrajectoryConfig(
  config?: TrajectoryConfigLike,
  fallback?: TrajectoryConfigLike,
): GlobalTrajectoryConfig {
  const resolvedFallback = {
    length: resolveTrajectoryLength(fallback?.length),
    width: resolveTrajectoryWidth(fallback?.width),
    color: resolveTrajectoryColor(fallback?.color),
  };

  return {
    length: resolveTrajectoryLength(config?.length, resolvedFallback.length),
    width: resolveTrajectoryWidth(config?.width, resolvedFallback.width),
    color: resolveTrajectoryColor(config?.color, resolvedFallback.color),
  };
}

export function resolveTrajectoryRenderStyle(
  points: readonly TrajectoryPoint[],
  config?: Pick<Partial<GlobalTrajectoryConfig>, 'width' | 'color'>,
): ResolvedTrajectoryRenderStyle {
  const pointColor = points.find((point) => typeof point.color === 'string' && point.color.length > 0)?.color;
  return {
    width: resolveTrajectoryWidth(config?.width),
    color: pointColor ?? resolveTrajectoryColor(config?.color),
  };
}

function normalizeExtent(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function shouldBreakSegment(
  previous: TrajectoryPoint,
  current: TrajectoryPoint,
  bounds: TrajectoryWorldBounds | undefined,
): boolean {
  const width = normalizeExtent(bounds?.width);
  if (width !== undefined && Math.abs(current.x - previous.x) > width / 2) {
    return true;
  }

  const height = normalizeExtent(bounds?.height);
  if (height !== undefined && Math.abs(current.y - previous.y) > height / 2) {
    return true;
  }

  return false;
}

export function splitTrajectoryPoints(
  points: readonly TrajectoryPoint[],
  bounds?: TrajectoryWorldBounds,
): TrajectoryPoint[][] {
  if (points.length < 2) {
    return [];
  }

  const segments: TrajectoryPoint[][] = [];
  let currentSegment: TrajectoryPoint[] = [points[0]];

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (shouldBreakSegment(points[index - 1], point, bounds)) {
      if (currentSegment.length >= 2) {
        segments.push(currentSegment);
      }
      currentSegment = [point];
      continue;
    }

    currentSegment.push(point);
  }

  if (currentSegment.length >= 2) {
    segments.push(currentSegment);
  }

  return segments;
}
