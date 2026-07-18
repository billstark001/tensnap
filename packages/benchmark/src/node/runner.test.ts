import { describe, expect, it } from 'vitest';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  allocateLoopbackPort,
  appendBenchmarkJournalSample,
  assertArtifactOutputAvailable,
  assertJournalCompatible,
  initializeBenchmarkJournal,
  mergeBenchmarkJournalSamples,
  readBenchmarkJournal,
  renderReport,
  sha256,
  stableJson,
  validateProfile,
  verifyArtifact,
  verifyArtifactFiles,
  verifyArtifactSourceFiles,
  writeAnalysisFiles,
  writeArtifact,
  type BenchmarkJournalHeader,
  type BenchmarkJournalSample,
} from './runner';
import type { BenchmarkArtifact } from '../harness/types';

function completeNodeArtifact(): BenchmarkArtifact {
  const profile = validateProfile({
    schemaVersion: 2,
    id: 'journal-fixture',
    description: 'journal fixture',
    suites: ['node'],
    repetitions: 1,
    warmupActions: 0,
    measuredActions: 1,
    encodings: ['json'],
    validation: ['error'],
    workloads: [{ id: 'fixture', module: '../fixture.ts', primaryMetric: 'cycle' }],
  });
  return {
    schemaVersion: 2,
    generatedAt: '2026-07-18T00:00:00.000Z',
    profile,
    harness: { package: '@tensnap/benchmark', version: '0.3.0', gitSha: 'fixture' },
    implementation: { gitSha: 'fixture', dirty: false, lockfileSha256: 'fixture' },
    environment: { os: 'test', release: 'test', arch: 'test', cpu: [], memoryBytes: 0, node: 'test', v8: 'test', pnpmUserAgent: null },
    runs: [{
      id: 'fixture|node|-|-',
      profileWorkloadId: 'fixture',
      suite: 'node',
      workload: { id: 'fixture', version: 1, kind: 'node', category: 'core', module: 'fixture.ts', config: {}, configHash: 'fixture' },
      execution: { warmupActions: 0, measuredActions: 1, repetitions: 1, processIsolated: true, primaryMetric: 'cycle' },
      samples: [{
        index: 0,
        block: 0,
        timingsMs: [2],
        metrics: {},
        messageCounts: {},
        wireBytes: { rendererToSimulator: 0, simulatorToRenderer: 0 },
        correctness: { valid: true, actionCount: 1, stateHash: 'same', expectedStateHash: 'same' },
        process: { isolated: true, wallMs: 3, userCpuMs: 1, systemCpuMs: 0.5, maxRssBytes: null },
      }],
      summary: {
        cycle: { count: 1, meanMs: 2, medianMs: 2, p95Ms: 2, madMs: 0, bootstrapMedianCi95Ms: [2, 2] },
        replicateMediansMs: [2],
        metrics: {},
        stages: {},
        wireBytes: { rendererToSimulator: 0, simulatorToRenderer: 0 },
        messageCounts: {},
      },
    }],
    comparisons: [],
    integrity: { profileSha256: sha256(profile), expectedRunIds: ['fixture|node|-|-'], samplesSha256: null },
  };
}

describe('benchmark artifact schema v2', () => {
  it('accepts browser and local-node workloads without pretending they are protocol runs', () => {
    const profile = validateProfile({
      schemaVersion: 2,
      id: 'test',
      description: 'test',
      suites: ['node', 'browser'],
      repetitions: 1,
      warmupActions: 0,
      measuredActions: 1,
      encodings: ['json'],
      validation: ['error'],
      workloads: [{ module: '../fixture.ts' }],
    });
    const artifact: BenchmarkArtifact = {
      schemaVersion: 2,
      generatedAt: '2026-07-18T00:00:00.000Z',
      profile,
      harness: { package: '@tensnap/benchmark', version: '0.3.0', gitSha: null },
      implementation: { gitSha: null, dirty: false, lockfileSha256: null },
      environment: { os: 'test', release: 'test', arch: 'test', cpu: [], memoryBytes: 0, node: 'test', v8: 'test', pnpmUserAgent: null },
      runs: [{
        id: 'fixture|browser|-|-',
        suite: 'browser',
        workload: { id: 'comparison.fixture', version: 1, kind: 'browser', category: 'comparison', module: 'fixture.ts', config: {}, configHash: 'fixture' },
        execution: { warmupActions: 0, measuredActions: 1, repetitions: 1, processIsolated: false, primaryMetric: 'cycle', browser: { name: 'chromium', version: 'test', viewport: { width: 1280, height: 800, deviceScaleFactor: 1 }, headless: true } },
        samples: [{
          index: 0,
          block: 0,
          timingsMs: [1],
          metrics: { browserMutationMs: [0.5] },
          messageCounts: {},
          wireBytes: { rendererToSimulator: 0, simulatorToRenderer: 0 },
          correctness: { valid: true, actionCount: 1, stateHash: 'same', expectedStateHash: 'same' },
          process: { isolated: false, wallMs: 1, userCpuMs: 0, systemCpuMs: 0, maxRssBytes: 0 },
        }],
        summary: {
          cycle: { count: 1, meanMs: 1, medianMs: 1, p95Ms: 1, madMs: 0, bootstrapMedianCi95Ms: [1, 1] },
          replicateMediansMs: [1],
          metrics: { browserMutationMs: { count: 1, meanMs: 0.5, medianMs: 0.5, p95Ms: 0.5, madMs: 0, bootstrapMedianCi95Ms: [0.5, 0.5] } },
          stages: {},
          wireBytes: { rendererToSimulator: 0, simulatorToRenderer: 0 },
          messageCounts: {},
        },
      }],
      comparisons: [],
      integrity: { profileSha256: sha256(profile), expectedRunIds: ['fixture|browser|-|-'], samplesSha256: null },
    };
    expect(() => verifyArtifact(artifact)).not.toThrow();

    const withoutComparisons = renderReport(artifact);
    expect(withoutComparisons).toContain('in-process (not suitable for submission)\n\n| Suite');
    expect(withoutComparisons).toContain('| 0 / 0 |\n\nRaw measurements');
    expect(withoutComparisons).not.toContain('\n\n\n');
    expect(withoutComparisons.endsWith('\n')).toBe(true);

    const withComparisons = renderReport({
      ...artifact,
      comparisons: [{
        id: 'fixture:browser:-:-',
        metric: 'cycle',
        suite: 'browser',
        baseline: 'baseline',
        treatment: 'treatment',
        pairs: 1,
        medianRatio: 1,
        bootstrapMedianRatioCi95: [1, 1],
        medianDifferenceMs: 0,
        bootstrapMedianDifferenceCi95Ms: [0, 0],
      }],
    });
    expect(withComparisons).toContain('| 0 / 0 |\n\n## Paired comparisons');
    expect(withComparisons).toContain('| 0.000 (0.000–0.000) |\n\nRaw measurements');
    expect(withComparisons).not.toContain('\n\n\n');
    expect(withComparisons.endsWith('\n')).toBe(true);
  });

  it('hashes object records independently of insertion order', () => {
    expect(stableJson({ b: 2, a: 1 })).toBe(stableJson({ a: 1, b: 2 }));
  });

  it('regenerates explicitly selected paired metrics from replicate blocks', () => {
    const fixture = completeNodeArtifact();
    const profile = validateProfile({
      ...fixture.profile,
      workloads: [
        { id: 'baseline', module: '../fixture.ts', primaryMetric: 'customMs' },
        { id: 'treatment', module: '../fixture.ts', primaryMetric: 'customMs' },
      ],
      comparisons: [{ id: 'custom-comparison', metric: 'customMs', baseline: 'baseline', treatments: ['treatment'] }],
    });
    const run = (id: string, value: number): BenchmarkArtifact['runs'][number] => ({
      ...fixture.runs[0]!,
      id: `${id}|node|-|-`,
      profileWorkloadId: id,
      execution: { ...fixture.runs[0]!.execution, primaryMetric: 'customMs' },
      samples: fixture.runs[0]!.samples.map((sample) => ({ ...sample, metrics: { customMs: [value] } })),
      summary: {
        ...fixture.runs[0]!.summary,
        metrics: { customMs: { count: 1, meanMs: value, medianMs: value, p95Ms: value, madMs: 0, bootstrapMedianCi95Ms: [value, value] } },
      },
    });
    const artifact: BenchmarkArtifact = {
      ...fixture,
      profile,
      runs: [run('baseline', 2), run('treatment', 1)],
      comparisons: [{
        id: 'custom-comparison:customMs:node:-:-',
        metric: 'customMs',
        suite: 'node',
        baseline: 'baseline',
        treatment: 'treatment',
        pairs: 1,
        medianRatio: 0.5,
        bootstrapMedianRatioCi95: [0.5, 0.5],
        medianDifferenceMs: -1,
        bootstrapMedianDifferenceCi95Ms: [-1, -1],
      }],
      integrity: {
        profileSha256: sha256(profile),
        expectedRunIds: ['baseline|node|-|-', 'treatment|node|-|-'],
        samplesSha256: null,
      },
    };
    expect(() => verifyArtifact(artifact)).not.toThrow();
    expect(() => verifyArtifact({
      ...artifact,
      comparisons: artifact.comparisons.map((comparison) => ({ ...comparison, medianRatio: 9 })),
    })).toThrow(/Paired comparisons/);
  });

  it('round-trips append-only journals and rejects duplicate shard samples', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tensnap-journal-test-'));
    try {
      const artifact = completeNodeArtifact();
      const header: BenchmarkJournalHeader = {
        type: 'header',
        schemaVersion: 1,
        profile: artifact.profile,
        profileSha256: sha256(artifact.profile),
        suites: ['node'],
        implementationGitSha: 'fixture',
        artifactContext: {
          harness: artifact.harness,
          implementation: artifact.implementation,
          environment: artifact.environment,
        },
        expectedRunIds: ['fixture|node|-|-'],
      };
      const record: BenchmarkJournalSample = {
        type: 'sample',
        runId: artifact.runs[0]!.id,
        block: 0,
        sample: artifact.runs[0]!.samples[0]!,
      };
      const file = path.join(directory, 'block-1.jsonl');
      await initializeBenchmarkJournal(file, header);
      await expect(initializeBenchmarkJournal(file, header)).rejects.toThrow(/--resume/);
      await appendBenchmarkJournalSample(file, record);
      const journal = await readBenchmarkJournal(file);
      expect(journal.samples).toEqual([record]);
      expect(mergeBenchmarkJournalSamples([journal])).toEqual([record]);
      expect(() => mergeBenchmarkJournalSamples([journal, journal])).toThrow(/Duplicate benchmark sample/);
      expect(() => assertJournalCompatible(header, {
        ...header,
        artifactContext: {
          ...header.artifactContext,
          environment: { ...header.artifactContext.environment, node: 'different' },
        },
      })).toThrow(/execution environment/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('publishes immutable derived files and detects report tampering', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tensnap-artifact-test-'));
    const output = path.join(directory, 'artifact');
    try {
      await writeArtifact(output, completeNodeArtifact());
      await expect(assertArtifactOutputAvailable(output)).rejects.toThrow(/immutable/);
      await expect(verifyArtifactFiles(output)).resolves.toBeUndefined();
      const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8')) as BenchmarkArtifact;
      expect(Object.keys(manifest.integrity.filesSha256 ?? {}).sort()).toEqual([
        'analysis/comparisons.csv',
        'analysis/figure-data.json',
        'analysis/primary-metrics.svg',
        'analysis/runs.csv',
        'report.md',
      ]);
      await expect(writeArtifact(output, completeNodeArtifact())).rejects.toThrow(/already exists/);
      await rm(path.join(output, 'analysis'), { recursive: true });
      await expect(verifyArtifactSourceFiles(output, manifest)).resolves.toBeUndefined();
      await writeAnalysisFiles(output, manifest);
      await expect(verifyArtifactFiles(output, manifest)).resolves.toBeUndefined();
      await appendFile(path.join(output, 'report.md'), 'tampered\n');
      await expect(verifyArtifactFiles(output)).rejects.toThrow(/report.md was not regenerated/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('allocates a valid loopback port for each external-browser replicate', async () => {
    const port = await allocateLoopbackPort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65_535);
  });
});
