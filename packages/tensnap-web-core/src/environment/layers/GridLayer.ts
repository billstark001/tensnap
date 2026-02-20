/**
 * environment/layers/GridLayer.ts
 *
 * Renders grid reference lines with parametric level-of-detail.
 *
 * The grid subdivision ratio can be configured separately for x and y directions.
 * Based on computed pixel density, the layer decides which lines to draw and how thick.
 *
 * Subdivision ratio: How many cells between major grid lines (default: 10).
 * Must be greater than 1.
 *
 * Line rendering strategy:
 *   High density (≥ 20px/cell)  → show all lines (minor + major)
 *   Medium density (≥ 4px/cell) → show major lines only
 *   Low density (< 4px/cell)    → no lines (too dense)
 *
 * Major lines are drawn with full strokeColor.
 * Minor lines are drawn at 40% alpha.
 * Stroke width scales with pixel density.
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
import { Viewport, SceneBounds, OriginMode, IBoundedLayer } from '../types';

/** Pixels-per-cell thresholds governing which lines are shown. */
const THRESHOLD_ALL = 20;   // show every cell line
const THRESHOLD_MAJOR = 4;  // show major lines only

/** Alpha suffixes for major/minor lines (appended to hex color). */
const ALPHA_MAJOR = 'aa'; // ~67%
const ALPHA_MINOR = '44'; // ~27%

export interface GridLayerConfig {
  /**
   * Grid subdivision ratio in x direction (columns between major lines).
   * Must be > 1. Default: 10.
   */
  subdivisionX?: number;
  /**
   * Grid subdivision ratio in y direction (rows between major lines).
   * Must be > 1. Default: 10.
   */
  subdivisionY?: number;
  /**
   * Origin mode for the grid.
   * Default: 'bottom-left'
   */
  originMode?: OriginMode;
}

export class GridLayer extends BaseLayer implements IBoundedLayer {
  readonly defaultZIndex = 10;

  private _envData: GridEnvData;
  private _viewport: Viewport;
  private readonly _config: Required<GridLayerConfig>;

  constructor(
    view: EnvironmentView,
    storage: GridEnvStorage,
    config: GridLayerConfig = {}
  ) {
    super(view);
    
    // Validate and store config
    const subdivisionX = config.subdivisionX ?? 10;
    const subdivisionY = config.subdivisionY ?? 10;
    
    if (subdivisionX <= 1 || subdivisionY <= 1) {
      throw new Error('Grid subdivision ratios must be greater than 1');
    }
    
    this._config = {
      subdivisionX,
      subdivisionY,
      originMode: config.originMode ?? 'bottom-left',
    };

    this._envData = storage.getData();
    this._viewport = view.viewport;

    this.registerStorage(storage, (data) => {
      this._envData = data;
      this._rebuild();
    });
  }

  // -------------------------------------------------------------------------
  // IBoundedLayer implementation
  // -------------------------------------------------------------------------

  getSceneBounds(): SceneBounds | null {
    const { width: cols, height: rows } = this._envData;
    if (cols <= 0 || rows <= 0) return null;

    if (this._config.originMode === 'center') {
      return {
        minX: -cols / 2,
        maxX: cols / 2,
        minY: -rows / 2,
        maxY: rows / 2,
      };
    } else {
      // bottom-left
      return {
        minX: 0,
        maxX: cols,
        minY: 0,
        maxY: rows,
      };
    }
  }

  getOriginMode(): OriginMode {
    return this._config.originMode;
  }

  // -------------------------------------------------------------------------
  // IResizableLayer
  // -------------------------------------------------------------------------

  onViewportChange(viewport: Viewport): void {
    this._viewport = viewport;
    this.applyViewportTransform(viewport);
    this._rebuild();
  }

  // -------------------------------------------------------------------------
  // Build / rebuild grid lines
  // -------------------------------------------------------------------------

  private _rebuild(): void {
    this.group.clear();

    const { width: cols, height: rows, strokeColor = '#808080' } = this._envData;
    if (cols <= 0 || rows <= 0) return;

    const container = this.getContainerSize();
    const scale = this.calculateViewportScale(this._viewport);
    
    // Calculate pixel size per cell
    const pixelsPerCellX = scale.scaleX;
    const pixelsPerCellY = scale.scaleY;
    const minPixelsPerCell = Math.min(pixelsPerCellX, pixelsPerCellY);

    // Decide LOD
    if (minPixelsPerCell < THRESHOLD_MAJOR) return; // Too small — no lines.

    const showMinor = minPixelsPerCell >= THRESHOLD_ALL;
    const strokeWidth = this._computeStrokeWidth(minPixelsPerCell);

    const majorColor = this._withAlpha(strokeColor, ALPHA_MAJOR);
    const minorColor = this._withAlpha(strokeColor, ALPHA_MINOR);

    // Determine grid bounds based on origin mode
    const bounds = this.getSceneBounds();
    if (!bounds) return;

    const { minX, maxX, minY, maxY } = bounds;

    // Vertical lines
    for (let i = 0; i <= cols; i++) {
      const isMajorX = i % this._config.subdivisionX === 0;
      if (!showMinor && !isMajorX) continue;
      
      const x = minX + i;
      const line = new Line({
        points: [x, minY, x, maxY],
        stroke: isMajorX ? majorColor : minorColor,
        strokeWidth: isMajorX ? strokeWidth : strokeWidth * 0.6,
      });
      this.group.add(line);
    }

    // Horizontal lines
    for (let j = 0; j <= rows; j++) {
      const isMajorY = j % this._config.subdivisionY === 0;
      if (!showMinor && !isMajorY) continue;
      
      const y = minY + j;
      const line = new Line({
        points: [minX, y, maxX, y],
        stroke: isMajorY ? majorColor : minorColor,
        strokeWidth: isMajorY ? strokeWidth : strokeWidth * 0.6,
      });
      this.group.add(line);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Map pixel density → stroke width. */
  private _computeStrokeWidth(pixelsPerCell: number): number {
    if (pixelsPerCell >= 60) return 2;
    if (pixelsPerCell >= 20) return 1;
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
