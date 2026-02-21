/**
 * environment/layers/GridLayer.ts
 *
 * Renders infinite parametric multi-scale grid lines.
 *
 * Grid line positions along an axis are defined by four parameters (x-axis shown):
 *
 *   position = xOrigin + xUnit · n · xInterval · xRatio^m
 *
 * where:
 *   xOrigin   (x₀) — alignment origin in scene coordinates
 *   xUnit     (a)  — fundamental unit size in scene coordinates
 *   xInterval (b)  — base spacing in units at level m = 0
 *   xRatio    (c)  — integer subdivision ratio (> 1); at each level the spacing
 *                    is xRatio times finer than at the next coarser level
 *   n              — all integers (grid extends to ±∞)
 *   m              — up to 3 levels selected from the current viewport
 *
 * Level-of-detail selection per axis:
 *   The finest level m is the smallest integer where the pixel step
 *   (xUnit · xInterval · xRatio^m · pixelsPerSceneUnit) ≥ THRESHOLD_FINE (20 px).
 *   Levels m, m+1, m+2 are shown, skipping any whose pixel step < THRESHOLD_ANY (4 px).
 *
 * Within each level, lines where `k mod xRatio === 0` coincide with the next
 * coarser level and are omitted (except for the coarsest selected level).
 *
 * Visual style (finest → coarsest):
 *   alpha  : '22' → '55' → 'aa'
 *   weight : 0.6 px → 1.0 px → 1.5 px  (normalised to scene-space stroke width)
 *
 * Default z-index: 10
 *
 * Registered storages:
 *   - GridEnvStorage — supplies all axis parameters and stroke color
 */

import { Line } from 'leafer-ui';
import { BaseLayer } from './BaseLayer';
import { EnvironmentView, EnvironmentViewFitMode } from '../EnvironmentView';
import { GridEnvStorage, GridEnvData } from '../storages/GridEnvStorage';
import { Viewport } from '../types';

// ── LOD pixel-step thresholds ─────────────────────────────────────────────────

/** Minimum pixel-step to show the finest grid level. */
const THRESHOLD_FINE = 10;

/** Absolute minimum pixel-step below which no lines are drawn. */
const THRESHOLD_ANY = 2;

// ── Per-level visual constants (index 0 = finest, 2 = coarsest) ─────────────

/** Hex-alpha suffixes appended to the base stroke color. */
const LEVEL_ALPHAS = ['66', '99', 'cc'] as const;

/** Desired stroke widths in pixels (divided by pixelsPerUnit at render time). */
const LEVEL_WEIGHTS_PX = [0.6, 1.0, 1.5] as const;

/** How far lines extend in the perpendicular direction ("infinite" in scene units). */
const LARGE_EXTENT = 1e7;

// ── Exported interfaces ───────────────────────────────────────────────────────

export interface GridLayerConfig {
  // Reserved for future per-layer visual overrides.
}

// ── GridLayer ─────────────────────────────────────────────────────────────────

export class GridLayer extends BaseLayer {
  readonly defaultZIndex = 10;

  private _envData: GridEnvData;

  constructor(
    view: EnvironmentView,
    storage: GridEnvStorage,
    _config: GridLayerConfig = {}
  ) {
    super(view);

    this._envData = storage.getData();

    this.registerStorage(storage, (data) => {
      this._envData = data;
      this._rebuild();
    });
  }

  // ── IResizableLayer ─────────────────────────────────────────────────────────

  onViewportChange(viewport: Viewport, fitMode: EnvironmentViewFitMode): void {
    this.applyViewportTransform(viewport, fitMode); // updates this._viewport and this._fitMode
    this._rebuild();
  }

  // ── Level-of-detail selection ───────────────────────────────────────────────

  /**
   * Return up to 3 consecutive level indices (finest → coarsest) for one axis.
   *
   * @param unit     Scene-coordinate unit size  (a)
   * @param interval Base interval in units      (b)
   * @param ratio    Subdivision ratio           (c)
   * @param ppu      Pixels per scene unit along this axis
   */
  private _selectLevels(
    unit: number,
    interval: number,
    ratio: number,
    ppu: number
  ): number[] {
    const baseStep = unit * interval;            // scene-unit step at m = 0
    const logRatio = Math.log(ratio);

    // Smallest m where pixel_step_m ≥ THRESHOLD_FINE:
    //   baseStep · ratio^m · ppu ≥ THRESHOLD_FINE
    //   m ≥ log_c(THRESHOLD_FINE / (baseStep · ppu))
    const mFinest = Math.ceil(
      Math.log(THRESHOLD_FINE / (baseStep * ppu)) / logRatio
    );

    const levels: number[] = [];
    for (let dm = 0; dm < 3; dm++) {
      const m = mFinest + dm;
      const pixelStep = baseStep * Math.pow(ratio, m) * ppu;
      if (pixelStep >= THRESHOLD_ANY) {
        levels.push(m);
      }
    }
    return levels;
  }

  // ── Rebuild ─────────────────────────────────────────────────────────────────

  private _rebuild(): void {
    this.group.clear();

    const {
      xOrigin = 0, xUnit = 1, xInterval = 1, xRatio = 10,
      yOrigin = 0, yUnit = 1, yInterval = 1, yRatio = 10,
      strokeColor = '#808080',
    } = this._envData;

    if (xRatio <= 1 || yRatio <= 1) return;

    const scale = this.calculateViewportScale(this._viewport, this._fitMode);
    const { x: viewLeft, y: viewBottom, width: viewW, height: viewH } = this._viewport;
    const viewRight = viewLeft + viewW;
    const viewTop = viewBottom + viewH;

    // ── Vertical lines (X axis) ──────────────────────────────────────────────
    const xLevels = this._selectLevels(xUnit, xInterval, xRatio, scale.scaleX);
    this._drawLines(
      xLevels, xOrigin, xUnit, xInterval, xRatio,
      viewLeft, viewRight,
      -LARGE_EXTENT, LARGE_EXTENT,
      'vertical',
      strokeColor, scale.scaleX,
    );

    // ── Horizontal lines (Y axis) ────────────────────────────────────────────
    const yLevels = this._selectLevels(yUnit, yInterval, yRatio, scale.scaleY);
    this._drawLines(
      yLevels, yOrigin, yUnit, yInterval, yRatio,
      viewBottom, viewTop,
      -LARGE_EXTENT, LARGE_EXTENT,
      'horizontal',
      strokeColor, scale.scaleY,
    );
  }

  // ── Line drawing ────────────────────────────────────────────────────────────

  /**
   * Draw lines for all selected LOD levels on one axis.
   *
   * Positions: origin + unit · interval · ratio^m · k  for k ∈ ℤ.
   *
   * Lines where k mod round(ratio) === 0 coincide with the next coarser level
   * and are omitted — except for the coarsest level which draws all k.
   *
   * @param levels      Ascending level indices (0 = finest).
   * @param origin      Axis origin (x₀ or y₀).
   * @param unit        Unit scale (a).
   * @param interval    Base interval in units (b).
   * @param ratio       Subdivision ratio (c).
   * @param viewMin     Viewport minimum along this axis (scene coords).
   * @param viewMax     Viewport maximum along this axis (scene coords).
   * @param perpMin     Start coordinate in the perpendicular direction.
   * @param perpMax     End coordinate in the perpendicular direction.
   * @param direction   'vertical' for X-axis lines; 'horizontal' for Y-axis.
   * @param strokeColor Base CSS hex color.
   * @param ppu         Pixels per scene unit along this axis.
   */
  private _drawLines(
    levels: number[],
    origin: number,
    unit: number,
    interval: number,
    ratio: number,
    viewMin: number,
    viewMax: number,
    perpMin: number,
    perpMax: number,
    direction: 'vertical' | 'horizontal',
    strokeColor: string,
    ppu: number
  ): void {
    if (levels.length === 0) return;

    const iRatio = Math.round(ratio);   // integer subdivision count (for modulo)
    const baseStep = unit * interval;      // scene-unit step at m = 0

    for (let li = 0; li < levels.length; li++) {
      const m = levels[li];
      const isCoarsest = li === levels.length - 1;
      const step = baseStep * Math.pow(ratio, m);
      const color = this._withAlpha(strokeColor, LEVEL_ALPHAS[li]);
      const weight = LEVEL_WEIGHTS_PX[li] / ppu;   // px → scene units

      const kMin = Math.floor((viewMin - origin) / step) - 1;
      const kMax = Math.ceil((viewMax - origin) / step) + 1;

      for (let k = kMin; k <= kMax; k++) {
        // n = k mod c (with wrap for negative k).
        // n === 0 ⟹ this line belongs to the next coarser level; skip to avoid overdraw.
        const n = ((k % iRatio) + iRatio) % iRatio;
        if (!isCoarsest && n === 0) continue;

        const pos = origin + step * k;
        const pts: [number, number, number, number] =
          direction === 'vertical'
            ? [pos, perpMin, pos, perpMax]
            : [perpMin, pos, perpMax, pos];

        this.group.add(
          new Line({ points: pts, stroke: color, strokeWidth: weight })
        );
      }
    }
  }

  // ── Color helper ────────────────────────────────────────────────────────────

  /**
   * Append (or replace) a 2-char hex alpha suffix on a CSS color string.
   * Supports #RRGGBB and #RRGGBBAA; returns the raw color for other formats.
   */
  private _withAlpha(color: string, hexAlpha: string): string {
    if (/^#[0-9a-fA-F]{6}$/.test(color)) return `${color}${hexAlpha}`;
    if (/^#[0-9a-fA-F]{8}$/.test(color)) return `${color.slice(0, 7)}${hexAlpha}`;
    return color;
  }
}
