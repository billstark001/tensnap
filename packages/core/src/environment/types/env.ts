/**
 * environment/types/env.ts
 *
 * Environment configuration types.
 */

import type { ImageInterpolation } from '../storages/BackgroundStorage';
import type { BackgroundSource } from './background';

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
  background?: BackgroundSource;
  interpolation?: ImageInterpolation;
}

// ---------------------------------------------------------------------------
// Graph environment config
// ---------------------------------------------------------------------------

export interface GraphEnvConfig {
  /** d3-force link distance. */
  linkDistance?: number;
  /** d3-force charge strength (negative = repulsion). */
  chargeStrength?: number;
  /** d3-force centering strength. */
  centeringStrength?: number;
  /** d3-force collision radius. */
  collisionRadius?: number;
  /** Maximum distance between connected components before constraint kicks in. */
  maxComponentDistance?: number;
  componentSpacing?: number;
}
