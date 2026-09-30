import { join, parse } from 'node:path';
import type { RenderFormat } from '../types';

export function sanitizeFileName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'scene';
}

export function imageMimeType(format: RenderFormat): 'image/jpeg' | 'image/png' {
  return format === 'jpeg' ? 'image/jpeg' : 'image/png';
}

export function buildImageOutputPath(
  capturesDir: string,
  artifactId: string,
  fallbackBaseName: string,
  format: RenderFormat,
  explicitOutputPath: string | undefined,
  appendArtifactSuffix: boolean,
): string {
  const extension = format === 'jpeg' ? '.jpg' : '.png';

  if (!explicitOutputPath) {
    return join(capturesDir, `${sanitizeFileName(fallbackBaseName)}${extension}`);
  }

  const parsed = parse(explicitOutputPath);
  const baseName = parsed.name || sanitizeFileName(fallbackBaseName);
  const suffix = appendArtifactSuffix ? `-${sanitizeFileName(artifactId)}` : '';
  return join(parsed.dir, `${baseName}${suffix}${parsed.ext || extension}`);
}

export function appendImageOutputSuffix(
  explicitOutputPath: string,
  artifactId: string,
  format: RenderFormat,
): string {
  return buildImageOutputPath('', artifactId, 'scene', format, explicitOutputPath, true);
}
