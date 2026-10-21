// @vitest-environment node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { resolveConfig, workload, type AgentBenchmarkConfig } from './benchmark';
import { expectedQuery, queryFor } from './oracle';
import {
  describePlan,
  loadBenchmarkProfile,
  loadSpecification,
} from '../../../packages/benchmark/src/evaluation/config';
import { externalResultSample, validateProfile } from '../../../packages/benchmark/src/node/runner';

const root = path.resolve(import.meta.dirname, '../../..');
describe('agent benchmark contracts', () => {
  it.each([
    { steps: 0 },
    { changedAgents: 1001 },
    { query: 'eval' },
    { typo: true },
    { case: ['control'] },
  ])('rejects invalid configuration %j', (input) => {
    expect(() => resolveConfig(input as Partial<AgentBenchmarkConfig>)).toThrow();
  });
  it('requires the whole-run trial unit for control and collection', () => {
    expect(() =>
      workload.createExternalCommand(resolveConfig(), {
        repositoryRoot: root,
        replicate: 0,
        warmupActions: 1,
        measuredActions: 1,
      }),
    ).toThrow(/whole run/);
  });
  it('uses independent model initialization and a bounded plain-array neighbor oracle', () => {
    const expected = {
      agents: [
        { id: 1, x: 0, y: 0 },
        { id: '1', x: 1, y: 0 },
        ...Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, x: 0, y: 1 })),
        { id: 'far', x: 10, y: 10 },
      ],
      population: undefined,
    };
    const query = queryFor('neighbors', expected.agents);
    expect(query?.limit).toBe(8);
    const proof = expectedQuery('neighbors', expected, 0);
    expect(proof).toMatchObject({ count: 8, truncated: true, hasCursor: true });
    expect(proof.items[0]!.ref).toMatchObject({ agentId: '1' });
  });
  it('retains explicit evidence and refuses implicit expectedState fallback', () => {
    const process = { isolated: true, wallMs: 1, userCpuMs: 0, systemCpuMs: 0, maxRssBytes: null };
    expect(() =>
      externalResultSample(
        { schemaVersion: 1, retainSemanticEvidence: true, timingsMs: [1], state: { time: 1 } },
        0,
        process,
      ),
    ).toThrow(/explicit/);
    const evidence = { state: { time: 1 }, expectedState: { time: 1 } };
    expect(
      externalResultSample(
        { schemaVersion: 1, retainSemanticEvidence: true, timingsMs: [1], ...evidence },
        0,
        process,
      ).semanticEvidence,
    ).toEqual(evidence);
  });
  it('includes the agent experiment in the default root evaluation and selects its short smoke matrix', async () => {
    const specification = await loadSpecification(root);
    expect(specification.experiments.find((e) => e.id === 'agent-cli-v1')).toMatchObject({
      kind: 'benchmark',
      profile: 'benchmarks/profiles/agent-cli-v1.json',
      smokeProfile: 'benchmarks/profiles/agent-cli-smoke-v1.json',
    });
    const agent = await loadSpecification(root, 'benchmarks/evaluation/agent-cli-v1.json');
    expect(agent.environment).toBe('node');
    expect(await describePlan(root, agent, 'smoke')).toContain('14 conditions × 1 replicates = 14');
    const full = await loadBenchmarkProfile(root, agent.experiments[0]!.profile!);
    expect(full.requireCleanGit).toBe(true);
    expect(full.repetitions).toBe(15);
    for (const name of await readdir(import.meta.dirname)) {
      if (
        ((name.endsWith('.ts') || name.endsWith('.mjs')) &&
          !name.endsWith('.test.ts') &&
          !name.startsWith('test-')) ||
        name === 'package.json'
      )
        expect(full.artifactExtension?.sources).toHaveProperty(`benchmarks/agent/v1/${name}`);
    }
    const smoke = validateProfile(
      JSON.parse(await readFile(path.join(root, agent.experiments[0]!.smokeProfile!), 'utf8')),
    );
    expect(new Set(smoke.workloads.map((w) => w.config?.case))).toEqual(
      new Set(['control', 'query', 'collection']),
    );
    expect(
      smoke.workloads
        .filter((w) => w.config?.case === 'collection')
        .map((w) => w.config?.collection),
    ).toEqual(['none', 'archive', 'full-history', 'rolling']);
  });
});
