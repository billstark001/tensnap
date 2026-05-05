import './leafer-runtime';

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  AgentLayer,
  BackgroundLayer,
  EdgeLayer,
  GridLayer,
  TrajectoryLayer,
  resolveImageSize,
  resolveViewport,
  type Viewport,
} from '@tensnap/core/environment';
import { HeadlessEnvironmentView } from '@tensnap/core/environment/headless';
import {
  collectRenderData,
  createRenderPlanFromSnapshot,
  type RenderData,
  type RenderPlan,
  type ScenarioEnvironmentSnapshot,
} from '@tensnap/core/scenario';
import type { RenderFormat } from '../types';
import type { RenderArtifact, RenderRequest, ScenePainter } from './painter';
import {
  buildOutputPath,
  resolveAssetUrls,
  resolveBackgroundBounds,
  resolveBackgroundLayer,
  resolveCanvasBackgroundColor,
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
    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
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
        fill: resolveCanvasBackgroundColor(request.options.backgroundColor, this.options.backgroundColor ?? '#000000'),
        screenshot: true,
      });

      if (exportResult.error) {
        throw exportResult.error;
      }

      const buffer = await toExportBuffer(exportResult.data);

      let outputPath: string | undefined;
      if (request.options.persist !== false) {
        outputPath = buildOutputPath(
          this.options.capturesDir,
          environment.id,
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
    const snapshotLayerById = new Map(snapshotEnvironment.layers.map((layer) => [layer.id, layer]));
    const linkedEdgeLayerByAgentLayerId = new Map<string, EdgeLayer>();
    const createdLayers: Array<{ setSceneBounds?(bounds: Partial<Viewport>): void }> = [];

    for (const layerPlan of plan.layers) {
      switch (layerPlan.role) {
        case 'background': {
          const snapshotLayer = snapshotLayerById.get(layerPlan.layerId);
          const resolved = await resolveBackgroundLayer(
            layerPlan.storage,
            snapshotLayer?.metadata?.background,
            request,
          );
          const fallbackBounds = resolveBackgroundBounds(environment, viewport, resolved);
          const layer = new BackgroundLayer(
            layerPlan.storage,
            layerPlan.sceneBounds ? { sceneBounds: layerPlan.sceneBounds } : { sceneBounds: fallbackBounds },
          );
          if (layerPlan.zIndex !== undefined) {
            layer.setZIndex(layerPlan.zIndex);
          }
          envView.addLayer(layer);
          createdLayers.push(layer);
          break;
        }
        case 'grid': {
          const layer = new GridLayer(layerPlan.storage);
          if (layerPlan.zIndex !== undefined) {
            layer.setZIndex(layerPlan.zIndex);
          }
          envView.addLayer(layer);
          break;
        }
        case 'edge': {
          const layer = new EdgeLayer(layerPlan.storage, layerPlan.agentStorage, layerPlan.config);
          if (layerPlan.zIndex !== undefined) {
            layer.setZIndex(layerPlan.zIndex);
          }
          envView.addLayer(layer);
          linkedEdgeLayerByAgentLayerId.set(layerPlan.agentLayerId, layer);
          break;
        }
        case 'trajectory': {
          const layer = new TrajectoryLayer(layerPlan.storage, {
            coordOffset: layerPlan.coordOffset,
            worldBounds: layerPlan.worldBounds,
          });
          layer.setZIndex(layerPlan.zIndex);
          envView.addLayer(layer);
          break;
        }
        case 'agent': {
          const linkedEdgeLayer = linkedEdgeLayerByAgentLayerId.get(layerPlan.layerId);
          const layer = new AgentLayer(layerPlan.storage, {
            ...(linkedEdgeLayer ? linkedEdgeLayer.buildDragHandlers() : {}),
            clickable: false,
            draggable: layerPlan.usesGraphInteraction,
            showLabel: false,
            originMode: layerPlan.originMode,
            coordOffset: layerPlan.coordOffset,
            sceneBounds: layerPlan.sceneBounds,
            resolveAssetUrl: (assetId) => assetUrlById.get(assetId) ?? null,
          });
          layer.setZIndex(layerPlan.zIndex);
          envView.addLayer(layer);
          createdLayers.push(layer);
          break;
        }
        default:
          break;
      }
    }

    if (!plan.sceneBounds) {
      return;
    }

    for (const layer of createdLayers) {
      layer.setSceneBounds?.(plan.sceneBounds);
    }
  }
}