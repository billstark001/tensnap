import './leafer-runtime';

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  resolveImageSize,
  resolveViewport,
  type Viewport,
} from '@tensnap/core/environment';
import { layerRegistry, type LayerCreateContext } from '@tensnap/core/scenario';
import { HeadlessEnvironmentView } from '@tensnap/core/environment/headless';
import {
  collectRenderData,
  createRenderPlanFromSnapshot,
  type RenderData,
  type RenderPlan,
  type ScenarioEnvironmentSnapshot,
} from '@tensnap/core/scenario';
import type { RenderFormat } from '../types';
import { normalizeRenderBackgroundColor, type RenderArtifact, type RenderRequest, type ScenePainter } from './painter';
import { buildImageOutputPath, imageMimeType } from './image-output';
import {
  resolveAssetUrls,
  resolveBackgroundBounds,
  resolveBackgroundLayer,
  toExportBuffer,
} from './headless-environment-utils';

export interface HeadlessEnvironmentPainterOptions {
  id?: string;
  capturesDir: string;
  defaultWidth?: number;
  defaultHeight?: number;
  defaultFormat?: RenderFormat;
  backgroundColor?: string;
}

interface ExportableLeafer {
  export: (
    filename: RenderFormat,
    options?: { quality?: number; fill?: string; screenshot?: boolean },
  ) => Promise<{ data: unknown; width: number; height: number; error?: unknown }>;
}
export class HeadlessEnvironmentPainter implements ScenePainter {
  readonly id: string;

  constructor(private readonly options: HeadlessEnvironmentPainterOptions) {
    this.id = options.id ?? 'headless-environment';
  }

  async render(request: RenderRequest): Promise<RenderArtifact[] | void> {
    if (request.options.chartId) return [];
    const targetEnvironments = request.options.envId
      ? request.snapshot.environments.filter((environment) => environment.id === request.options.envId)
      : request.snapshot.environments;

    const artifacts: RenderArtifact[] = [];
    for (const environment of targetEnvironments) {
      const renderData = collectRenderData(environment);
      artifacts.push(
        await this.renderEnvironment(
          environment,
          renderData,
          request,
          targetEnvironments.length > 1,
        ),
      );
    }

    return artifacts;
  }

  private async renderEnvironment(
    snapshotEnvironment: ScenarioEnvironmentSnapshot,
    environment: RenderData,
    request: RenderRequest,
    appendEnvSuffix: boolean,
  ): Promise<RenderArtifact> {
    const viewport = resolveViewport(environment, request.options.viewport);
    const imageSize = resolveImageSize(viewport, environment, request.options.width, request.options.height, {
      defaultWidth: this.options.defaultWidth,
      defaultHeight: this.options.defaultHeight,
    });
    const format = request.options.format ?? this.options.defaultFormat ?? 'png';
    const mime = imageMimeType(format);
    const plan = createRenderPlanFromSnapshot(snapshotEnvironment);
    const assetUrlById = await resolveAssetUrls(plan, snapshotEnvironment, request);

    const envView = new HeadlessEnvironmentView({
      width: imageSize.width,
      height: imageSize.height,
      initialViewport: viewport,
      enableLayerInteraction: false,
    });

    try {
      await this.attachPlanLayers(envView, plan, snapshotEnvironment, environment, viewport, request, assetUrlById);

      if (!request.options.viewport) {
        envView.fitToScene({ padding: plan.fitPadding });
      }

      await envView.waitReady();
      await envView.waitViewReady();
      envView.renderFrame(true);

      const quality = typeof request.options.quality === 'number' ? request.options.quality : undefined;
      const exportResult = await (envView.leafer as unknown as ExportableLeafer).export(format, {
        quality,
        fill: normalizeRenderBackgroundColor(request.options.backgroundColor, this.options.backgroundColor ?? '#000000'),
        screenshot: true,
      });

      if (exportResult.error) {
        throw exportResult.error;
      }

      const buffer = await toExportBuffer(exportResult.data);

      let outputPath: string | undefined;
      if (request.options.persist !== false) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        outputPath = buildImageOutputPath(
          this.options.capturesDir,
          environment.id,
          `${timestamp}-${environment.id}`,
          format,
          request.options.outputPath,
          appendEnvSuffix,
        );
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, buffer);
      }

      return {
        painterId: this.id,
        kind: 'environment',
        mime,
        path: outputPath,
        data: request.options.includeData ? new Uint8Array(buffer) : undefined,
        metadata: {
          envId: environment.id,
          viewport: envView.viewport,
          width: exportResult.width,
          height: exportResult.height,
          format,
        },
      };
    } finally {
      envView.destroy();
    }
  }

  private async attachPlanLayers(
    envView: HeadlessEnvironmentView,
    plan: RenderPlan,
    snapshotEnvironment: ScenarioEnvironmentSnapshot,
    environment: RenderData,
    viewport: Viewport,
    request: RenderRequest,
    assetUrlById: Map<string, string>,
  ): Promise<void> {
    const createdLayers: Array<{ setSceneBounds?(bounds: Partial<Viewport>): void }> = [];

    // Pre-resolve background data for this environment — the headless host
    // has a special fallback path that the browser does not.
    const preResolvedBackground: Map<string, Partial<Viewport>> = new Map();
    for (const layerPlan of plan.layers) {
      if (layerPlan.kind !== 'background') continue;
      const snapshotLayer = snapshotEnvironment.layers.find((l) => l.id === layerPlan.layerId);
      const resolved = await resolveBackgroundLayer(
        layerPlan.storage,
        snapshotLayer?.metadata?.background,
        request,
      );
      const fallbackBounds = resolveBackgroundBounds(environment, viewport, resolved);
      preResolvedBackground.set(layerPlan.layerId, fallbackBounds);
    }

    const linkedEdgeLayers = new Map<string, unknown>();

    for (const layerPlan of plan.layers) {
      // Resolve headless-specific background fallback bounds
      let fallbackBackgroundSceneBounds: Partial<Viewport> | undefined;
      if (layerPlan.kind === 'background') {
        fallbackBackgroundSceneBounds = preResolvedBackground.get(layerPlan.layerId);
      }

      const factoryContext: LayerCreateContext = {
        linkedEdgeLayers: linkedEdgeLayers as Map<string, never>,
        resolveAssetUrl: (assetId: string) => assetUrlById.get(assetId) ?? null,
        clickable: false,
        showLabel: false,
        fallbackBackgroundSceneBounds,
        readOnlyGraphLayout: request.options.readOnlyGraphLayout,
      };

      const created = layerRegistry.createLayer(layerPlan, factoryContext);
      if (!created) continue;

      envView.addLayer(created.layer as never);
      createdLayers.push(created.layer as { setSceneBounds?(bounds: Partial<Viewport>): void });
    }

    if (!plan.sceneBounds) {
      return;
    }

    for (const layer of createdLayers) {
      layer.setSceneBounds?.(plan.sceneBounds);
    }
  }
}
