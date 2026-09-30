import { Scenario } from '@tensnap/core';
import type { BenchmarkWorkload, NodeBenchmarkCase } from '@tensnap/benchmark/harness';
import {
  canonicalRandomWalkState,
  createRandomWalkAgents,
  expectedRandomWalkState,
  stepRandomWalk,
  type RandomWalkFixtureConfig,
} from '../../shared/random-walk';
import { createDeterministicRandom } from '../../shared/random';

export interface CoreTraceConfig extends RandomWalkFixtureConfig, Record<string, unknown> {
  monitorArrayLength: number;
}

const defaults: CoreTraceConfig = {
  agentCount: 1_000,
  changedAgents: 100,
  worldSize: 100,
  stepSize: 0.8,
  seed: 20_260_712,
  monitorArrayLength: 32,
};

function integer(value: unknown, name: string, minimum: number, maximum?: number): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < minimum || (maximum !== undefined && value > maximum)) {
    throw new Error(`${name} must be an integer in [${minimum}, ${maximum ?? '∞'}].`);
  }
  return value;
}

function resolveConfig(overrides: Partial<CoreTraceConfig> = {}): CoreTraceConfig {
  const config = { ...defaults, ...overrides };
  const agentCount = integer(config.agentCount, 'agentCount', 1, 10_000);
  return {
    ...config,
    agentCount,
    changedAgents: integer(config.changedAgents, 'changedAgents', 0, agentCount),
    monitorArrayLength: integer(config.monitorArrayLength, 'monitorArrayLength', 0, 10_000),
    worldSize: typeof config.worldSize === 'number' && config.worldSize > 0 ? config.worldSize : defaults.worldSize,
    stepSize: typeof config.stepSize === 'number' && config.stepSize >= 0 ? config.stepSize : defaults.stepSize,
    seed: integer(config.seed, 'seed', 0, 0xffff_ffff),
  };
}

function createTraceScenario(agents: ReturnType<typeof createRandomWalkAgents>, config: CoreTraceConfig): Scenario {
  const scenario = new Scenario();
  scenario.apply({ type: 'env_create', payload: { id: 'main', type: '2d' } });
  scenario.apply({
    type: 'env_layer_create',
    payload: { env_id: 'main', layer_id: 'agents', layer_type: 'agent', metadata: { width: config.worldSize, height: config.worldSize, coord_offset: 'float' } },
  });
  scenario.apply({ type: 'item_create', payload: { env_id: 'main', layer_id: 'agents', items: structuredClone(agents) as unknown as Array<Record<string, never>> } });
  scenario.apply({ type: 'chart_create', payload: { id: 'population', label: 'Population' } });
  scenario.apply({ type: 'monitor_create', payload: { id: 'diagnostics', label: 'Diagnostics', render_hint: 'tree' } });
  return scenario;
}

function expected(config: CoreTraceConfig, actions: number): unknown {
  return {
    ...expectedRandomWalkState(config, actions),
    chartTime: actions === 0 ? null : actions - 1,
    monitorRevision: actions,
  };
}

function createNodeCase(config: CoreTraceConfig): NodeBenchmarkCase {
  const random = createDeterministicRandom(config.seed);
  const agents = createRandomWalkAgents(config, random);
  const scenario = createTraceScenario(agents, config);
  let completed = 0;
  return {
    run(iteration) {
      const changed = stepRandomWalk(agents, config, random, iteration);
      scenario.apply({
        type: 'item_update',
        payload: { env_id: 'main', layer_id: 'agents', items: changed.map(({ id, x, y }) => ({ id, x, y })) },
      });
      scenario.apply({ type: 'chart_update', payload: { updates: [{ id: 'population', time: iteration, value: config.agentCount }] } });
      scenario.apply({
        type: 'monitor_update',
        payload: {
          id: 'diagnostics',
          revision: iteration + 1,
          value: { tick: iteration, changed: changed.length, sample: Array.from({ length: config.monitorArrayLength }, (_, index) => (iteration + index) % 97) },
        },
      });
      completed += 1;
      return { metrics: { changedItems: changed.length, monitorValues: config.monitorArrayLength } };
    },
    snapshot() {
      return {
        ...canonicalRandomWalkState(agents),
        chartTime: completed === 0 ? null : completed - 1,
        monitorRevision: completed,
      };
    },
    expectedState(actions) { return expected(config, actions); },
  };
}

export const workload: BenchmarkWorkload<CoreTraceConfig> = {
  schemaVersion: 2,
  id: 'v0.3.core-trace.apply',
  version: 1,
  kind: 'node',
  category: 'core',
  description: 'Scenario incremental apply: sparse agent deltas plus chart append and structured monitor replacement.',
  supportedSuites: ['node'],
  resolveConfig,
  createNodeCase,
};

export default workload;
