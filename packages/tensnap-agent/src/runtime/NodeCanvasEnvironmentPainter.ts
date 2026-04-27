import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { createCanvas, loadImage, type CanvasRenderingContext2D } from 'canvas';
import type { RenderableAgent, AgentStorageSnapshot } from '../../../core/src/environment/storages/AgentStorage';
import type { BackgroundData } from '../../../core/src/environment/storages/BackgroundStorage';
import type { EdgeStorageSnapshot } from '../../../core/src/environment/storages/EdgeStorage';
import type { GridEnvData } from '../../../core/src/environment/storages/GridEnvStorage';
import type { TrajectoryStorageSnapshot } from '../../../core/src/environment/storages/TrajectoryStorage';
import { resolveTrajectoryConfig, resolveTrajectoryRenderStyle, splitTrajectoryPoints } from '../../../core/src/environment/utils/trajectory';
import { applyCoordOffset, getCoordOffsetValue } from '../../../core/src/environment/utils/coords';
import {
  getAssetIdFromIcon,
  isBuiltinAgentIcon,
  type BuiltinAgentIcon,
  type GraphEdge,
  type TrajectoryPoint,
} from '../../../core/src/environment/types/agent';
import type { Viewport } from '../../../core/src/environment/types/viewport';
import { isCssColor } from '../../../core/src/environment/utils/color';
import type { ScenarioEnvironmentSnapshot } from '@tensnap/core/scenario';
import type { RenderFormat } from '../types';
import type { RenderArtifact, RenderRequest, ScenePainter } from './painter';

interface NodeCanvasEnvironmentPainterOptions {
  id?: string;
  capturesDir: string;
  defaultWidth?: number;
  defaultHeight?: number;
  defaultFormat?: RenderFormat;
  backgroundColor?: string;
}

interface AggregatedEnvironment {
  id: string;
  type: string;
  width?: number;
  height?: number;
  grid: GridEnvData;
  background: BackgroundData | null;
  backgroundSource: unknown;
  agentLayers: AggregatedAgentLayer[];
  trajectoryLayers: AggregatedTrajectoryLayer[];
  agents: RenderableAgent[];
  edges: GraphEdge[];
}

interface AggregatedAgentLayer {
  id: string;
  coordOffset: 'int' | 'float';
  agents: RenderableAgent[];
}

interface AggregatedTrajectoryLayer {
  id: string;
  agentLayerId?: string;
  coordOffset: 'int' | 'float';
  config: TrajectoryStorageSnapshot['config'];
  configs: Map<string | number, TrajectoryStorageSnapshot['configs'][number]>;
  trajectories: TrajectoryStorageSnapshot['trajectories'];
}

interface CanvasImageSource {
  source: string | Uint8Array;
  mime?: string;
}

type ResolvedBackground =
  | { kind: 'color'; value: string }
  | { kind: 'image'; source: string | Uint8Array; interpolation: 'nearest' | 'linear' };

function isAgentStorageSnapshot(value: unknown): value is AgentStorageSnapshot {
  return typeof value === 'object' && value !== null && Array.isArray((value as { agents?: unknown[] }).agents);
}

function isEdgeStorageSnapshot(value: unknown): value is EdgeStorageSnapshot {
  return typeof value === 'object' && value !== null && Array.isArray((value as { edges?: unknown[] }).edges);
}

function isTrajectoryStorageSnapshot(value: unknown): value is TrajectoryStorageSnapshot {
  return (
    typeof value === 'object'
    && value !== null
    && Array.isArray((value as { configs?: unknown[] }).configs)
    && Array.isArray((value as { trajectories?: unknown[] }).trajectories)
  );
}

function isBackgroundData(value: unknown): value is BackgroundData {
  return (
    value === null
    || (
      typeof value === 'object'
      && value !== null
      && 'kind' in value
      && (value as { kind?: unknown }).kind !== undefined
    )
  );
}

function polygonPoints(sides: number, radius: number, startDeg = -90): number[] {
  const points: number[] = [];
  const start = (startDeg * Math.PI) / 180;
  for (let index = 0; index < sides; index += 1) {
    const angle = start + (index * 2 * Math.PI) / sides;
    points.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  return points;
}

function starPoints(outerRadius: number, innerRadius: number): number[] {
  const points: number[] = [];
  const start = -Math.PI / 2;
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = start + (index * Math.PI) / 5;
    points.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  return points;
}

function shapePoints(icon: BuiltinAgentIcon, size: number): number[] | null {
  switch (icon) {
    case 'arrow':
      return [size, 0, -size / 2, -size / 2, -size / 2, size / 2];
    case 'triangle':
      return [0, -size / 2, -size / 2, size / 2, size / 2, size / 2];
    case 'diamond':
      return [0, -size / 2, size / 2, 0, 0, size / 2, -size / 2, 0];
    case 'star':
      return starPoints(size / 2, size / 4);
    case 'hexagon':
      return polygonPoints(6, size / 2, -90);
    case 'pentagon':
      return polygonPoints(5, size / 2, -90);
    case 'plus': {
      const w = size / 2;
      const t = size / 6;
      return [-t, -w, t, -w, t, -t, w, -t, w, t, t, t, t, w, -t, w, -t, t, -w, t, -w, -t, -t, -t];
    }
    case 'cross': {
      const w = size / 2;
      const t = size / 6;
      return [-w, -w, -w + t, -w, 0, -t, w - t, -w, w, -w, t, 0, w, w, w - t, w, 0, t, -w + t, w, -w, w, -t, 0];
    }
    default:
      return null;
  }
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'scene';
}

function normalizeViewport(viewport: Viewport): Viewport {
  const width = Math.max(viewport.width, 1e-6);
  const height = Math.max(viewport.height, 1e-6);
  return { x: viewport.x, y: viewport.y, width, height };
}

function worldBoundsFromAgents(agents: RenderableAgent[]): Viewport {
  if (!agents.length) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const agent of agents) {
    const x = agent.x ?? 0;
    const y = agent.y ?? 0;
    const halfSize = (agent.size ?? 1) / 2;
    minX = Math.min(minX, x - halfSize);
    minY = Math.min(minY, y - halfSize);
    maxX = Math.max(maxX, x + halfSize);
    maxY = Math.max(maxY, y + halfSize);
  }
  const padX = Math.max((maxX - minX) * 0.1, 1);
  const padY = Math.max((maxY - minY) * 0.1, 1);
  return {
    x: minX - padX,
    y: minY - padY,
    width: Math.max(maxX - minX + padX * 2, 1),
    height: Math.max(maxY - minY + padY * 2, 1),
  };
}

export function collectEnvironment(environment: ScenarioEnvironmentSnapshot): AggregatedEnvironment {
  const aggregated: AggregatedEnvironment = {
    id: environment.id,
    type: environment.type,
    grid: {},
    background: null,
    backgroundSource: undefined,
    agentLayers: [],
    trajectoryLayers: [],
    agents: [],
    edges: [],
  };

  for (const layer of environment.layers) {
    const metadata = (layer.metadata ?? {}) as Record<string, unknown>;
    if (typeof metadata.width === 'number' && typeof metadata.height === 'number') {
      aggregated.width = metadata.width;
      aggregated.height = metadata.height;
    }
    if (typeof metadata.background !== 'undefined') {
      aggregated.backgroundSource = metadata.background;
    }

    if (layer.layerType === 'grid') {
      Object.assign(aggregated.grid, metadata as GridEnvData);
    }

    if (isAgentStorageSnapshot(layer.storageSnapshot)) {
      const agentLayer: AggregatedAgentLayer = {
        id: layer.id,
        coordOffset: metadata.coord_offset === 'float' ? 'float' : 'int',
        agents: layer.storageSnapshot.agents.map((agent) => ({ ...agent })),
      };
      aggregated.agentLayers.push(agentLayer);
      aggregated.agents.push(...agentLayer.agents.map((agent) => ({ ...agent })));
    }

    if (isTrajectoryStorageSnapshot(layer.storageSnapshot)) {
      aggregated.trajectoryLayers.push({
        id: layer.id,
        agentLayerId: typeof layer.dependencyLayerIds?.agent === 'string' ? layer.dependencyLayerIds.agent : undefined,
        coordOffset: metadata.coord_offset === 'float' ? 'float' : 'int',
        config: { ...layer.storageSnapshot.config },
        configs: new Map(
          layer.storageSnapshot.configs.map((config) => [config.id, { ...config }]),
        ),
        trajectories: layer.storageSnapshot.trajectories.map((trajectory) => ({
          id: trajectory.id,
          points: trajectory.points.map((point) => ({ ...point })),
        })),
      });
    }

    if (isEdgeStorageSnapshot(layer.storageSnapshot)) {
      aggregated.edges.push(...layer.storageSnapshot.edges.map((edge) => ({ ...edge })) as GraphEdge[]);
    }

    if (isBackgroundData(layer.storageSnapshot)) {
      aggregated.background = layer.storageSnapshot;
    }

    if (Array.isArray((metadata as { edges?: unknown[] }).edges)) {
      aggregated.edges.push(...((metadata as { edges: GraphEdge[] }).edges.map((edge) => ({ ...edge }))));
    }
  }

  const agentCoordOffsetByLayerId = new Map(
    aggregated.agentLayers.map((layer) => [layer.id, layer.coordOffset]),
  );
  for (const layer of aggregated.trajectoryLayers) {
    if (layer.agentLayerId) {
      layer.coordOffset = agentCoordOffsetByLayerId.get(layer.agentLayerId) ?? layer.coordOffset;
    }
  }

  return aggregated;
}

async function loadCanvasImageSource(input: CanvasImageSource): Promise<Awaited<ReturnType<typeof loadImage>>> {
  if (input.source instanceof Uint8Array) {
    return loadImage(Buffer.from(input.source));
  }

  if (input.source.startsWith('<svg')) {
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(input.source, 'utf8').toString('base64')}`;
    return loadImage(dataUrl);
  }

  if (input.source.startsWith('data:')) {
    return loadImage(input.source);
  }

  if (
    input.source.startsWith('blob:')
    || input.source.startsWith('http:')
    || input.source.startsWith('https:')
    || input.source.startsWith('file:')
  ) {
    const response = await fetch(input.source);
    const bytes = Buffer.from(await response.arrayBuffer());
    return loadImage(bytes);
  }

  return loadImage(input.source);
}

function buildOutputPath(
  capturesDir: string,
  envId: string,
  format: RenderFormat,
  explicitOutputPath: string | undefined,
  appendEnvSuffix: boolean,
): string {
  if (!explicitOutputPath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return join(capturesDir, `${timestamp}-${sanitizeFileName(envId)}.${format === 'jpeg' ? 'jpg' : 'png'}`);
  }

  const resolvedPath = resolve(explicitOutputPath);
  if (!appendEnvSuffix) {
    return resolvedPath;
  }

  const extension = extname(resolvedPath);
  const baseName = resolvedPath.slice(0, resolvedPath.length - extension.length);
  const nextExtension = extension || `.${format === 'jpeg' ? 'jpg' : 'png'}`;
  return `${baseName}-${sanitizeFileName(envId)}${nextExtension}`;
}

export class NodeCanvasEnvironmentPainter implements ScenePainter {
  readonly id: string;

  constructor(private readonly options: NodeCanvasEnvironmentPainterOptions) {
    this.id = options.id ?? 'node-canvas-environment';
  }

  async render(request: RenderRequest): Promise<RenderArtifact[] | void> {
    const targetEnvironments = request.options.envId
      ? request.snapshot.environments.filter((environment) => environment.id === request.options.envId)
      : request.snapshot.environments;

    const artifacts: RenderArtifact[] = [];
    for (const environment of targetEnvironments) {
      artifacts.push(
        await this.renderEnvironment(
          collectEnvironment(environment),
          request,
          targetEnvironments.length > 1,
        ),
      );
    }

    return artifacts;
  }

  private async renderEnvironment(
    environment: AggregatedEnvironment,
    request: RenderRequest,
    appendEnvSuffix: boolean,
  ): Promise<RenderArtifact> {
    const viewport = this.resolveViewport(environment, request.options.viewport);
    const imageSize = this.resolveImageSize(viewport, environment, request.options.width, request.options.height);
    const canvas = createCanvas(imageSize.width, imageSize.height);
    const context = canvas.getContext('2d');

    context.fillStyle = this.options.backgroundColor ?? '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await this.drawBackground(context, canvas.width, canvas.height, viewport, environment, request);
    this.drawGrid(context, canvas.width, canvas.height, viewport, environment);
    this.drawEdges(context, canvas.width, canvas.height, viewport, environment);
    this.drawTrajectories(context, canvas.width, canvas.height, viewport, environment);
    await this.drawAgents(context, canvas.width, canvas.height, viewport, environment, request);

    const format = request.options.format ?? this.options.defaultFormat ?? 'png';
    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const quality = typeof request.options.quality === 'number' ? request.options.quality : undefined;
    const buffer = format === 'jpeg'
      ? canvas.toBuffer('image/jpeg', { quality })
      : canvas.toBuffer('image/png');

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
        viewport,
        width: canvas.width,
        height: canvas.height,
        format,
      },
    };
  }

  private resolveViewport(environment: AggregatedEnvironment, explicit?: Viewport): Viewport {
    if (explicit) {
      return normalizeViewport(explicit);
    }

    if (typeof environment.width === 'number' && typeof environment.height === 'number') {
      return normalizeViewport({ x: 0, y: 0, width: environment.width, height: environment.height });
    }

    return normalizeViewport(worldBoundsFromAgents(environment.agents));
  }

  private resolveImageSize(
    viewport: Viewport,
    environment: AggregatedEnvironment,
    requestedWidth?: number,
    requestedHeight?: number,
  ): { width: number; height: number } {
    if (requestedWidth && requestedHeight) {
      return { width: Math.max(1, Math.round(requestedWidth)), height: Math.max(1, Math.round(requestedHeight)) };
    }

    if (requestedWidth) {
      return {
        width: Math.max(1, Math.round(requestedWidth)),
        height: Math.max(1, Math.round((requestedWidth / viewport.width) * viewport.height)),
      };
    }

    if (requestedHeight) {
      return {
        width: Math.max(1, Math.round((requestedHeight / viewport.height) * viewport.width)),
        height: Math.max(1, Math.round(requestedHeight)),
      };
    }

    if (typeof environment.width === 'number' && typeof environment.height === 'number') {
      const cellSize = Math.max(12, Math.min(32, Math.floor(960 / Math.max(environment.width, environment.height, 1))));
      return {
        width: Math.max(1, Math.round(environment.width * cellSize)),
        height: Math.max(1, Math.round(environment.height * cellSize)),
      };
    }

    const defaultWidth = this.options.defaultWidth ?? 1024;
    const defaultHeight = this.options.defaultHeight ?? Math.round((defaultWidth / viewport.width) * viewport.height);
    return { width: defaultWidth, height: Math.max(1, defaultHeight) };
  }

  private worldToCanvas(canvasWidth: number, canvasHeight: number, viewport: Viewport, x: number, y: number) {
    const scaleX = canvasWidth / viewport.width;
    const scaleY = canvasHeight / viewport.height;
    return {
      x: (x - viewport.x) * scaleX,
      y: canvasHeight - (y - viewport.y) * scaleY,
      scaleX,
      scaleY,
    };
  }

  private async drawBackground(
    context: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    viewport: Viewport,
    environment: AggregatedEnvironment,
    request: RenderRequest,
  ): Promise<void> {
    const resolved = this.normalizeBackground(environment.background) ?? await this.resolveBackground(environment.backgroundSource, request);
    if (!resolved) {
      return;
    }

    if (resolved.kind === 'color') {
      context.fillStyle = resolved.value;
      context.fillRect(0, 0, canvasWidth, canvasHeight);
      return;
    }

    const image = await loadCanvasImageSource({ source: resolved.source });
    const sceneWidth = environment.width ?? image.width;
    const sceneHeight = environment.height ?? image.height;
    const origin = this.worldToCanvas(canvasWidth, canvasHeight, viewport, 0, sceneHeight);
    const corner = this.worldToCanvas(canvasWidth, canvasHeight, viewport, sceneWidth, 0);
    context.save();
    context.imageSmoothingEnabled = resolved.interpolation !== 'nearest';
    context.drawImage(image, origin.x, origin.y, corner.x - origin.x, corner.y - origin.y);
    context.restore();
  }

  private normalizeBackground(data: BackgroundData): ResolvedBackground | null {
    if (!data) {
      return null;
    }

    if (data.kind === 'color') {
      return { kind: 'color', value: data.value };
    }

    return {
      kind: 'image',
      source: data.url,
      interpolation: data.interpolation,
    };
  }

  private async resolveBackground(environmentSource: unknown, request: RenderRequest): Promise<ResolvedBackground | null> {
    if (environmentSource === undefined || environmentSource === null) {
      return null;
    }

    if (typeof environmentSource === 'string') {
      if (isCssColor(environmentSource)) {
        return { kind: 'color', value: environmentSource };
      }
      return { kind: 'image', source: environmentSource, interpolation: 'nearest' };
    }

    if (environmentSource instanceof Uint8Array) {
      return { kind: 'image', source: environmentSource, interpolation: 'nearest' };
    }

    if (typeof environmentSource === 'object' && environmentSource !== null && 'asset_id' in environmentSource) {
      const assetId = (environmentSource as { asset_id?: unknown }).asset_id;
      if (typeof assetId === 'string') {
        const asset = request.assets[assetId];
        if (asset) {
          return {
            kind: 'image',
            source: asset.source,
            interpolation: (environmentSource as { interpolation?: 'nearest' | 'linear' }).interpolation ?? 'nearest',
          };
        }
      }
    }

    return null;
  }

  private drawGrid(
    context: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    viewport: Viewport,
    environment: AggregatedEnvironment,
  ): void {
    if (typeof environment.width !== 'number' || typeof environment.height !== 'number') {
      return;
    }

    const strokeColor = environment.grid.strokeColor ?? '#d8dee7';
    context.save();
    context.strokeStyle = strokeColor;
    context.lineWidth = 1;
    context.beginPath();

    const startX = Math.max(0, Math.floor(viewport.x));
    const endX = Math.min(environment.width, Math.ceil(viewport.x + viewport.width));
    const startY = Math.max(0, Math.floor(viewport.y));
    const endY = Math.min(environment.height, Math.ceil(viewport.y + viewport.height));

    for (let x = startX; x <= endX; x += 1) {
      const top = this.worldToCanvas(canvasWidth, canvasHeight, viewport, x, environment.height);
      const bottom = this.worldToCanvas(canvasWidth, canvasHeight, viewport, x, 0);
      context.moveTo(top.x, top.y);
      context.lineTo(bottom.x, bottom.y);
    }

    for (let y = startY; y <= endY; y += 1) {
      const left = this.worldToCanvas(canvasWidth, canvasHeight, viewport, 0, y);
      const right = this.worldToCanvas(canvasWidth, canvasHeight, viewport, environment.width, y);
      context.moveTo(left.x, left.y);
      context.lineTo(right.x, right.y);
    }

    context.stroke();
    context.restore();
  }

  private drawEdges(
    context: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    viewport: Viewport,
    environment: AggregatedEnvironment,
  ): void {
    if (!environment.edges.length || !environment.agents.length) {
      return;
    }

    const agents = new Map(environment.agents.map((agent) => [agent.id, agent]));
    context.save();
    for (const edge of environment.edges) {
      const sourceId = typeof edge.source === 'object' && edge.source !== null ? edge.source.id : edge.source;
      const targetId = typeof edge.target === 'object' && edge.target !== null ? edge.target.id : edge.target;
      const source = agents.get(sourceId);
      const target = agents.get(targetId);
      if (!source || !target || source.x === undefined || source.y === undefined || target.x === undefined || target.y === undefined) {
        continue;
      }

      const start = this.worldToCanvas(canvasWidth, canvasHeight, viewport, source.x, source.y);
      const end = this.worldToCanvas(canvasWidth, canvasHeight, viewport, target.x, target.y);
      context.strokeStyle = edge.color ?? '#8b98a8';
      context.lineWidth = Math.max(1, edge.width ?? 1.5);
      context.setLineDash(edge.style === 'dashed' ? [6, 4] : edge.style === 'dotted' ? [2, 4] : []);
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();

      if (edge.directed) {
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const arrowSize = Math.max(6, context.lineWidth * 4);
        context.fillStyle = edge.color ?? '#8b98a8';
        context.beginPath();
        context.moveTo(end.x, end.y);
        context.lineTo(end.x - arrowSize * Math.cos(angle - Math.PI / 6), end.y - arrowSize * Math.sin(angle - Math.PI / 6));
        context.lineTo(end.x - arrowSize * Math.cos(angle + Math.PI / 6), end.y - arrowSize * Math.sin(angle + Math.PI / 6));
        context.closePath();
        context.fill();
      }
    }
    context.restore();
  }

  private drawTrajectories(
    context: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    viewport: Viewport,
    environment: AggregatedEnvironment,
  ): void {
    if (!environment.trajectoryLayers.some((layer) => layer.trajectories.length > 0)) {
      return;
    }

    context.save();
    const worldBounds = (
      typeof environment.width === 'number' && typeof environment.height === 'number'
    ) ? { width: environment.width, height: environment.height } : undefined;
    for (const layer of environment.trajectoryLayers) {
      const offset = getCoordOffsetValue(layer.coordOffset);
      for (const trajectory of layer.trajectories) {
        const segments = splitTrajectoryPoints(trajectory.points, worldBounds);
        if (segments.length === 0) {
          continue;
        }
        const config = layer.configs.get(trajectory.id);
        const resolvedConfig = resolveTrajectoryConfig(config, layer.config);
        const style = resolveTrajectoryRenderStyle(trajectory.points, resolvedConfig);
        context.strokeStyle = style.color;
        context.lineWidth = Math.max(1, style.width);
        for (const segment of segments) {
          context.beginPath();
          segment.forEach((point, index) => {
            const canvasPoint = this.worldToCanvas(canvasWidth, canvasHeight, viewport, point.x + offset, point.y + offset);
            if (index === 0) {
              context.moveTo(canvasPoint.x, canvasPoint.y);
            } else {
              context.lineTo(canvasPoint.x, canvasPoint.y);
            }
          });
          context.stroke();
        }
      }
    }
    context.restore();
  }

  private async drawAgents(
    context: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    viewport: Viewport,
    environment: AggregatedEnvironment,
    request: RenderRequest,
  ): Promise<void> {
    for (const layer of environment.agentLayers) {
      for (const agent of layer.agents) {
        if (agent.x === undefined || agent.y === undefined) {
          continue;
        }

        const scenePoint = applyCoordOffset(agent.x, agent.y, layer.coordOffset);
        const worldPoint = this.worldToCanvas(canvasWidth, canvasHeight, viewport, scenePoint.x, scenePoint.y);
        const sizeInScene = agent.size ?? 1;
        const pixelSize = Math.max(4, sizeInScene * Math.min(worldPoint.scaleX, worldPoint.scaleY));
        const icon = typeof agent.icon === 'string' ? agent.icon : 'circle';
        const color = agent.color ?? '#69b3a2';

        context.save();
        context.translate(worldPoint.x, worldPoint.y);
        context.rotate(-(agent.heading ?? 0));

        if (typeof icon === 'string' && isBuiltinAgentIcon(icon)) {
          this.fillBuiltinShape(context, icon, pixelSize, color);
        } else {
          const assetId = getAssetIdFromIcon(typeof icon === 'string' ? icon : undefined);
          const asset = assetId ? request.assets[assetId] : undefined;
          if (asset) {
            const image = await loadCanvasImageSource({ source: asset.source, mime: asset.mime });
            context.drawImage(image, -pixelSize / 2, -pixelSize / 2, pixelSize, pixelSize);
          } else {
            this.fillBuiltinShape(context, 'circle', pixelSize, color);
          }
        }

        context.restore();
      }
    }
  }

  private fillBuiltinShape(
    context: CanvasRenderingContext2D,
    icon: BuiltinAgentIcon,
    size: number,
    color: string,
  ): void {
    context.fillStyle = color;
    if (icon === 'circle') {
      context.beginPath();
      context.arc(0, 0, size / 2, 0, Math.PI * 2);
      context.fill();
      return;
    }

    if (icon === 'square') {
      context.fillRect(-size / 2, -size / 2, size, size);
      return;
    }

    const points = shapePoints(icon, size);
    if (!points?.length) {
      context.beginPath();
      context.arc(0, 0, size / 2, 0, Math.PI * 2);
      context.fill();
      return;
    }

    context.beginPath();
    context.moveTo(points[0], points[1]);
    for (let index = 2; index < points.length; index += 2) {
      context.lineTo(points[index], points[index + 1]);
    }
    context.closePath();
    context.fill();
  }
}