import { afterEach, describe, expect, it } from 'vitest';
import { stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HeadlessChartPainter } from './HeadlessChartPainter';

const paths: string[] = [];

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('HeadlessChartPainter', () => {
  it('renders a chart group through the shared ChartScene', async () => {
    const capturesDir = join(tmpdir(), `tensnap-chart-${Date.now()}`);
    paths.push(capturesDir);
    const painter = new HeadlessChartPainter({ capturesDir });
    const artifacts = await painter.render({
      at: new Date().toISOString(),
      reason: 'test',
      trigger: 'explicit',
      snapshot: {
        metadata: {}, actions: [], parameters: [], environments: [], logs: [], assets: [],
        charts: [{
          id: 'population', label: 'Population',
          metadataDict: { alive: { id: 'alive', label: 'Alive', color: '#22c55e' } },
          data: [{ time: 0, alive: 2 }, { time: 1, alive: 5 }, { time: 2, alive: 3 }],
        }],
      },
      options: { includeData: true },
      assets: {},
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].kind).toBe('chart');
    expect(artifacts[0].data?.byteLength).toBeGreaterThan(0);
    await expect(stat(artifacts[0].path!)).resolves.toBeDefined();
  });
});
