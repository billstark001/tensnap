/** Renderer fallback for absent or invalid agent marker diameters. */
export function resolveAgentSize(size: number | undefined): number {
  return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : 1;
}
