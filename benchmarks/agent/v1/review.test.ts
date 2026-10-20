// @vitest-environment node
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyAgentArtifact, buildAgentTables } from './report';
import { fixture } from './test-fixture';
import { finishResources } from './cleanup';
import { pointHash, expectedQuery, queryFor, queryProof } from './oracle';
import { Scenario, queryScenario } from '../../../packages/core/src/scenario';
import type { AgentBenchmarkConfig } from './benchmark';
import type { BenchmarkArtifact } from '../../../packages/benchmark/src/harness';

const cases: Partial<AgentBenchmarkConfig>[] = [
  ...(['cli-single', 'cli-batch', 'http-batch'] as const).map((control) => ({
    case: 'control' as const,
    control,
  })),
  ...(['snapshot', 'monitor', 'agent', 'neighbors', 'cell'] as const).map((query) => ({
    case: 'query' as const,
    query,
  })),
  ...(['none', 'archive', 'full-history', 'rolling'] as const).map((collection) => ({
    case: 'collection' as const,
    collection,
    agentCount: 10,
    changedAgents: 1,
    steps: 12,
    retainedFrames: 4,
  })),
  {
    case: 'collection',
    collection: 'rolling',
    agentCount: 10,
    changedAgents: 1,
    steps: 2,
    retainedFrames: 128,
  },
];
describe('offline subject acceptance and rejection', () => {
  it('uses the block seed for each independent replicate and rejects mixed CLI builds', () => {
    const first = fixture({ seed: 7 });
    const second = fixture({ seed: 8 });
    second.sample.block = 1;
    second.sample.index = 1;
    first.raw.profile.repetitions = 2;
    first.run.execution.repetitions = 2;
    first.run.samples.push(second.sample);
    expect(() => verifyAgentArtifact(first.artifact)).not.toThrow();
    second.sample.runtime.cliBuildSha256 = 'b'.repeat(64);
    expect(() => verifyAgentArtifact(first.artifact)).toThrow(/Mixed public CLI builds/);
  });
  it('accepts distinct planned conditions and rejects their duplicate identities', () => {
    const first = fixture({ control: 'cli-batch' }),
      second = fixture({ control: 'http-batch' });
    second.entry.id = 'second';
    second.run.profileWorkloadId = 'second';
    second.run.id = 'second|node|-|-';
    const combined = {
      ...first.artifact,
      profile: { ...first.artifact.profile, workloads: [first.entry, second.entry] },
      runs: [first.run, second.run],
    } as unknown as BenchmarkArtifact;
    expect(() => verifyAgentArtifact(combined)).not.toThrow();
    second.run.profileWorkloadId = 'fixture';
    expect(() => verifyAgentArtifact(combined)).toThrow(/duplicate planned run/);
  });
  it.each(cases)('accepts complete evidence for %j', (config) => {
    const f = fixture(config);
    expect(() => verifyAgentArtifact(f.artifact)).not.toThrow();
    expect(
      buildAgentTables(f.artifact).find((t) => t.id.endsWith(f.config.case))!.rows,
    ).toHaveLength(1);
  });
  it.each([
    [
      'accepted but unsettled',
      (f: ReturnType<typeof fixture>) => {
        if (f.measurement.kind === 'bounded') f.measurement.run.settled = false;
      },
    ],
    [
      'unknown model state',
      (f: ReturnType<typeof fixture>) => {
        if (f.measurement.kind === 'bounded') f.measurement.run.stateKnown = false;
      },
    ],
    [
      'failed action',
      (f: ReturnType<typeof fixture>) => {
        if (f.measurement.kind === 'bounded') f.measurement.run.failedActions = 1;
      },
    ],
    [
      'unobserved extra dispatch',
      (f: ReturnType<typeof fixture>) => {
        if (f.measurement.kind === 'bounded') f.measurement.run.dispatchedActions++;
      },
    ],
    [
      'wrong stop reason',
      (f: ReturnType<typeof fixture>) => {
        if (f.measurement.kind === 'bounded') f.measurement.run.stopReason = 'simulator';
      },
    ],
    [
      'reversed runtime clock',
      (f: ReturnType<typeof fixture>) => {
        if (f.measurement.kind === 'bounded') f.measurement.run.settledAt = 9;
      },
    ],
    [
      'forged runtime duration',
      (f: ReturnType<typeof fixture>) => {
        f.stages.runtimeSettledMs = [3];
      },
    ],
    [
      'NaN stage',
      (f: ReturnType<typeof fixture>) => {
        f.stages.runtimeSettledMs = [NaN];
      },
    ],
    [
      'missing stages',
      (f: ReturnType<typeof fixture>) => {
        delete f.stages.runtimeSettledMs;
      },
    ],
    [
      'zero memory',
      (f: ReturnType<typeof fixture>) => {
        f.metrics.daemonMaxRssBytes = [0];
      },
    ],
    [
      'missing context bytes',
      (f: ReturnType<typeof fixture>) => {
        delete f.metrics.contextDiskBytes;
      },
    ],
    [
      'wrong trial count',
      (f: ReturnType<typeof fixture>) => {
        f.sample.correctness.actionCount = 99;
      },
    ],
    [
      'impossible transaction duration',
      (f: ReturnType<typeof fixture>) => {
        if (f.measurement.kind === 'bounded') f.measurement.transactionsMs = [31];
      },
    ],
    [
      'unplanned config',
      (f: ReturnType<typeof fixture>) => {
        f.run.workload.config = { ...f.config, steps: 4 };
      },
    ],
    [
      'wrong identity',
      (f: ReturnType<typeof fixture>) => {
        f.run.workload.id = 'unrelated';
      },
    ],
    [
      'missing run',
      (f: ReturnType<typeof fixture>) => {
        f.raw.runs = [];
      },
    ],
    [
      'duplicate run',
      (f: ReturnType<typeof fixture>) => {
        f.raw.runs.push(f.run);
      },
    ],
    [
      'invalid block',
      (f: ReturnType<typeof fixture>) => {
        f.sample.block = 1;
      },
    ],
  ] as const)('rejects %s', (_label, mutate) => {
    const f = fixture();
    mutate(f);
    expect(() => verifyAgentArtifact(f.artifact)).toThrow();
  });
  it('checks per-action results instead of trusting successful process exit', () => {
    const f = fixture({ control: 'cli-single' });
    if (f.measurement.kind !== 'single') throw Error();
    f.measurement.actions[0]!.status = 'failed';
    expect(() => verifyAgentArtifact(f.artifact)).toThrow();
  });
  it('rejects jointly forged observed and expected state', () => {
    const f = fixture();
    f.proof.agentsHash = 'b'.repeat(64);
    f.sample.semanticEvidence.expectedState.agentsHash = 'b'.repeat(64);
    expect(() => verifyAgentArtifact(f.artifact)).toThrow(/offline model oracle/);
  });
  it.each(['response bytes', 'query contents', 'query time'] as const)(
    'rejects forged %s',
    (kind) => {
      const f = fixture({ case: 'query', query: 'agent' });
      if (kind === 'response bytes') f.metrics.responseBytes = [0, 0];
      else f.proof.queries = kind === 'query contents' ? [] : [{ time: 999 }];
      expect(() => verifyAgentArtifact(f.artifact)).toThrow();
    },
  );
  it.each(['missing commit', 'retention', 'history', 'storage', 'residual'] as const)(
    'rejects invalid collection %s',
    (kind) => {
      const f = fixture({
        case: 'collection',
        collection: 'rolling',
        agentCount: 10,
        changedAgents: 1,
        steps: 12,
        retainedFrames: 4,
      });
      if (kind === 'missing commit' && f.measurement.kind === 'bounded')
        f.measurement.recordingStatus = 'pending';
      if (kind === 'retention') f.metrics.retainedFrames = [14];
      if (kind === 'history') f.proof.history = { checks: [], truncated: false };
      if (kind === 'storage') delete f.metrics.storedEncodedBytes;
      if (kind === 'residual') f.stages.completionOverheadMs = [0];
      expect(() => verifyAgentArtifact(f.artifact)).toThrow();
    },
  );
});
describe('oracle independence and cleanup', () => {
  it.each([1, 12])(
    'matches public queries against a hand-constructed scene (%i neighbors)',
    (count) => {
      const agents = [
        { id: 1, x: 0, y: 0 },
        { id: '1', x: 1, y: 0 },
        ...Array.from({ length: count - 1 }, (_, i) => ({ id: `n${i}`, x: 0, y: 1 })),
        { id: 'far', x: 10, y: 10 },
      ];
      const scene = new Scenario();
      scene.apply({ type: 'env_create', payload: { id: 'main', type: '2d' } });
      scene.apply({
        type: 'env_layer_create',
        payload: { env_id: 'main', layer_id: 'agents', layer_type: 'agent' },
      });
      scene.apply({
        type: 'item_create',
        payload: { env_id: 'main', layer_id: 'agents', items: agents },
      });
      scene.apply({ type: 'monitor_create', payload: { id: 'population', label: 'Population' } });
      scene.apply({
        type: 'monitor_update',
        payload: { id: 'population', value: { total: agents.length } },
      });
      for (const kind of ['agent', 'neighbors', 'cell', 'monitor'] as const) {
        const expected = {
          agents,
          population: { total: agents.length, satisfied: 0, unsatisfied: agents.length },
        };
        const result = queryScenario(scene, queryFor(kind, agents)!, {
          kind: 'live',
          sourceId: 'fixture',
          revision: 1,
          modelTime: 9,
        });
        expect(queryProof(result)).toEqual(expectedQuery(kind, expected, 9));
      }
    },
  );
  it('keeps typed identities order independent and rejects malformed projections', () => {
    const points = [
      { id: 1, x: 0, y: 0 },
      { id: '1', x: 1, y: 0 },
    ];
    expect(pointHash(points)).toBe(pointHash([...points].reverse()));
    expect(() => pointHash([points[0]!, points[0]!])).toThrow(/duplicate/);
    expect(() => pointHash([{ id: 'bad', x: NaN, y: 1 }])).toThrow(/Invalid/);
  });
  it('removes temporary files even if child teardown fails and preserves original errors', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'benchmark-cleanup-'));
    const original = Error('original model failure');
    const cleanup = Error('teardown failure');
    try {
      await finishResources(
        original,
        async () => {
          throw cleanup;
        },
        () => rm(directory, { recursive: true, force: true }),
      );
      throw Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).cause).toBe(original);
      expect((error as AggregateError).errors).toEqual([original, cleanup]);
    }
    await expect(access(directory)).rejects.toThrow();
  });
});
