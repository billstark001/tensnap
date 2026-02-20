/**
 * environment/types/viewport.ts
 *
 * Viewport / canvas geometry types used across layers.
 */

export interface Viewport {
  /** Canvas width in CSS pixels. */
  width: number;
  /** Canvas height in CSS pixels. */
  height: number;
}

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
