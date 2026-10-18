import { afterEach, describe, expect, it } from 'vitest';
import { stat, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { HeadlessChartPainter } from './HeadlessChartPainter';

const paths: string[] = [];

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('HeadlessChartPainter', () => {
  it('skips an explicitly environment-targeted render', async () => {
    const painter = new HeadlessChartPainter({ capturesDir: tmpdir() });
    const artifacts = await painter.render({
      at: new Date().toISOString(),
      reason: 'test',
      trigger: 'explicit',
      snapshot: {
        metadata: {},
        actions: [],
        parameters: [],
        environments: [],
        monitors: [],
        logs: [],
        assets: [],
        charts: [{ id: 'population', label: 'Population', metadataDict: {}, data: [] }],
      },
      options: { envId: 'main', outputPath: join(tmpdir(), 'environment.png') },
      assets: {},
    });

    expect(artifacts).toEqual([]);
  });

  it('renders a chart group through the shared ChartScene', async () => {
    const capturesDir = join(tmpdir(), `tensnap-chart-${Date.now()}`);
    paths.push(capturesDir);
    const painter = new HeadlessChartPainter({ capturesDir });
    const artifacts = await painter.render({
      at: new Date().toISOString(),
      reason: 'test',
      trigger: 'explicit',
      snapshot: {
        metadata: {},
        actions: [],
        parameters: [],
        environments: [],
        monitors: [],
        logs: [],
        assets: [],
        charts: [
          {
            id: 'population',
            label: 'Population',
            metadataDict: { alive: { id: 'alive', label: 'Alive', color: '#22c55e' } },
            data: [
              { time: 0, alive: 2 },
              { time: 1, alive: 5 },
              { time: 2, alive: 3 },
            ],
          },
        ],
      },
      options: { includeData: true },
      assets: {},
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].kind).toBe('chart');
    expect(artifacts[0].data?.byteLength).toBeGreaterThan(0);
    await expect(stat(artifacts[0].path!)).resolves.toBeDefined();
  });

  it.each(['relative', 'absolute'] as const)(
    'adds each chart suffix to the basename for a %s output path',
    async (kind) => {
      const capturesDir = join(tmpdir(), `tensnap-chart-${Date.now()}-${Math.random()}`);
      const relativeDirectory = `.tmp-headless-chart-${Date.now()}-${Math.random()}`;
      const outputPath =
        kind === 'absolute'
          ? resolve(tmpdir(), relativeDirectory, 'charts.png')
          : join(relativeDirectory, 'charts.png');
      const expectedPath =
        kind === 'absolute'
          ? resolve(tmpdir(), relativeDirectory, 'charts-population.png')
          : join(relativeDirectory, 'charts-population.png');
      paths.push(capturesDir, dirname(outputPath));
      const painter = new HeadlessChartPainter({ capturesDir });
      const artifacts = await painter.render({
        at: new Date().toISOString(),
        reason: 'test',
        trigger: 'explicit',
        snapshot: {
          metadata: {},
          actions: [],
          parameters: [],
          environments: [],
          monitors: [],
          logs: [],
          assets: [],
          charts: [
            { id: 'population', label: 'Population', metadataDict: {}, data: [] },
            { id: 'wealth', label: 'Wealth', metadataDict: {}, data: [] },
          ],
        },
        options: { outputPath, includeData: false },
        assets: {},
      });

      expect(artifacts[0]?.path).toBe(expectedPath);
      expect(artifacts[0]?.path).not.toContain(`${dirname(outputPath)}/${dirname(outputPath)}`);
      await expect(stat(expectedPath)).resolves.toBeDefined();
    },
  );
});

it('reports missing charts and filesystem write failures', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { Scenario } = await import('@tensnap/core/scenario');
  const capturesDir = await mkdtemp(join(tmpdir(), 'tensnap-chart-write-failure-'));
  paths.push(capturesDir);
  const blocker = join(capturesDir, 'blocker');
  await writeFile(blocker, 'file');
  const painter = new HeadlessChartPainter({ capturesDir });
  const snapshot = new Scenario().dump();
  snapshot.charts = [{ id: 'test', label: 'Test', metadataDict: {}, data: [] }];
  await expect(
    painter.render({
      at: 'test',
      reason: 'write-failure',
      trigger: 'explicit',
      snapshot,
      assets: {},
      options: { outputPath: join(blocker, 'chart.png') },
    }),
  ).rejects.toMatchObject({
    artifacts: [],
    errors: [{ code: 'persistence_failed', targetId: 'test' }],
  });
  await expect(
    painter.render({
      at: 'test',
      reason: 'missing',
      trigger: 'explicit',
      snapshot,
      assets: {},
      options: { chartId: 'missing' },
    }),
  ).rejects.toMatchObject({ errors: [{ code: 'render_missing', targetId: 'missing' }] });
});

it('retains a successful chart when another target cannot be written', async () => {
  const { mkdtemp, mkdir } = await import('node:fs/promises');
  const { Scenario } = await import('@tensnap/core/scenario');
  const capturesDir = await mkdtemp(join(tmpdir(), 'tensnap-chart-partial-'));
  paths.push(capturesDir);
  await mkdir(join(capturesDir, 'charts-bad.png'));
  const painter = new HeadlessChartPainter({ capturesDir });
  const snapshot = new Scenario().dump();
  snapshot.charts = ['good', 'bad'].map((id) => ({ id, label: id, metadataDict: {}, data: [] }));
  await expect(
    painter.render({
      at: 'test',
      reason: 'partial',
      trigger: 'explicit',
      snapshot,
      assets: {},
      options: { outputPath: join(capturesDir, 'charts.png') },
    }),
  ).rejects.toMatchObject({
    artifacts: [{ path: join(capturesDir, 'charts-good.png') }],
    errors: [{ code: 'persistence_failed', targetId: 'bad' }],
  });
  expect((await stat(join(capturesDir, 'charts-good.png'))).size).toBeGreaterThan(0);
});
