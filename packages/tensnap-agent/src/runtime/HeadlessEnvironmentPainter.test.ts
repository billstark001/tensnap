import { access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas, loadImage, type CanvasRenderingContext2D } from 'canvas';
import { afterEach, describe, expect, it } from 'vitest';
import { collectRenderData } from '@tensnap/core/scenario';
import type { ScenarioSnapshot } from '@tensnap/core/scenario';
import { HeadlessEnvironmentPainter } from './HeadlessEnvironmentPainter';

const tempPaths: string[] = [];
const onePixelPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';
const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#ef4444"/></svg>',
  'utf8',
).toString('base64')}`;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function createContextFromArtifactBytes(bytes: Uint8Array) {
  const image = await loadImage(Buffer.from(bytes));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return { context, width: image.width, height: image.height };
}

function hasNonBlackPixelAround(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius = 2,
): boolean {
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const pixel = context.getImageData(x + offsetX, y + offsetY, 1, 1).data;
      if (pixel[3] > 0 && (pixel[0] !== 0 || pixel[1] !== 0 || pixel[2] !== 0)) {
        return true;
      }
    }
  }

  return false;
}

describe('HeadlessEnvironmentPainter', () => {
  it('renders an environment to a PNG artifact', async () => {
    const outputDir = join(tmpdir(), `tensnap-agent-${Date.now()}`);
    tempPaths.push(outputDir);

    const painter = new HeadlessEnvironmentPainter({ capturesDir: outputDir });
    const snapshot: ScenarioSnapshot = {
      metadata: { time: 3 },
      actions: [],
      parameters: [],
      charts: [],
      logs: [],
      environments: [
        {
          id: 'main',
          type: '2d',
          layers: [
            {
              id: '',
              layerType: 'agent',
              metadata: { width: 8, height: 6, coord_offset: 'int' },
              dependencyLayerIds: {},
              storageSnapshot: {
                agents: [
                  { id: 'bird-1', x: 1, y: 2, color: '#ef4444', icon: 'circle', size: 0.8 },
                  { id: 'bird-2', x: 5, y: 4, color: '#2563eb', icon: 'triangle', heading: Math.PI / 4, size: 0.9 },
                ],
                trajectories: [
                  { id: 'bird-1', points: [{ x: 0.5, y: 1.5, time: 1 }, { x: 1, y: 2, time: 2 }] },
                ],
              },
            },
          ],
        },
      ],
    };

    const artifacts = await painter.render({
      at: new Date().toISOString(),
      reason: 'test-render',
      trigger: 'explicit',
      snapshot,
      options: { envId: 'main', width: 320, height: 240, includeData: true },
      assets: {},
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts?.[0].mime).toBe('image/png');
    expect(artifacts?.[0].data).toBeInstanceOf(Uint8Array);
    expect((artifacts?.[0].data as Uint8Array).byteLength).toBeGreaterThan(0);
    expect(artifacts?.[0].metadata).toMatchObject({ width: 320, height: 240, envId: 'main', format: 'png' });
    expect(typeof artifacts?.[0].path).toBe('string');
    expect(await exists(artifacts?.[0].path as string)).toBe(true);
  });

  it('accepts explicit data-url background strings', async () => {
    const outputDir = join(tmpdir(), `tensnap-agent-${Date.now()}-data-url`);
    tempPaths.push(outputDir);

    const painter = new HeadlessEnvironmentPainter({ capturesDir: outputDir });
    const snapshot: ScenarioSnapshot = {
      metadata: { time: 1 },
      actions: [],
      parameters: [],
      charts: [],
      logs: [],
      environments: [
        {
          id: 'main',
          type: '2d',
          layers: [
            {
              id: 'background',
              layerType: 'background',
              metadata: {
                background: svgDataUrl,
              },
              dependencyLayerIds: {},
              storageSnapshot: null,
            },
            {
              id: '',
              layerType: 'agent',
              metadata: {
                width: 2,
                height: 2,
                coord_offset: 'int',
              },
              dependencyLayerIds: {},
              storageSnapshot: {
                agents: [],
                trajectories: [],
              },
            },
          ],
        },
      ],
    };

    const artifacts = await painter.render({
      at: new Date().toISOString(),
      reason: 'data-url-background',
      trigger: 'explicit',
      snapshot,
      options: { envId: 'main', width: 64, height: 64, includeData: true },
      assets: {},
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts?.[0].data).toBeInstanceOf(Uint8Array);
  });

  it('does not guess bare base64 strings as mixed-field backgrounds', async () => {
    const outputDir = join(tmpdir(), `tensnap-agent-${Date.now()}-bare-base64`);
    tempPaths.push(outputDir);

    const painter = new HeadlessEnvironmentPainter({ capturesDir: outputDir });
    const snapshot: ScenarioSnapshot = {
      metadata: { time: 1 },
      actions: [],
      parameters: [],
      charts: [],
      logs: [],
      environments: [
        {
          id: 'main',
          type: '2d',
          layers: [
            {
              id: 'background',
              layerType: 'background',
              metadata: {
                background: onePixelPngBase64,
              },
              dependencyLayerIds: {},
              storageSnapshot: null,
            },
            {
              id: '',
              layerType: 'agent',
              metadata: {
                width: 2,
                height: 2,
                coord_offset: 'int',
              },
              dependencyLayerIds: {},
              storageSnapshot: {
                agents: [],
                trajectories: [],
              },
            },
          ],
        },
      ],
    };

    await expect(painter.render({
      at: new Date().toISOString(),
      reason: 'bare-base64-background',
      trigger: 'explicit',
      snapshot,
      options: { envId: 'main', width: 64, height: 64, includeData: true },
      assets: {},
    })).rejects.toThrow();
  });

  it('defaults the canvas background to black and allows per-render overrides', async () => {
    const outputDir = join(tmpdir(), `tensnap-agent-${Date.now()}-background-color`);
    tempPaths.push(outputDir);

    const painter = new HeadlessEnvironmentPainter({ capturesDir: outputDir });
    const snapshot: ScenarioSnapshot = {
      metadata: {},
      actions: [],
      parameters: [],
      charts: [],
      logs: [],
      environments: [
        {
          id: 'main',
          type: '2d',
          layers: [
            {
              id: 'agents',
              layerType: 'agent',
              metadata: { width: 1, height: 1, coord_offset: 'int' },
              dependencyLayerIds: {},
              storageSnapshot: { agents: [], trajectories: [] },
            },
          ],
        },
      ],
    };

    const [defaultArtifact] = await painter.render({
      at: new Date().toISOString(),
      reason: 'default-background',
      trigger: 'explicit',
      snapshot,
      options: { envId: 'main', width: 32, height: 32, includeData: true, persist: false },
      assets: {},
    }) ?? [];

    const defaultContext = await createContextFromArtifactBytes(defaultArtifact.data as Uint8Array);
    expect([...defaultContext.context.getImageData(16, 16, 1, 1).data]).toEqual([0, 0, 0, 255]);

    const [overrideArtifact] = await painter.render({
      at: new Date().toISOString(),
      reason: 'override-background',
      trigger: 'explicit',
      snapshot,
      options: {
        envId: 'main',
        width: 32,
        height: 32,
        includeData: true,
        persist: false,
        backgroundColor: '#123456',
      },
      assets: {},
    }) ?? [];

    const overrideContext = await createContextFromArtifactBytes(overrideArtifact.data as Uint8Array);
    expect([...overrideContext.context.getImageData(16, 16, 1, 1).data]).toEqual([18, 52, 86, 255]);
  });

  it('renders grid lines in headless exports', async () => {
    const outputDir = join(tmpdir(), `tensnap-agent-${Date.now()}-grid`);
    tempPaths.push(outputDir);

    const painter = new HeadlessEnvironmentPainter({ capturesDir: outputDir });
    const snapshot: ScenarioSnapshot = {
      metadata: {},
      actions: [],
      parameters: [],
      charts: [],
      logs: [],
      environments: [
        {
          id: 'main',
          type: '2d',
          layers: [
            {
              id: 'grid',
              layerType: 'grid',
              metadata: { width: 4, height: 4 },
              dependencyLayerIds: {},
              storageSnapshot: {},
            },
          ],
        },
      ],
    };

    const [artifact] = await painter.render({
      at: new Date().toISOString(),
      reason: 'grid-render',
      trigger: 'explicit',
      snapshot,
      options: {
        envId: 'main',
        width: 400,
        height: 400,
        includeData: true,
        persist: false,
        backgroundColor: '#000000',
      },
      assets: {},
    }) ?? [];

    const { context } = await createContextFromArtifactBytes(artifact.data as Uint8Array);
    expect(hasNonBlackPixelAround(context, 200, 200)).toBe(true);
  });

  it('reports artifact metadata for selected environments and explicit viewports', async () => {
    const outputDir = join(tmpdir(), `tensnap-agent-${Date.now()}-metadata`);
    tempPaths.push(outputDir);

    const painter = new HeadlessEnvironmentPainter({ capturesDir: outputDir });
    const viewport = { x: 2, y: 3, width: 4, height: 5 };
    const snapshot: ScenarioSnapshot = {
      metadata: {},
      actions: [],
      parameters: [],
      charts: [],
      logs: [],
      environments: [
        {
          id: 'main',
          type: '2d',
          layers: [
            {
              id: 'main-agents',
              layerType: 'agent',
              metadata: { width: 8, height: 8, coord_offset: 'int' },
              dependencyLayerIds: {},
              storageSnapshot: { agents: [{ id: 'main-a', x: 1, y: 1 }], trajectories: [] },
            },
          ],
        },
        {
          id: 'report',
          type: '2d',
          layers: [
            {
              id: 'report-agents',
              layerType: 'agent',
              metadata: { width: 10, height: 10, coord_offset: 'int' },
              dependencyLayerIds: {},
              storageSnapshot: { agents: [{ id: 'report-a', x: 3, y: 4 }], trajectories: [] },
            },
          ],
        },
      ],
    };

    const artifacts = await painter.render({
      at: new Date().toISOString(),
      reason: 'metadata-parity',
      trigger: 'explicit',
      snapshot,
      options: {
        envId: 'report',
        viewport,
        width: 200,
        height: 100,
        format: 'jpeg',
        quality: 0.8,
        includeData: true,
        persist: false,
      },
      assets: {},
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts?.[0].path).toBeUndefined();
    expect(artifacts?.[0].mime).toBe('image/jpeg');
    expect(artifacts?.[0].metadata).toEqual({
      envId: 'report',
      viewport,
      width: 200,
      height: 100,
      format: 'jpeg',
    });
  });

  it('keeps coord_offset scoped to each agent layer', () => {
    const snapshot: ScenarioSnapshot = {
      metadata: {},
      actions: [],
      parameters: [],
      charts: [],
      logs: [],
      environments: [
        {
          id: 'main',
          type: '2d',
          layers: [
            {
              id: 'agents-int',
              layerType: 'agent',
              metadata: { coord_offset: 'int' },
              dependencyLayerIds: {},
              storageSnapshot: { agents: [{ id: 'a', x: 0, y: 0 }], trajectories: [] },
            },
            {
              id: 'agents-float',
              layerType: 'agent',
              metadata: { coord_offset: 'float' },
              dependencyLayerIds: {},
              storageSnapshot: { agents: [{ id: 'b', x: 1, y: 1 }], trajectories: [] },
            },
          ],
        },
      ],
    };

    const aggregated = collectRenderData(snapshot.environments[0]);

    expect(aggregated.agentLayers).toHaveLength(2);
    expect(aggregated.agentLayers.map((layer) => ({ id: layer.id, coordOffset: layer.coordOffset }))).toEqual([
      { id: 'agents-int', coordOffset: 'int' },
      { id: 'agents-float', coordOffset: 'float' },
    ]);
  });

  it('does not treat trajectory stroke width as environment width', () => {
    const snapshot: ScenarioSnapshot = {
      metadata: {},
      actions: [],
      parameters: [],
      charts: [],
      logs: [],
      environments: [
        {
          id: 'main',
          type: '2d',
          layers: [
            {
              id: 'grid',
              layerType: 'grid',
              metadata: { width: 40, height: 40 },
              dependencyLayerIds: {},
              storageSnapshot: {},
            },
            {
              id: 'trails',
              layerType: 'trajectory',
              metadata: { width: 3, color: '#f59e0b' },
              dependencyLayerIds: {},
              storageSnapshot: {
                config: { length: 5, width: 3, color: '#f59e0b' },
                configs: [],
                trajectories: [],
              },
            },
          ],
        },
      ],
    };

    const aggregated = collectRenderData(snapshot.environments[0]);

    expect(aggregated.width).toBe(40);
    expect(aggregated.height).toBe(40);
  });
});
