import type { BenchmarkArtifact } from '../../../packages/benchmark/src/harness';
import { resolveConfig, type AgentBenchmarkConfig } from './benchmark';
import { reference, pointHash, expectedQuery } from './oracle';
import type { Measurement } from './measurement';

/** Valid subject observations at a known clock boundary; generic artifact hashes are tested separately. */
export function fixture(patch: Partial<AgentBenchmarkConfig> = {}) {
  const config = resolveConfig({ gridSize: 12, steps: 3, prepSteps: 2, seed: 7, ...patch });
  const time =
    config.case === 'collection'
      ? config.steps
      : config.prepSteps + (config.case === 'control' ? config.steps : 0);
  const expected = reference(config, time);
  const proof: Record<string, unknown> = {
    time,
    succeededActions: config.case === 'query' ? 0 : config.steps,
    agentsHash: pointHash(expected.agents),
  };
  const metrics: Record<string, number[]> = {
    startupReadyMs: [5],
    hostMaxRssBytes: [1024],
    daemonMaxRssBytes: [2048],
    contextDiskBytes: [100],
  };
  const stages: Record<string, number[]> = {};
  const timings = config.case === 'query' ? [30, 31] : [30];
  let measurement: Measurement;
  if (config.case === 'query') {
    proof.queries = timings.map(() =>
      config.query === 'snapshot'
        ? { time, agentsHash: proof.agentsHash }
        : expectedQuery(config.query, expected, time),
    );
    metrics.responseBytes = [64, 64];
    measurement = {
      kind: 'query',
      responses: timings.map((elapsedMs) => ({ elapsedMs, bytes: 64 })),
    };
  } else {
    metrics.successfulActionsPerSecond = [(config.steps * 1000) / 30];
    if (config.case === 'control' && config.control === 'cli-single') {
      measurement = {
        kind: 'single',
        actions: Array.from({ length: config.steps }, () => ({
          actionId: 'step',
          status: 'succeeded',
          settled: true,
          stateKnown: true,
          elapsedMs: 1,
        })),
        transactionsMs: Array.from({ length: config.steps }, () => 1),
      };
      stages.actionCliMs = measurement.transactionsMs;
    } else {
      measurement = {
        kind: 'bounded',
        run: {
          dispatchedActions: config.steps,
          completedActions: config.steps,
          succeededActions: config.steps,
          failedActions: 0,
          settled: true,
          stateKnown: true,
          stopReason: 'max-steps',
          startedAt: 10,
          settledAt: 14,
        },
        transactionsMs: config.case === 'control' && config.control === 'http-batch' ? [2, 3] : [6],
      };
      stages.runtimeSettledMs = [4];
      if (config.case === 'collection') {
        stages.completionOverheadMs = [26];
        if (config.collection === 'archive') {
          measurement.transactionsMs = [2, 3, 4];
          stages.recordingSetupCliMs = [2];
        }
        if (config.collection !== 'none') measurement.recordingStatus = 'persisted';
      }
    }
    if (config.case === 'collection' && config.collection !== 'none') {
      const first =
        config.collection === 'rolling' ? Math.max(0, time - config.retainedFrames + 1) : 0;
      proof.history = {
        checks: [...new Set([first, Math.max(first, Math.floor(time / 2)), time])].map((t) => ({
          time: t,
          agentsHash: pointHash(reference(config, t).agents),
        })),
        truncated: config.collection === 'rolling' && config.steps + 1 > config.retainedFrames,
      };
      metrics.retainedFrames = [
        config.collection === 'archive'
          ? config.steps + 1
          : config.collection === 'rolling'
            ? Math.min(config.steps + 2, config.retainedFrames + 1)
            : config.steps + 2,
      ];
      metrics.recordingDiskBytes = [4096];
      if (config.collection !== 'archive') metrics.storedEncodedBytes = [1024];
    }
  }
  const sample = {
    block: 0,
    index: 0,
    timingsMs: timings,
    measurementEvidence: measurement,
    semanticEvidence: { state: proof, expectedState: structuredClone(proof) },
    metrics,
    stagesMs: stages,
    correctness: {
      valid: true,
      actionCount: timings.length,
      stateHash: 'unused',
      expectedStateHash: 'unused',
    },
    runtime: {
      encoding: 'json',
      renderTrigger: 'manual',
      hostSendValidation: 'error',
      hostReceiveValidation: 'error',
      daemonConfiguredSendValidation: 'error',
      daemonConfiguredReceiveValidation: 'error',
      cliBuildSha256: 'a'.repeat(64),
    },
  };
  const entry = {
    id: 'fixture',
    module: '../agent/v1/benchmark.ts',
    config,
    dimensions: { case: config.case },
    featureLevel: 'fixture',
    primaryMetric: 'cycle',
    warmupActions: 0,
    measuredActions: timings.length,
  };
  const run = {
    id: 'fixture|node|-|-',
    profileWorkloadId: 'fixture',
    suite: 'node',
    workload: { id: 'system.agent-cli.v1', kind: 'external-process', config },
    execution: { ...entry, primaryMetric: 'cycle', repetitions: 1 },
    samples: [sample],
    summary: {
      cycle: { medianMs: timings[0]!, p95Ms: timings[timings.length - 1]! },
      metrics: Object.fromEntries(
        Object.entries(metrics).map(([key, values]) => [key, { medianMs: values[0]! }]),
      ),
      stages: Object.fromEntries(
        Object.entries(stages).map(([key, values]) => [key, { medianMs: values[0]! }]),
      ),
    },
  };
  const artifact = {
    profile: {
      workloads: [entry],
      repetitions: 1,
      warmupActions: 0,
      measuredActions: timings.length,
    },
    runs: [run],
  };
  return {
    config,
    proof,
    sample,
    measurement,
    metrics,
    stages,
    run,
    entry,
    artifact: artifact as unknown as BenchmarkArtifact,
    raw: artifact,
  };
}
