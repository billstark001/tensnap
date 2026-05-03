import type { GridCoordOffset } from '../types/env';

export function getCoordOffsetValue(coordOffset: GridCoordOffset | undefined | null): number {
  return coordOffset === 'float' ? 0 : 0.5;
}

export function applyCoordOffset(
  x: number | undefined,
  y: number | undefined,
  coordOffset: GridCoordOffset | undefined | null,
): { x: number; y: number } {
  const offset = getCoordOffsetValue(coordOffset);
  return {
    x: (x ?? 0) + offset,
    y: (y ?? 0) + offset,
  };
}