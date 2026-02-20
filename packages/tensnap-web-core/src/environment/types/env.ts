/**
 * environment/types/env.ts
 *
 * Environment configuration types.
 */

/** How grid coordinates map to canvas pixels.
 * - 'int'   → agent at (x, y) is centered in cell (x, y)  [integer coords]
 * - 'float' → agent at (x, y) is placed at pixel (x * cellSize, y * cellSize)
 */
export type GridCoordOffset = 'int' | 'float';

// ---------------------------------------------------------------------------
// Grid environment config
// ---------------------------------------------------------------------------

export interface GridEnvConfig {
  /** Number of columns. */
  width: number;
  /** Number of rows. */
  height: number;
  coordOffset?: GridCoordOffset;
  background?: string | Uint8Array;
  /** Default trajectory trail length (≤0 means unlimited). */
  trajectoryLength?: number;
  trajectoryColor?: string;
}

// ---------------------------------------------------------------------------
// Graph environment config
// ---------------------------------------------------------------------------

export interface GraphEnvConfig {
  /** d3-force link distance. */
  linkDistance?: number;
  /** d3-force charge strength (negative = repulsion). */
  chargeStrength?: number;
  /** d3-force collision radius. */
  collisionRadius?: number;
  /** Maximum distance between connected components before constraint kicks in. */
  maxComponentDistance?: number;
  componentSpacing?: number;
}
