import assert from 'node:assert/strict';
import type {
  BenchmarkArtifact,
  BenchmarkRun,
} from '../../../packages/benchmark/src/harness/types';
import type {
  BenchmarkResultTable as ResultTable,
  BenchmarkArtifactExtension,
} from '../../../packages/benchmark/src/harness/types';
import { resolveConfig, validateResult } from './benchmark';
import { digest, expectedQuery, pointHash, reference } from './oracle';
import { validateMeasurement } from './measurement';

/** Offline subject oracle: reconstruct scientific expectations without a host, daemon or CLI. */
export function verifyAgentArtifact(artifact: BenchmarkArtifact): void {
  const cache = new Map<string, ReturnType<typeof reference>>();
  assert.ok(artifact.profile.workloads.length > 0, 'Missing planned workload matrix.');
  const plan = new Map(artifact.profile.workloads.map((entry) => [entry.id, entry]));
  assert.equal(
    plan.size,
    artifact.profile.workloads.length,
    'Duplicate planned workload identity.',
  );
  assert.equal(artifact.runs.length, plan.size, 'Incomplete subject workload matrix.');
  const seen = new Set<string>();
  const builds = new Set<string>();
  for (const run of artifact.runs) {
    assert.equal(run.workload.id, 'system.agent-cli.v1', 'Unexpected workload identity.');
    assert.equal(run.workload.kind, 'external-process');
    assert.equal(run.suite, 'node');
    const entry = plan.get(run.profileWorkloadId);
    assert.ok(entry && entry.id && !seen.has(entry.id), 'Missing or duplicate planned run.');
    seen.add(entry.id);
    assert.deepEqual(run.workload.config, resolveConfig(entry.config));
    assert.deepEqual(run.execution.dimensions, entry.dimensions);
    assert.equal(run.execution.featureLevel, entry.featureLevel);
    assert.equal(run.execution.primaryMetric, 'cycle');
    assert.equal(
      run.execution.warmupActions,
      entry.warmupActions ?? artifact.profile.warmupActions,
    );
    assert.equal(
      run.execution.measuredActions,
      entry.measuredActions ?? artifact.profile.measuredActions,
    );
    assert.equal(run.execution.repetitions, artifact.profile.repetitions);
    assert.equal(run.samples.length, artifact.profile.repetitions);
    assert.deepEqual(
      [...run.samples.map((sample) => sample.block)].sort((a, b) => a - b),
      Array.from({ length: artifact.profile.repetitions }, (_, index) => index),
      'Invalid replicate blocks.',
    );
    for (const sample of run.samples) {
      assert.equal(sample.index, sample.block, 'Replicate index does not match its block.');
      const config = resolveConfig(run.workload.config);
      config.seed += sample.block;
      const time =
        config.case === 'collection'
          ? config.steps
          : config.prepSteps + (config.case === 'control' ? config.steps : 0);
      const ref = (at: number) => {
        const key = digest({ config, at });
        if (!cache.has(key)) cache.set(key, reference(config, at));
        return cache.get(key)!;
      };
      const expected: Record<string, unknown> = {
        time,
        succeededActions: config.case === 'query' ? 0 : config.steps,
        agentsHash: pointHash(ref(time).agents),
      };
      if (config.case === 'query')
        expected.queries = Array.from({ length: run.execution.measuredActions }, () =>
          config.query === 'snapshot'
            ? { time, agentsHash: expected.agentsHash }
            : expectedQuery(config.query, ref(time), time),
        );
      if (config.case === 'collection' && config.collection !== 'none') {
        const firstTime =
          config.collection === 'rolling' ? Math.max(0, time - config.retainedFrames + 1) : 0;
        expected.history = {
          checks: [...new Set([firstTime, Math.max(firstTime, Math.floor(time / 2)), time])].map(
            (at) => ({ time: at, agentsHash: pointHash(ref(at).agents) }),
          ),
          truncated: config.collection === 'rolling' && config.steps + 1 > config.retainedFrames,
        };
        const retained =
          config.collection === 'archive'
            ? config.steps + 1
            : config.collection === 'rolling'
              ? Math.min(config.steps + 2, config.retainedFrames + 1)
              : config.steps + 2;
        assert.deepEqual(
          sample.metrics.retainedFrames,
          [retained],
          'Unexpected retained boundary count.',
        );
      }
      assert.ok(sample.semanticEvidence, 'Agent sample is missing semantic evidence.');
      assert.equal(
        digest(sample.semanticEvidence.state),
        digest(expected),
        'Agent observations differ from the offline model oracle.',
      );
      assert.equal(
        digest(sample.semanticEvidence.expectedState),
        digest(expected),
        'Recorded agent expectations differ from the offline model oracle.',
      );
      const metrics = Object.fromEntries(
        Object.entries(sample.metrics).map(([key, values]) => [
          key,
          values.length === 1 ? values[0]! : values,
        ]),
      );
      validateResult(
        config,
        {
          schemaVersion: 1,
          retainSemanticEvidence: true,
          measurementEvidence: sample.measurementEvidence,
          timingsMs: sample.timingsMs,
          metrics,
          correctness: {
            valid: true,
            actionCount: sample.correctness.actionCount,
            state: sample.semanticEvidence.state,
            expectedState: sample.semanticEvidence.expectedState,
          },
        },
        run.execution.measuredActions,
      );
      for (const [key, value] of Object.entries(sample.metrics))
        assert.ok(
          value.length > 0 && value.every((n) => Number.isFinite(n) && n >= 0),
          `Invalid metric ${key}`,
        );
      validateMeasurement(
        config,
        sample.measurementEvidence,
        sample.timingsMs,
        sample.stagesMs ?? {},
        sample.metrics,
      );
      if (config.collection === 'full-history' || config.collection === 'rolling') {
        if (config.case === 'collection')
          assert.ok(
            (sample.metrics.storedEncodedBytes?.[0] ?? 0) > 0,
            'Missing encoded storage accounting.',
          );
      }
      if (config.case === 'query')
        assert.equal(sample.metrics.responseBytes?.length, run.execution.measuredActions);
      else
        assert.deepEqual(sample.metrics.successfulActionsPerSecond, [
          (config.steps * 1000) / sample.timingsMs[0]!,
        ]);
      for (const key of [
        'hostSendValidation',
        'hostReceiveValidation',
        'daemonConfiguredSendValidation',
        'daemonConfiguredReceiveValidation',
      ])
        assert.equal(sample.runtime?.[key], 'error');
      assert.equal(sample.runtime?.encoding, 'json');
      assert.equal(sample.runtime?.renderTrigger, 'manual');
      assert.match(sample.runtime?.cliBuildSha256 ?? '', /^[a-f0-9]{64}$/);
      builds.add(sample.runtime!.cliBuildSha256!);
    }
  }
  assert.equal(builds.size, 1, 'Mixed public CLI builds in one artifact.');
}

function metric(run: BenchmarkRun, name: string): number | string {
  return (run.summary.metrics[name] ?? run.summary.stages[name])?.medianMs ?? '-';
}
export function buildAgentTables(artifact: BenchmarkArtifact): ResultTable[] {
  return (['control', 'query', 'collection'] as const).map((kind) => ({
    id: `agent-cli-${kind}`,
    caption:
      kind === 'control'
        ? 'Schelling control cost. Each timing is one complete target-action batch; startup and preparation are excluded.'
        : kind === 'query'
          ? 'Frozen Schelling queries. Each timing includes CLI process exit or a complete HTTP response. Response bytes include the selected transport envelope.'
          : 'Random-walk collection. Whole-run completion includes the final file/store commit when requested. RSS is per-process lifetime high water; disk bytes include database/index files, not just encoded payload.',
    columns: [
      { key: 'system', label: 'System' },
      { key: 'dimensions', label: 'Dimensions' },
      { key: 'medianMs', label: kind === 'query' ? 'Query median (ms)' : 'Whole-run median (ms)' },
      { key: 'p95Ms', label: 'P95 (ms)' },
      ...(kind === 'query'
        ? [{ key: 'responseBytes', label: 'Response bytes' }]
        : [
            { key: 'successfulActionsPerSecond', label: 'Successful actions/s' },
            { key: 'runtimeSettledMs', label: 'Runtime settled (ms)' },
          ]),
      ...(kind === 'collection'
        ? [
            { key: 'retainedFrames', label: 'Retained frames' },
            { key: 'recordingDiskBytes', label: 'Recording disk bytes' },
            { key: 'storedEncodedBytes', label: 'Encoded store bytes' },
            { key: 'completionOverheadMs', label: 'CLI/control/finalization overhead (ms)' },
          ]
        : []),
      { key: 'daemonMaxRssBytes', label: 'Daemon peak RSS bytes' },
      { key: 'hostMaxRssBytes', label: 'Model host peak RSS bytes' },
      { key: 'startupReadyMs', label: 'Daemon startup to ready (ms)' },
    ],
    rows: artifact.runs
      .filter(
        (run) => run.workload.id === 'system.agent-cli.v1' && run.workload.config.case === kind,
      )
      .map((run) => ({
        system: run.system ?? run.id,
        dimensions: JSON.stringify(run.execution.dimensions),
        medianMs: run.summary.cycle.medianMs,
        p95Ms: run.summary.cycle.p95Ms,
        ...Object.fromEntries(
          [
            'responseBytes',
            'successfulActionsPerSecond',
            'runtimeSettledMs',
            'completionOverheadMs',
            'retainedFrames',
            'recordingDiskBytes',
            'storedEncodedBytes',
            'daemonMaxRssBytes',
            'hostMaxRssBytes',
            'startupReadyMs',
          ].map((key) => [key, metric(run, key)]),
        ),
      })),
  }));
}

export default {
  verify: verifyAgentArtifact,
  tables: buildAgentTables,
} satisfies BenchmarkArtifactExtension;
