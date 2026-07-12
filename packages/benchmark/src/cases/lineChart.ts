import type { ChartConfig, ChartDataPoint } from '@tensnap/core';
import type { BenchmarkCase } from '../types';

interface Config { lineCount: number; pointCount: number; width: number; height: number }
const colors = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7'];

function createData(config: Config, frame = 0): ChartDataPoint[] {
  return Array.from({ length: config.pointCount }, (_, pointIndex) => {
    const point: ChartDataPoint = { time: pointIndex };
    for (let lineIndex = 0; lineIndex < config.lineCount; lineIndex += 1) {
      point[`line_${lineIndex}`] = 50 + Math.sin((pointIndex + frame + lineIndex * 3) / 8) * 40;
    }
    return point;
  });
}

export function createLineChartCase(partial: Partial<Config> = {}): BenchmarkCase {
  const config: Config = {
    lineCount: partial.lineCount ?? 20,
    pointCount: partial.pointCount ?? 120,
    width: partial.width ?? 800,
    height: partial.height ?? 360,
  };
  const chartConfig: ChartConfig = {
    lines: Array.from({ length: config.lineCount }, (_, index) => ({
      key: `line_${index}`, name: `Line ${index}`, color: colors[index % colors.length], strokeWidth: 1.5,
    })),
    showGrid: true, showXAxis: true, showYAxis: true, showLegend: false, showTooltip: false,
  };
  return {
    name: 'CanvasChartView multi-line update',
    category: 'component',
    config: { ...config },
    async mount(container) {
      const { mountWebChartBenchmark } = await import('@tensnap/web/benchmark');
      const mounted = await mountWebChartBenchmark(container, { ...config, config: chartConfig, initialData: createData(config) });
      return { kind: 'component', tick: (frame) => mounted.updateData(createData(config, frame)), destroy: mounted.destroy };
    },
  };
}
