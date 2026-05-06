import { join, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadImage } from 'canvas';
import {
  getAssetIdFromIcon,
  isBackgroundAssetReference,
  isCssColor,
  type BackgroundData,
  type BackgroundSource,
  type BackgroundStorage,
  type Viewport,
} from '@tensnap/core/environment';
import {
  type RenderData,
  type RenderPlan,
  type ScenarioEnvironmentSnapshot,
} from '@tensnap/core/scenario';
import type { RenderFormat } from '../types';
import type { RenderRequest } from './painter';

export interface CanvasImageSource {
  source: string | Uint8Array;
  mime?: string;
}

type ResolvedBackground =
  | { kind: 'color'; value: string }
  | { kind: 'image'; source: string | Uint8Array; mime?: string; interpolation: 'nearest' | 'linear' };

interface ResolvedImageUrl {
  url: string;
  width: number;
  height: number;
}

export interface ResolvedBackgroundLayer {
  data: BackgroundData;
  width?: number;
  height?: number;
}


export function sanitizeFileName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'scene';
}


export function cloneValue<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  return structuredClone(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isInlineSvgString(value: string): boolean {
  return /^\s*(<svg[\s>]|<\?xml)/i.test(value);
}


export function resolveCanvasBackgroundColor(requested: string | undefined, fallback = '#000000'): string {
  const candidate = typeof requested === 'string' ? requested.trim() : '';
  return candidate || fallback;
}

export function toImageDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

export function decodeDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) {
    throw new Error('Invalid data URL returned by Leafer export.');
  }

  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  return meta.includes(';base64')
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');
}

export function detectImageMime(bytes: Uint8Array, fallback?: string): string {
  if (fallback?.startsWith('image/')) {
    return fallback;
  }

  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp';
  }

  if (
    bytes.length >= 6
    && bytes[0] === 0x47
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39)
    && bytes[5] === 0x61
  ) {
    return 'image/gif';
  }

  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  const headerText = Buffer.from(bytes.slice(0, Math.min(bytes.length, 256))).toString('utf8').trimStart();
  if (isInlineSvgString(headerText)) {
    return 'image/svg+xml';
  }

  throw new Error('Unable to determine image mime type for binary source.');
}

export async function loadCanvasImageSource(input: CanvasImageSource): Promise<Awaited<ReturnType<typeof loadImage>>> {
  if (input.source instanceof Uint8Array) {
    return loadImage(Buffer.from(input.source));
  }

  const source = input.source.trim();
  if (!source) {
    throw new Error('Image source cannot be empty.');
  }

  if (isInlineSvgString(source)) {
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
    return loadImage(dataUrl);
  }

  if (source.startsWith('data:')) {
    return loadImage(source);
  }

  const parsedUrl = tryParseUrl(source);
  if (!parsedUrl) {
    return loadImage(source);
  }

  if (parsedUrl.protocol === 'file:') {
    return loadImage(fileURLToPath(parsedUrl));
  }

  if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Unable to fetch image source: ${response.status} ${response.statusText}`.trim());
    }
    return loadImage(Buffer.from(await response.arrayBuffer()));
  }

  if (parsedUrl.protocol === 'blob:') {
    throw new Error('Headless rendering cannot resolve browser blob URLs. Provide bytes, a data URL, or a file/http URL instead.');
  }

  throw new Error(`Unsupported image source protocol: ${parsedUrl.protocol}`);
}

export function buildOutputPath(
  capturesDir: string,
  envId: string,
  format: RenderFormat,
  explicitOutputPath: string | undefined,
  appendEnvSuffix: boolean,
): string {
  const extension = format === 'jpeg' ? '.jpg' : '.png';

  if (!explicitOutputPath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return join(capturesDir, `${timestamp}-${sanitizeFileName(envId)}${extension}`);
  }

  const resolvedPath = resolve(explicitOutputPath);
  if (!appendEnvSuffix) {
    const parsed = parse(resolvedPath);
    if (parsed.ext) {
      return resolvedPath;
    }
    return join(parsed.dir, `${parsed.name || sanitizeFileName(envId)}${extension}`);
  }

  const parsed = parse(resolvedPath);
  const baseName = parsed.name || sanitizeFileName(envId);
  return join(parsed.dir, `${baseName}-${sanitizeFileName(envId)}${parsed.ext || extension}`);
}


export async function resolveAssetUrls(
  plan: RenderPlan,
  snapshotEnvironment: ScenarioEnvironmentSnapshot,
  request: RenderRequest,
): Promise<Map<string, string>> {
  const assetIds = new Set<string>();

  for (const agentPlan of plan.agentLayers) {
    for (const agent of agentPlan.storage.getData().agents.values()) {
      const assetId = getAssetIdFromIcon(agent.icon);
      if (assetId) {
        assetIds.add(assetId);
      }
    }
  }

  for (const layer of snapshotEnvironment.layers) {
    const background = layer.metadata?.background as BackgroundSource | undefined;
    if (isBackgroundAssetReference(background)) {
      assetIds.add(background.asset_id);
    }
  }

  const entries = await Promise.all(
    [...assetIds].map(async (assetId) => {
      const asset = request.assets[assetId];
      if (!asset) {
        return [assetId, null] as const;
      }

      const resolved = await resolveImageSource({ source: asset.source, mime: asset.mime });
      return [assetId, resolved.url] as const;
    }),
  );

  return new Map(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1])));
}

export async function resolveBackgroundLayer(
  storage: BackgroundStorage,
  rawSource: unknown,
  request: RenderRequest,
): Promise<ResolvedBackgroundLayer | null> {
  const stored = storage.getData();
  if (stored) {
    try {
      const normalized = await normalizeStoredBackground(stored);
      if (normalized) {
        storage.setData(normalized.data);
        return normalized;
      }
    } catch (error) {
      if (rawSource === undefined) {
        throw error;
      }
    }
  }

  const fallback = await resolveBackground(rawSource, request);
  if (!fallback) {
    storage.setData(null);
    return null;
  }

  if (fallback.kind === 'color') {
    const data: BackgroundData = { kind: 'color', value: fallback.value };
    storage.setData(data);
    return { data };
  }

  const image = await resolveImageSource({ source: fallback.source, mime: fallback.mime });
  const data: BackgroundData = {
    kind: 'image',
    url: image.url,
    isBlob: false,
    interpolation: fallback.interpolation,
  };
  storage.setData(data);
  return { data, width: image.width, height: image.height };
}

export function resolveBackgroundBounds(
  environment: RenderData,
  viewport: Viewport,
  background: ResolvedBackgroundLayer | null,
): Partial<Viewport> {
  const width = normalizeDimension(environment.width) ?? normalizeDimension(background?.width) ?? viewport.width;
  const height = normalizeDimension(environment.height) ?? normalizeDimension(background?.height) ?? viewport.height;
  const usesViewportOrigin = environment.width === undefined && environment.height === undefined;

  return {
    x: usesViewportOrigin ? viewport.x : 0,
    y: usesViewportOrigin ? viewport.y : 0,
    width,
    height,
  };
}

export async function toExportBuffer(data: unknown): Promise<Buffer> {
  const resolved = await data;

  if (typeof resolved === 'string') {
    if (resolved.startsWith('data:')) {
      return decodeDataUrl(resolved);
    }
    return Buffer.from(resolved, 'utf8');
  }

  if (Buffer.isBuffer(resolved)) {
    return resolved;
  }

  if (resolved instanceof Uint8Array) {
    return Buffer.from(resolved);
  }

  if (resolved instanceof ArrayBuffer) {
    return Buffer.from(resolved);
  }

  if (ArrayBuffer.isView(resolved)) {
    return Buffer.from(resolved.buffer, resolved.byteOffset, resolved.byteLength);
  }

  if (typeof Blob !== 'undefined' && resolved instanceof Blob) {
    return Buffer.from(await resolved.arrayBuffer());
  }

  throw new Error('Unsupported Leafer export payload type.');
}

async function normalizeStoredBackground(data: BackgroundData): Promise<ResolvedBackgroundLayer | null> {
  if (!data) {
    return null;
  }

  if (data.kind === 'color') {
    return { data: { kind: 'color', value: data.value } };
  }

  if (data.isBlob || data.url.startsWith('blob:')) {
    return null;
  }

  const image = await resolveImageSource({ source: data.url });
  return {
    data: {
      kind: 'image',
      url: image.url,
      isBlob: false,
      interpolation: data.interpolation,
    },
    width: image.width,
    height: image.height,
  };
}

async function resolveBackground(
  environmentSource: unknown,
  request: RenderRequest,
): Promise<ResolvedBackground | null> {
  if (environmentSource === undefined || environmentSource === null) {
    return null;
  }

  if (typeof environmentSource === 'string') {
    const trimmed = environmentSource.trim();
    if (!trimmed) {
      return null;
    }

    if (isCssColor(trimmed)) {
      return { kind: 'color', value: trimmed };
    }

    return { kind: 'image', source: trimmed, interpolation: 'nearest' };
  }

  if (environmentSource instanceof Uint8Array) {
    return { kind: 'image', source: environmentSource, interpolation: 'nearest' };
  }

  if (isBackgroundAssetReference(environmentSource)) {
    const asset = request.assets[environmentSource.asset_id];
    if (!asset) {
      return null;
    }

    return {
      kind: 'image',
      source: asset.source,
      mime: asset.mime,
      interpolation: environmentSource.interpolation ?? 'nearest',
    };
  }

  return null;
}

async function resolveImageSource(input: CanvasImageSource): Promise<ResolvedImageUrl> {
  if (input.source instanceof Uint8Array) {
    const mime = detectImageMime(input.source, input.mime);
    const url = toImageDataUrl(input.source, mime);
    const image = await loadCanvasImageSource({ source: url, mime });
    return { url, width: image.width, height: image.height };
  }

  const source = input.source.trim();
  if (isInlineSvgString(source)) {
    const url = `data:image/svg+xml;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
    const image = await loadCanvasImageSource({ source: url });
    return { url, width: image.width, height: image.height };
  }

  const image = await loadCanvasImageSource({ source, mime: input.mime });
  const parsedUrl = tryParseUrl(source);
  const url = parsedUrl ? source : pathToFileURL(resolve(source)).href;
  return { url, width: image.width, height: image.height };
}

function normalizeDimension(value: number | undefined): number | undefined {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : undefined;
}

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
