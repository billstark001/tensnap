import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { createCanvas } from 'canvas';
import { ChartScene, type ChartConfig, type ChartGroup } from '@tensnap/core/chart';
import type { RenderFormat } from '../types';
import type { RenderArtifact, RenderRequest, ScenePainter } from './painter';

export interface HeadlessChartPainterOptions {
  id?: string;
  capturesDir: string;
  defaultWidth?: number;
  defaultHeight?: number;
  defaultFormat?: RenderFormat;
  theme?: 'light' | 'dark';
}

function colorFor(id: string): string {
  const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#8dd1e1', '#d084d0'];
  let value = 0;
  for (const char of id) value = (value * 31 + char.charCodeAt(0)) | 0;
  return colors[Math.abs(value) % colors.length];
}

function chartConfig(group: ChartGroup): ChartConfig {
  return {
    lines: Object.values(group.metadataDict).map((metadata) => ({
      key: metadata.id,
      name: metadata.label,
      color: metadata.color || colorFor(metadata.id),
      strokeWidth: 2,
    })),
    showGrid: true,
    showXAxis: true,
    showYAxis: true,
    showLegend: true,
    showTooltip: false,
  };
}

function mime(format: RenderFormat): string {
  return format === 'jpeg' ? 'image/jpeg' : 'image/png';
}

/** Node-canvas host for the exact same ChartScene rendered in the browser. */
export class HeadlessChartPainter implements ScenePainter {
  readonly id: string;

  constructor(private readonly options: HeadlessChartPainterOptions) {
    this.id = options.id ?? 'headless-chart';
  }

  async render(request: RenderRequest): Promise<RenderArtifact[]> {
    const charts = request.options.chartId
      ? request.snapshot.charts.filter((group) => group.id === request.options.chartId || request.options.chartId! in group.metadataDict)
      : request.snapshot.charts;
    const artifacts: RenderArtifact[] = [];
    for (const group of charts) artifacts.push(await this.renderGroup(group, request, charts.length > 1));
    return artifacts;
  }

  private async renderGroup(group: ChartGroup, request: RenderRequest, appendId: boolean): Promise<RenderArtifact> {
    const width = Math.max(1, request.options.width ?? this.options.defaultWidth ?? 960);
    const height = Math.max(1, request.options.height ?? this.options.defaultHeight ?? 480);
    const format = request.options.format ?? this.options.defaultFormat ?? 'png';
    const canvas = createCanvas(width, height);
    const scene = new ChartScene(chartConfig(group));
    scene.updateData(group.data);
    scene.render(canvas.getContext('2d'), width, height, { theme: this.options.theme ?? 'light' });
    const data = format === 'jpeg'
      ? canvas.toBuffer('image/jpeg', { quality: request.options.quality })
      : canvas.toBuffer('image/png');

    let path: string | undefined;
    if (request.options.persist !== false) {
      const suffix = appendId ? `-${group.id}` : '';
      const requested = request.options.outputPath;
      const requestedExtension = requested ? extname(requested) : '';
      path = requested
        ? appendId
          ? join(
            dirname(requested),
            `${basename(requested, requestedExtension)}${suffix}${requestedExtension || `.${format}`}`,
          )
          : requested
        : join(this.options.capturesDir, `chart-${group.id}-${Date.now()}.${format}`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    }

    return {
      painterId: this.id,
      kind: 'chart',
      mime: mime(format),
      path,
      data: request.options.includeData === false ? undefined : new Uint8Array(data),
      metadata: { chartId: group.id, width, height, points: group.data.length },
    };
  }
}
