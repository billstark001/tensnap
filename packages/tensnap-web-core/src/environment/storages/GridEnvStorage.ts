/**
 * environment/storages/GridEnvStorage.ts
 *
 * Stores parametric grid configuration for GridLayer.
 *
 * Grid line positions along X are: xOrigin + xUnit * n * xInterval * xRatio^m
 * for all integers n and viewport-selected level m.
 * Y axis is symmetric with independent parameters.
 *
 * Parameters per axis (example for X):
 *   xOrigin   — alignment origin in scene coordinates  (x0)
 *   xUnit     — fundamental unit size in scene coords  (a)
 *   xInterval — number of units per base-level spacing  (b)
 *   xRatio    — subdivision ratio between levels, integer > 1  (c)
 *
 * At each level m the grid spacing is:  xUnit * xInterval * xRatio^m
 * Within one period of the next-coarser level there are xRatio sub-lines
 * (n = 0 … xRatio−1); n = 0 coincides with the coarser level's line.
 */

import { BaseStorage } from './BaseStorage';

export interface GridEnvData {
  // ── X axis ──────────────────────────────────────────────────────────────

  /** X origin: vertical lines align to  xOrigin + xUnit·n·xInterval·xRatio^m.
   *  Default: 0. */
  xOrigin?: number;
  /** Fundamental unit size along X in scene coordinates (parameter a).
   *  Default: 1. */
  xUnit?: number;
  /** Base interval count for X: number of units between level-0 lines (parameter b).
   *  Default: 1. */
  xInterval?: number;
  /** X subdivision ratio — integer > 1 (parameter c).  Default: 10. */
  xRatio?: number;

  // ── Y axis ──────────────────────────────────────────────────────────────

  /** Y origin: horizontal lines align to  yOrigin + yUnit·n·yInterval·yRatio^m.
   *  Default: 0. */
  yOrigin?: number;
  /** Fundamental unit size along Y in scene coordinates (parameter a).
   *  Default: 1. */
  yUnit?: number;
  /** Base interval count for Y (parameter b).  Default: 1. */
  yInterval?: number;
  /** Y subdivision ratio — integer > 1 (parameter c).  Default: 10. */
  yRatio?: number;

  // ── Visual ──────────────────────────────────────────────────────────────

  /** Base stroke color (CSS hex string).  Alpha is applied per level.
   *  Default: '#808080'. */
  strokeColor?: string;
  // ── Scene bounds (used by AgentLayer, not by GridLayer) ──────────────────
}

export class GridEnvStorage extends BaseStorage<GridEnvData> {
  constructor(initial?: GridEnvData) {
    super(initial ?? {});
  }
}
