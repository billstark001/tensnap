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
// Graph environment config
// ---------------------------------------------------------------------------

export interface GraphEnvConfig {
  /** d3-force link distance. */
  link_distance?: number;
  /** d3-force charge strength (negative = repulsion). */
  charge_strength?: number;
  /** d3-force centering strength. */
  centering_strength?: number;
  /** d3-force collision radius. */
  collision_radius?: number;
  /** Maximum distance between connected components before constraint kicks in. */
  max_component_distance?: number;
  component_spacing?: number;
}
