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

export interface ChartTooltip {
  x: number;
  values: Array<{ key: string; label: string; value: number; color: string }>;
}

interface Padding { top: number; right: number; bottom: number; left: number; }
interface SeriesPoint { time: number; value: number; }
interface SampleBucket { first: SeriesPoint; last: SeriesPoint; min: SeriesPoint; max: SeriesPoint; }

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
  const buckets = new Array<SampleBucket | undefined>(pixelWidth);
  for (const point of points) {
    const bucket = Math.max(0, Math.min(pixelWidth - 1, Math.floor(((point.time - xMin) / range) * pixelWidth)));
    const current = buckets[bucket];
    if (!current) {
      buckets[bucket] = { first: point, last: point, min: point, max: point };
      continue;
    }
    current.last = point;
    if (point.value < current.min.value) current.min = point;
    if (point.value > current.max.value) current.max = point;
  }
  const retained: SeriesPoint[] = [];
  for (const bucket of buckets) {
    if (!bucket) continue;
    const candidates = [bucket.first, bucket.min, bucket.max, bucket.last]
      .sort((left, right) => left.time - right.time);
    for (const candidate of candidates) {
      if (retained[retained.length - 1] !== candidate) retained.push(candidate);
    }
  }
  return retained;
}

/** Stream a data column directly into pixel buckets without a full SeriesPoint[] allocation. */
function sampleDataColumn(
  data: ChartDataPoint[],
  key: string,
  xMin: number,
  xMax: number,
  pixelWidth: number,
): SeriesPoint[] {
  const smallSeriesLimit = Math.max(4, pixelWidth * 2);
  const smallSeries: SeriesPoint[] = [];
  let buckets: Array<SampleBucket | undefined> | undefined;
  const range = xMax - xMin || 1;

  const addToBucket = (point: SeriesPoint) => {
    const index = Math.max(0, Math.min(pixelWidth - 1, Math.floor(((point.time - xMin) / range) * pixelWidth)));
    const current = buckets![index];
    if (!current) {
      buckets![index] = { first: point, last: point, min: point, max: point };
      return;
    }
    current.last = point;
    if (point.value < current.min.value) current.min = point;
    if (point.value > current.max.value) current.max = point;
  };

  for (const point of data) {
    const value = point[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(point.time)) continue;
    const seriesPoint = { time: point.time, value };
    if (!buckets) {
      smallSeries.push(seriesPoint);
      if (smallSeries.length <= smallSeriesLimit || pixelWidth <= 1) continue;
      buckets = new Array<SampleBucket | undefined>(pixelWidth);
      for (const buffered of smallSeries) addToBucket(buffered);
      smallSeries.length = 0;
      continue;
    }
    addToBucket(seriesPoint);
  }

  if (!buckets) return smallSeries;
  const sampled: SeriesPoint[] = [];
  for (const bucket of buckets) {
    if (!bucket) continue;
    const candidates = [bucket.first, bucket.min, bucket.max, bucket.last]
      .sort((left, right) => left.time - right.time);
    for (const candidate of candidates) {
      if (sampled[sampled.length - 1] !== candidate) sampled.push(candidate);
    }
  }
  return sampled;
}

/**
 * Shared, DOM-free chart scene. Hosts own canvas allocation/export; this class
 * owns bounds, pixel-aware sampling, axes, and line drawing.
 */
export class ChartScene {
  private data: ChartDataPoint[] = [];
  private config: ChartConfig;
  private dataBounds: ChartBounds = { xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity };
  private indexedDataLength = 0;
  private indexedTail: ChartDataPoint | undefined;

  constructor(config: ChartConfig) {
    this.config = structuredClone(config);
    this.recalculateDataBounds();
  }

  updateData(data: ChartDataPoint[]): void {
    const canAppend = data === this.data
      && data.length >= this.indexedDataLength
      && (this.indexedDataLength === 0 || data[this.indexedDataLength - 1] === this.indexedTail);
    this.data = data;
    if (canAppend) this.extendDataBounds(this.indexedDataLength);
    else this.recalculateDataBounds();
  }

  updateConfig(config: ChartConfig): void {
    this.config = structuredClone(config);
    this.recalculateDataBounds();
  }

  getBounds(): ChartBounds {
    let { xMin, xMax, yMin, yMax } = this.dataBounds;
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

  /** Resolve the nearest x-coordinate without allocating a sampled series. */
  getTooltipAt(pointerX: number, width: number): ChartTooltip | null {
    if (this.config.showTooltip === false || this.data.length === 0) return null;
    const padding: Padding = {
      top: this.config.padding?.top ?? 24,
      right: this.config.padding?.right ?? 20,
      bottom: this.config.padding?.bottom ?? 36,
      left: this.config.padding?.left ?? 54,
    };
    const plotWidth = Math.max(1, width - padding.left - padding.right);
    const bounds = this.getBounds();
    const target = bounds.xMin + ((pointerX - padding.left) / plotWidth) * (bounds.xMax - bounds.xMin || 1);
    const point = this.findNearestPoint(target);
    if (!point) return null;

    const values = this.config.lines.flatMap((line) => {
      const value = point[line.key];
      return typeof value === 'number' && Number.isFinite(value)
        ? [{ key: line.key, label: line.name, value, color: line.color ?? '#8884d8' }]
        : [];
    });
    return values.length ? { x: point.time, values } : null;
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
    const sampled = sampleDataColumn(this.data, line.key, bounds.xMin, bounds.xMax, Math.ceil(plotWidth));
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

  private recalculateDataBounds(): void {
    this.dataBounds = { xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity };
    this.extendDataBounds(0);
  }

  private findNearestPoint(time: number): ChartDataPoint | undefined {
    let low = 0;
    let high = this.data.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.data[middle].time < time) low = middle + 1;
      else high = middle;
    }
    const candidate = this.data[low];
    const previous = low > 0 ? this.data[low - 1] : undefined;
    if (!previous || !Number.isFinite(candidate.time)) return candidate;
    return time - previous.time <= candidate.time - time ? previous : candidate;
  }

  /** The normal chart path appends to a stable data array, so bound updates stay O(appended points). */
  private extendDataBounds(start: number): void {
    let { xMin, xMax, yMin, yMax } = this.dataBounds;
    for (let index = start; index < this.data.length; index += 1) {
      const point = this.data[index];
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
    this.dataBounds = { xMin, xMax, yMin, yMax };
    this.indexedDataLength = this.data.length;
    this.indexedTail = this.data[this.data.length - 1];
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
