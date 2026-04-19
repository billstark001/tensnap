import { access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ScenarioSnapshot } from '@tensnap/core/scenario';
import { NodeCanvasEnvironmentPainter } from './NodeCanvasEnvironmentPainter';

const tempPaths: string[] = [];

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

describe('NodeCanvasEnvironmentPainter', () => {
  it('renders a grid environment to a PNG artifact', async () => {
    const outputDir = join(tmpdir(), `tensnap-agent-${Date.now()}`);
    tempPaths.push(outputDir);

    const painter = new NodeCanvasEnvironmentPainter({ capturesDir: outputDir });
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
              metadata: { width: 8, height: 6, coord_offset: 'int', background: '#f8fafc' },
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
    expect(typeof artifacts?.[0].path).toBe('string');
    expect(await exists(artifacts?.[0].path as string)).toBe(true);
  });
});