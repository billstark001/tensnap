/**
 * environment/types/viewport.ts
 *
 * Viewport / canvas geometry types used across layers.
 */

/**
 * Viewport represents the visible rendering area.
 * Coordinate system: +x right, +y up (origin at bottom-left).
 */
export interface Viewport {
  /** X coordinate of the viewport's left edge in scene coordinates. */
  x: number;
  /** Y coordinate of the viewport's bottom edge in scene coordinates. */
  y: number;
  /** Viewport width in scene units. */
  width: number;
  /** Viewport height in scene units. */
  height: number;
}

/**
 * Scene bounding box - defines the extent of all content in the scene.
 * Used to calculate appropriate viewport settings.
 */
export interface SceneBounds {
  /** Minimum x coordinate of scene content. */
  minX: number;
  /** Maximum x coordinate of scene content. */
  maxX: number;
  /** Minimum y coordinate of scene content. */
  minY: number;
  /** Maximum y coordinate of scene content. */
  maxY: number;
}

/**
 * Origin mode for layer content positioning.
 */
export type OriginMode = 'bottom-left' | 'center';

/** Extended viewport with grid cell information (used by GridLayer and AgentLayer). */
export interface GridViewport extends Viewport {
  /** Width of a single grid cell in pixels. */
  cellSize: number;
  /** Number of grid columns. */
  gridWidth: number;
  /** Number of grid rows. */
  gridHeight: number;
  /** Pixel width of the grid canvas (= cellSize * gridWidth). */
  canvasWidth: number;
  /** Pixel height of the grid canvas (= cellSize * gridHeight). */
  canvasHeight: number;
}
