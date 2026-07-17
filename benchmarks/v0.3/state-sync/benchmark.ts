import type { ISimulatorTransport } from '@tensnap/core';
import { RendererSession } from '@tensnap/core/runtime';
import type { BenchmarkWorkload, NodeBenchmarkCase } from '@tensnap/benchmark/harness';
import {
  canonicalRandomWalkState,
  createRandomWalkAgents,
  expectedRandomWalkState,
  stepRandomWalk,
  type RandomWalkFixtureConfig,
} from '../../shared/random-walk';
import { createDeterministicRandom } from '../../shared/random';

export interface StateSyncConfig extends RandomWalkFixtureConfig, Record<string, unknown> {}

const defaults: StateSyncConfig = {
  agentCount: 1_000,
  changedAgents: 100,
  worldSize: 100,
  stepSize: 0.8,
  seed: 20_260_712,
};

function integer(value: unknown, name: string, minimum: number, maximum?: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || (maximum !== undefined && value > maximum)) throw new Error(`${name} must be an integer in range.`);
  return value;
}

function resolveConfig(overrides: Partial<StateSyncConfig> = {}): StateSyncConfig {
  const config = { ...defaults, ...overrides };
  const agentCount = integer(config.agentCount, 'agentCount', 1, 10_000);
  return {
    ...config,
    agentCount,
    changedAgents: integer(config.changedAgents, 'changedAgents', 0, agentCount),
    worldSize: typeof config.worldSize === 'number' && config.worldSize > 0 ? config.worldSize : defaults.worldSize,
    stepSize: typeof config.stepSize === 'number' && config.stepSize >= 0 ? config.stepSize : defaults.stepSize,
    seed: integer(config.seed, 'seed', 0, 0xffff_ffff),
  };
}

function createNodeCase(config: StateSyncConfig): NodeBenchmarkCase {
  const random = createDeterministicRandom(config.seed);
  const agents = createRandomWalkAgents(config, random);
  let state = canonicalRandomWalkState(agents);
  // This local transport is only the RendererSession control surface. The
  // WebSocket suite remains the protocol transport measurement; here we time
  // the renderer's staged state-sync commit itself without socket noise.
  const transport = {
    connectionId: 'benchmark-state-sync',
    transportKind: 'benchmark-local',
    encoding: 'json',
    connectionState: 'open',
    isConnected: true,
    async connect() {},
    disconnect() {},
    destroy() {},
    on() {},
    off() {},
    send() {},
  } as ISimulatorTransport;
  const session = new RendererSession();
  session.attachTransport(transport);
  session.handleIncoming({
    type: 'simulator_info',
    payload: {
      protocol_version: '0.3',
      binding: { name: 'benchmark', version: '0.3.0', language: 'typescript' },
      model: { id: 'benchmark.v0.3.state-sync' },
      instance_id: 'benchmark-instance',
      capabilities: [],
    },
  });
  return {
    run(iteration) {
      stepRandomWalk(agents, config, random, iteration);
      const requestId = `sync-${iteration}`;
      session.requestStateSync(requestId);
      session.handleIncoming({ type: 'state_sync_begin', payload: { request_id: requestId, model_id: 'benchmark.v0.3.state-sync', instance_id: 'benchmark-instance', mode: 'replace' } });
      session.handleIncoming({ type: 'env_create', payload: { id: 'main', type: '2d' } });
      session.handleIncoming({
        type: 'env_layer_create',
        payload: { env_id: 'main', layer_id: 'agents', layer_type: 'agent', metadata: { width: config.worldSize, height: config.worldSize, coord_offset: 'float' } },
      });
      session.handleIncoming({ type: 'item_create', payload: { env_id: 'main', layer_id: 'agents', items: structuredClone(agents) as unknown as Array<Record<string, never>> } });
      session.handleIncoming({ type: 'chart_create', payload: { id: 'population', label: 'Population' } });
      session.handleIncoming({ type: 'chart_update', payload: { updates: [{ id: 'population', time: iteration, value: config.agentCount }] } });
      session.handleIncoming({ type: 'monitor_create', payload: { id: 'sync', label: 'Sync' } });
      session.handleIncoming({ type: 'monitor_update', payload: { id: 'sync', revision: iteration + 1, value: { agentCount: config.agentCount, iteration } } });
      session.handleIncoming({ type: 'state_sync_end', payload: { request_id: requestId, state_revision: String(iteration + 1) } });
      state = canonicalRandomWalkState(agents);
      return { metrics: { synchronizedItems: config.agentCount, snapshotBytes: JSON.stringify(session.scenario.dump()).length } };
    },
    snapshot() { return state; },
    expectedState(actions) { return expectedRandomWalkState(config, actions); },
  };
}

export const workload: BenchmarkWorkload<StateSyncConfig> = {
  schemaVersion: 2,
  id: 'v0.3.state-sync.replace',
  version: 1,
  kind: 'node',
  category: 'core',
  description: 'Cold v0.3 replacement state synchronization: Scenario transaction, agent payload, chart, and monitor state.',
  supportedSuites: ['node'],
  resolveConfig,
  createNodeCase,
};

export default workload;
