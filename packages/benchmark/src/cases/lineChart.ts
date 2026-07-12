/**
 * cases/lineChart.ts
 *
 * Benchmark: BrowserChartView with random multi-line data updates.
 *
 * Each tick generates N_POINTS random data points across N_LINES lines
 * and calls `lineChart.updateData(data)`, which fully re-renders canvas.
 */

import { ChartDataPoint } from '@tensnap/core/chart';
import { BrowserChartView } from '@tensnap/core/chart/browser';
import { BenchmarkCase } from '../types';

interface Config {
  /** Number of simultaneous lines. */
  lineCount: number;
  /** Number of data points per frame. */
  pointCount: number;
  /** Canvas width. */
  width: number;
  /** Canvas height. */
  height: number;
}

const LINE_COLORS = [
  '#4e79a7', '#f28e2b', '#e15759', '#76b7b2',
  '#59a14f', '#edc948', '#b07aa1', '#ff9da7',
];

function makeConfig(cfg: Config) {
  return {
    lines: Array.from({ length: cfg.lineCount }, (_, i) => ({
      key: `line_${i}`,
      name: `Line ${i}`,
      color: LINE_COLORS[i % LINE_COLORS.length],
      strokeWidth: 1.5,
    })),
    showGrid: true,
    showXAxis: true,
    showYAxis: true,
    showLegend: false,
    showTooltip: false,
  };
}

function randomData(cfg: Config): ChartDataPoint[] {
  const now = Date.now();
  return Array.from({ length: cfg.pointCount }, (_, i) => {
    const point: ChartDataPoint = { time: now - (cfg.pointCount - 1 - i) * 100 };
    for (let l = 0; l < cfg.lineCount; l++) {
      point[`line_${l}`] = Math.random() * 100;
    }
    return point;
  });
}

export function createLineChartCase(partial: Partial<Config> = {}): BenchmarkCase {
  const cfg: Config = {
    lineCount: partial.lineCount ?? 6,
    pointCount: partial.pointCount ?? 60,
    width: partial.width ?? 600,
    height: partial.height ?? 300,
  };

  let chart: BrowserChartView | null = null;
  let host: HTMLElement | null = null;

  return {
    name: 'Canvas chart (multi-line random)',
    suite: 'synthetic' as const,
    config: cfg as unknown as Record<string, unknown>,

    setup(container) {
      host = document.createElement('div');
      host.style.cssText = `
        width: ${cfg.width}px; height: ${cfg.height}px;
        overflow: hidden;
      `;
      container.appendChild(host);
      chart = new BrowserChartView(host, makeConfig(cfg));
      chart.resize(cfg.width, cfg.height);
      // Initial render with some data
      chart.updateData(randomData(cfg));
    },

    tick() {
      chart!.updateData(randomData(cfg));
    },

    teardown() {
      chart?.destroy();
      host?.remove();
      host = null;
      chart = null;
    },
  };
}
