import type { ChartConfig, ChartDataPoint, LineConfig } from './types';

/** Minimal common surface implemented by browser and node-canvas 2D contexts. */
export interface ChartCanvasContext {
  canvas?: { width: number; height: number };
  clearRect(x: number, y: number, width: number, height: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  save(): void;
  restore(): void;
  rect(x: number, y: number, width: number, height: number): void;
  clip(): void;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
}

export type ChartTheme = 'light' | 'dark';

export interface ChartRenderOptions {
  theme?: ChartTheme;
  pixelRatio?: number;
}

export interface ChartBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

interface Padding { top: number; right: number; bottom: number; left: number; }
interface SeriesPoint { time: number; value: number; }

const light = {
  background: '#ffffff', grid: '#e0e0e0', axis: '#333333', text: '#666666', label: '#333333',
};
const dark = {
  background: '#1f1f1f', grid: '#404040', axis: '#cccccc', text: '#b0b0b0', label: '#e0e0e0',
};

function normalizeBounds(min: number, max: number): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const padding = Math.abs(min) * 0.1 || 1;
    return [min - padding, max + padding];
  }
  return [min, max];
}

function niceTicks(min: number, max: number, count = 6): number[] {
  const range = max - min;
  if (!Number.isFinite(range) || range <= 0) return [min];
  const rough = range / Math.max(1, count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const first = Math.ceil(min / step) * step;
  const result: number[] = [];
  for (let tick = first; tick <= max + step * 1e-9; tick += step) result.push(Number(tick.toPrecision(14)));
  return result;
}

function formatTick(value: number): string {
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e5 || magnitude < 1e-3) return value.toExponential(1);
  return Number(value.toPrecision(4)).toString();
}

/** Min/max bucket sampling preserves extrema at a canvas-pixel granularity. */
export function downsampleSeries(points: SeriesPoint[], xMin: number, xMax: number, pixelWidth: number): SeriesPoint[] {
  if (points.length <= Math.max(4, pixelWidth * 2) || pixelWidth <= 1) return points;
  const range = xMax - xMin || 1;
  const buckets = new Map<number, { first: SeriesPoint; last: SeriesPoint; min: SeriesPoint; max: SeriesPoint }>();
  for (const point of points) {
    const bucket = Math.max(0, Math.min(pixelWidth - 1, Math.floor(((point.time - xMin) / range) * pixelWidth)));
    const current = buckets.get(bucket);
    if (!current) {
      buckets.set(bucket, { first: point, last: point, min: point, max: point });
      continue;
    }
    current.last = point;
    if (point.value < current.min.value) current.min = point;
    if (point.value > current.max.value) current.max = point;
  }
  const retained = new Set<SeriesPoint>();
  for (const bucket of buckets.values()) {
    retained.add(bucket.first);
    retained.add(bucket.min);
    retained.add(bucket.max);
    retained.add(bucket.last);
  }
  return points.filter((point) => retained.has(point));
}

/**
 * Shared, DOM-free chart scene. Hosts own canvas allocation/export; this class
 * owns bounds, pixel-aware sampling, axes, and line drawing.
 */
export class ChartScene {
  private data: ChartDataPoint[] = [];
  private config: ChartConfig;

  constructor(config: ChartConfig) {
    this.config = structuredClone(config);
  }

  updateData(data: ChartDataPoint[]): void {
    this.data = data;
  }

  updateConfig(config: ChartConfig): void {
    this.config = structuredClone(config);
  }

  getBounds(): ChartBounds {
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const point of this.data) {
      if (Number.isFinite(point.time)) {
        xMin = Math.min(xMin, point.time);
        xMax = Math.max(xMax, point.time);
      }
      for (const line of this.config.lines) {
        const value = point[line.key];
        if (typeof value === 'number' && Number.isFinite(value)) {
          yMin = Math.min(yMin, value);
          yMax = Math.max(yMax, value);
        }
      }
    }
    [xMin, xMax] = normalizeBounds(xMin, xMax);
    [yMin, yMax] = normalizeBounds(yMin, yMax);
    if (this.config.smartAxisBounds) {
      const xTicks = niceTicks(xMin, xMax);
      const yTicks = niceTicks(yMin, yMax);
      if (xTicks.length > 1) [xMin, xMax] = [xTicks[0], xTicks[xTicks.length - 1]];
      if (yTicks.length > 1) [yMin, yMax] = [yTicks[0], yTicks[yTicks.length - 1]];
    } else {
      const padding = (yMax - yMin) * 0.1;
      yMin -= padding;
      yMax += padding;
    }
    return { xMin, xMax, yMin, yMax };
  }

  render(context: ChartCanvasContext, width: number, height: number, options: ChartRenderOptions = {}): void {
    const colors = options.theme === 'dark' ? dark : light;
    const ratio = options.pixelRatio ?? 1;
    const cssWidth = width / ratio;
    const cssHeight = height / ratio;
    const padding: Padding = {
      top: this.config.padding?.top ?? 24,
      right: this.config.padding?.right ?? 20,
      bottom: this.config.padding?.bottom ?? 36,
      left: this.config.padding?.left ?? 54,
    };
    const plotWidth = Math.max(1, cssWidth - padding.left - padding.right);
    const plotHeight = Math.max(1, cssHeight - padding.top - padding.bottom);
    const bounds = this.getBounds();
    const xTicks = niceTicks(bounds.xMin, bounds.xMax);
    const yTicks = niceTicks(bounds.yMin, bounds.yMax);
    const x = (value: number) => padding.left + ((value - bounds.xMin) / (bounds.xMax - bounds.xMin || 1)) * plotWidth;
    const y = (value: number) => padding.top + plotHeight - ((value - bounds.yMin) / (bounds.yMax - bounds.yMin || 1)) * plotHeight;

    context.save();
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.fillStyle = colors.background;
    context.fillRect(0, 0, cssWidth, cssHeight);
    context.font = '10px sans-serif';
    context.lineWidth = 1;

    if (this.config.showGrid !== false) {
      context.strokeStyle = colors.grid;
      for (const tick of xTicks) {
        context.beginPath(); context.moveTo(x(tick), padding.top); context.lineTo(x(tick), padding.top + plotHeight); context.stroke();
      }
      for (const tick of yTicks) {
        context.beginPath(); context.moveTo(padding.left, y(tick)); context.lineTo(padding.left + plotWidth, y(tick)); context.stroke();
      }
    }

    context.strokeStyle = colors.axis;
    context.fillStyle = colors.text;
    if (this.config.showXAxis !== false) {
      context.beginPath(); context.moveTo(padding.left, padding.top + plotHeight); context.lineTo(padding.left + plotWidth, padding.top + plotHeight); context.stroke();
      context.textAlign = 'center'; context.textBaseline = 'top';
      for (const tick of xTicks) context.fillText(formatTick(tick), x(tick), padding.top + plotHeight + 6);
    }
    if (this.config.showYAxis !== false) {
      context.beginPath(); context.moveTo(padding.left, padding.top); context.lineTo(padding.left, padding.top + plotHeight); context.stroke();
      context.textAlign = 'right'; context.textBaseline = 'middle';
      for (const tick of yTicks) context.fillText(formatTick(tick), padding.left - 7, y(tick));
    }

    context.save();
    context.rect(padding.left, padding.top, plotWidth, plotHeight);
    context.clip();
    for (const line of this.config.lines) this.renderLine(context, line, bounds, x, y, plotWidth);
    context.restore();

    if (this.config.showLegend !== false) this.renderLegend(context, colors.label, padding, plotWidth);
    context.restore();
  }

  private renderLine(
    context: ChartCanvasContext,
    line: LineConfig,
    bounds: ChartBounds,
    x: (value: number) => number,
    y: (value: number) => number,
    plotWidth: number,
  ): void {
    const values: SeriesPoint[] = [];
    for (const point of this.data) {
      const value = point[line.key];
      if (typeof value === 'number' && Number.isFinite(value) && Number.isFinite(point.time)) values.push({ time: point.time, value });
    }
    const sampled = downsampleSeries(values, bounds.xMin, bounds.xMax, Math.ceil(plotWidth));
    if (sampled.length < 2) return;
    context.beginPath();
    context.strokeStyle = line.color ?? '#8884d8';
    context.lineWidth = line.strokeWidth ?? 2;
    sampled.forEach((point, index) => {
      if (index === 0) context.moveTo(x(point.time), y(point.value));
      else context.lineTo(x(point.time), y(point.value));
    });
    context.stroke();
  }

  private renderLegend(context: ChartCanvasContext, labelColor: string, padding: Padding, plotWidth: number): void {
    let left = padding.left;
    let top = padding.top + 4;
    context.font = '11px sans-serif';
    context.textBaseline = 'middle';
    for (const line of this.config.lines) {
      const itemWidth = 22 + line.name.length * 7;
      if (left + itemWidth > padding.left + plotWidth && left > padding.left) {
        left = padding.left;
        top += 15;
      }
      context.fillStyle = line.color ?? '#8884d8';
      context.fillRect(left, top - 5, 10, 10);
      context.fillStyle = labelColor;
      context.textAlign = 'left';
      context.fillText(line.name, left + 14, top);
      left += itemWidth;
    }
  }
}
