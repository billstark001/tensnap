import {
  SnapshotRecorder,
  decodeSnapshotArchive,
  encodeSnapshotArchive,
  materializeSnapshot,
} from '@tensnap/core';
import type { BenchmarkWorkload, NodeBenchmarkCase } from '@tensnap/benchmark/harness';
import { createAgentScenario } from '../../shared/scenario';
import {
  canonicalRandomWalkState,
  createRandomWalkAgents,
  expectedRandomWalkState,
  stepRandomWalk,
  type RandomWalkFixtureConfig,
} from '../../shared/random-walk';
import { createDeterministicRandom } from '../../shared/random';

export interface SnapshotRestoreConfig extends RandomWalkFixtureConfig, Record<string, unknown> {
  segmentFrames: number;
}

const defaults: SnapshotRestoreConfig = {
  agentCount: 1_000,
  changedAgents: 100,
  worldSize: 100,
  stepSize: 0.8,
  seed: 20_260_712,
  segmentFrames: 30,
};

function integer(value: unknown, name: string, minimum: number, maximum?: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || (maximum !== undefined && value > maximum)) throw new Error(`${name} must be an integer in range.`);
  return value;
}

function resolveConfig(overrides: Partial<SnapshotRestoreConfig> = {}): SnapshotRestoreConfig {
  const config = { ...defaults, ...overrides };
  const agentCount = integer(config.agentCount, 'agentCount', 1, 10_000);
  return {
    ...config,
    agentCount,
    changedAgents: integer(config.changedAgents, 'changedAgents', 0, agentCount),
    segmentFrames: integer(config.segmentFrames, 'segmentFrames', 1, 1_000),
    worldSize: typeof config.worldSize === 'number' && config.worldSize > 0 ? config.worldSize : defaults.worldSize,
    stepSize: typeof config.stepSize === 'number' && config.stepSize >= 0 ? config.stepSize : defaults.stepSize,
    seed: integer(config.seed, 'seed', 0, 0xffff_ffff),
  };
}

function createNodeCase(config: SnapshotRestoreConfig): NodeBenchmarkCase {
  const random = createDeterministicRandom(config.seed);
  const agents = createRandomWalkAgents(config, random);
  const scenario = createAgentScenario(agents, config.worldSize);
  const recorder = new SnapshotRecorder(scenario);
  recorder.start({ keyframeEvery: config.segmentFrames });
  return {
    run(iteration) {
      const changed = stepRandomWalk(agents, config, random, iteration);
      const update = { type: 'item_update' as const, payload: { env_id: 'main', layer_id: 'agents', items: changed.map(({ id, x, y }) => ({ id, x, y })) } };
      scenario.apply(update);
      recorder.recordMessage(update);
      recorder.recordMessage({ type: 'action_result', payload: { id: 'step', request_id: `snapshot-${iteration}`, should_continue: true } });
      const snapshot = recorder.current;
      if (!snapshot) throw new Error('Snapshot recorder unexpectedly stopped.');
      const archive = encodeSnapshotArchive(snapshot, config.segmentFrames);
      const restored = materializeSnapshot(decodeSnapshotArchive(archive));
      const current = scenario.dump();
      if (JSON.stringify(restored) !== JSON.stringify(current)) throw new Error('Archive restore changed Scenario state.');
      return { metrics: { archiveBytes: archive.byteLength, archiveSegments: archive.segments.length } };
    },
    snapshot() { return canonicalRandomWalkState(agents); },
    expectedState(actions) { return expectedRandomWalkState(config, actions); },
  };
}

export const workload: BenchmarkWorkload<SnapshotRestoreConfig> = {
  schemaVersion: 2,
  id: 'v0.3.snapshot-restore.archive',
  version: 1,
  kind: 'node',
  category: 'snapshot',
  description: 'Incremental snapshot recording, MessagePack archive encode/decode, and materialized restore verification.',
  supportedSuites: ['node'],
  resolveConfig,
  createNodeCase,
};

export default workload;
