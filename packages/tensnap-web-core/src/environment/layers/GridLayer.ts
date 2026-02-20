/**
 * environment/layers/GridLayer.ts
 *
 * Renders grid reference lines with Cinema 4D-style level-of-detail:
 *
 * The grid subdivision unit is 10.  Based on computed `cellSize` (pixels per
 * grid cell) the layer decides which lines to draw and how thick:
 *
 *   cellSize ≥ 20px  → every cell line (minor + major)
 *   cellSize ≥  4px  → every 10-cell line (major only)
 *   cellSize <  4px  → no lines (too dense to be useful)
 *
 * Major lines (multiples of 10) are drawn with full `strokeColor`.
 * Minor lines (all others) are drawn at 40% alpha.
 * Stroke width scales with cellSize for readability.
 *
 * Default z-index: 10
 *
 * Registered storages:
 *   - GridEnvStorage — supplies grid dimensions and stroke color
 */

import { Line } from 'leafer-ui';
import { BaseLayer } from './BaseLayer';
import { EnvironmentView } from '../EnvironmentView';
import { GridEnvStorage, GridEnvData } from '../storages/GridEnvStorage';
import { Viewport } from '../types';

/** Pixels-per-cell thresholds governing which lines are shown. */
const THRESHOLD_ALL = 20;   // show every cell line
const THRESHOLD_MAJOR = 4;  // show every 10th line only
const MAJOR_STEP = 10;

/** Alpha suffixes for major/minor lines (appended to hex color). */
const ALPHA_MAJOR = 'aa'; // ~67%
const ALPHA_MINOR = '44'; // ~27%

export class GridLayer extends BaseLayer {
  readonly defaultZIndex = 10;

  private _envData: GridEnvData;
  private _viewport: Viewport;

  constructor(view: EnvironmentView, storage: GridEnvStorage) {
    super(view);
    this._envData = storage.getData();
    this._viewport = view.viewport;

    this.registerStorage(storage, (data) => {
      this._envData = data;
      this._rebuild();
    });
  }

  // -------------------------------------------------------------------------
  // IResizableLayer
  // -------------------------------------------------------------------------

  onViewportChange(viewport: Viewport): void {
    this._viewport = viewport;
    this._rebuild();
  }

  // -------------------------------------------------------------------------
  // Build / rebuild grid lines
  // -------------------------------------------------------------------------

  private _rebuild(): void {
    this.group.clear();

    const { width: cols, height: rows, strokeColor = '#808080' } = this._envData;
    const { width: canvasW, height: canvasH } = this._viewport;

    if (cols <= 0 || rows <= 0 || canvasW <= 0 || canvasH <= 0) return;

    const cellW = canvasW / cols;
    const cellH = canvasH / rows;
    const cellSize = Math.min(cellW, cellH);

    // Decide LOD
    if (cellSize < THRESHOLD_MAJOR) return; // Too small — no lines.

    const showMinor = cellSize >= THRESHOLD_ALL;
    const strokeWidth = this._computeStrokeWidth(cellSize);

    const majorColor = this._withAlpha(strokeColor, ALPHA_MAJOR);
    const minorColor = this._withAlpha(strokeColor, ALPHA_MINOR);

    // Vertical lines (x = i * cellW)
    for (let i = 0; i <= cols; i++) {
      if (!showMinor && i % MAJOR_STEP !== 0) continue;
      const isMajor = i % MAJOR_STEP === 0;
      const x = i * cellW;
      this.group.add(
        new Line({
          points: [x, 0, x, canvasH],
          stroke: isMajor ? majorColor : minorColor,
          strokeWidth: isMajor ? strokeWidth : strokeWidth * 0.6,
        })
      );
    }

    // Horizontal lines (y = j * cellH)
    for (let j = 0; j <= rows; j++) {
      if (!showMinor && j % MAJOR_STEP !== 0) continue;
      const isMajor = j % MAJOR_STEP === 0;
      const y = j * cellH;
      this.group.add(
        new Line({
          points: [0, y, canvasW, y],
          stroke: isMajor ? majorColor : minorColor,
          strokeWidth: isMajor ? strokeWidth : strokeWidth * 0.6,
        })
      );
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Map cellSize → stroke width (1px at 20px cell, thicker at larger cells). */
  private _computeStrokeWidth(cellSize: number): number {
    if (cellSize >= 60) return 2;
    if (cellSize >= 20) return 1;
    return 0.5;
  }

  /**
   * Append or replace 2-char hex alpha on a CSS color string.
   * Falls back to the raw color if it cannot be parsed.
   */
  private _withAlpha(color: string, hexAlpha: string): string {
    // #RRGGBB → #RRGGBBAA
    if (/^#[0-9a-fA-F]{6}$/.test(color)) return `${color}${hexAlpha}`;
    // #RRGGBBAA → replace alpha
    if (/^#[0-9a-fA-F]{8}$/.test(color)) return `${color.slice(0, 7)}${hexAlpha}`;
    // Named or rgb/hsl — return as-is (alpha injection not trivial)
    return color;
  }
}
