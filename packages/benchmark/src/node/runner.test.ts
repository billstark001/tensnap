import { describe, expect, it } from 'vitest';
import { renderReport, sha256, stableJson, validateProfile, verifyArtifact } from './runner';
import type { BenchmarkArtifact } from '../harness/types';

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
        execution: { warmupActions: 0, measuredActions: 1, repetitions: 1, processIsolated: false, browser: { name: 'chromium', version: 'test', viewport: { width: 1280, height: 800, deviceScaleFactor: 1 }, headless: true } },
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
});
