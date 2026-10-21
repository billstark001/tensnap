import { WebSocketManagerImpl } from '@tensnap/web/transport';
import {
  createWebScenarioCase,
  type BenchmarkSemanticValidator,
  type BenchmarkWorkload,
} from '@tensnap/benchmark/harness';
import type { SimulatorToRendererMessage } from '@tensnap/protocol';

import {
  resolveConfig,
  randomWalkBinding,
  expectedState,
  type RandomWalkBenchmarkConfig,
} from './model';
export type { RandomWalkBenchmarkConfig } from './model';

class RandomWalkSemantics implements BenchmarkSemanticValidator {
  private readonly agents = new Map<string, { id: string; x: number; y: number }>();
  private firstMessage = true;
  private stateSyncBegun = false;
  private stateSyncEnded = false;
  private actionCount = 0;
  private updatesInCurrentAction = 0;

  constructor(private readonly config: RandomWalkBenchmarkConfig) {}

  observe(message: SimulatorToRendererMessage): void {
    if (this.firstMessage) {
      this.firstMessage = false;
      if (message.type !== 'simulator_info')
        throw new Error('v0.3 benchmark session must begin with simulator_info.');
    }
    if (message.type === 'state_sync_begin') {
      if (this.stateSyncBegun || this.stateSyncEnded)
        throw new Error('State sync transaction was not well formed.');
      this.stateSyncBegun = true;
      return;
    }
    if (message.type === 'state_sync_end') {
      if (!this.stateSyncBegun || this.stateSyncEnded)
        throw new Error('State sync ended without one open transaction.');
      this.stateSyncEnded = true;
      return;
    }
    if (message.type === 'item_create') {
      const payload = message.payload as {
        env_id: string;
        layer_id: string;
        items: Array<Record<string, unknown>>;
      };
      if (payload.env_id !== 'main' || payload.layer_id !== 'agents')
        throw new Error('Unexpected item_create target.');
      for (const item of payload.items) {
        if (
          typeof item.id !== 'string' ||
          typeof item.x !== 'number' ||
          typeof item.y !== 'number'
        ) {
          throw new Error('Initial agent item is incomplete.');
        }
        this.agents.set(item.id, { id: item.id, x: item.x, y: item.y });
      }
      return;
    }
    if (message.type === 'item_update') {
      const payload = message.payload as {
        env_id: string;
        layer_id: string;
        items: Array<Record<string, unknown>>;
      };
      if (payload.env_id !== 'main' || payload.layer_id !== 'agents')
        throw new Error('Unexpected item_update target.');
      for (const item of payload.items) {
        const keys = Object.keys(item).sort();
        if (
          keys.join(',') !== 'id,x,y' ||
          typeof item.id !== 'string' ||
          typeof item.x !== 'number' ||
          typeof item.y !== 'number'
        ) {
          throw new Error('Incremental agent updates must contain only id, x, and y.');
        }
        if (!this.agents.has(item.id))
          throw new Error(`Update references unknown agent ${item.id}.`);
        this.agents.set(item.id, { id: item.id, x: item.x, y: item.y });
        this.updatesInCurrentAction += 1;
      }
      return;
    }
    if (message.type === 'action_result') {
      const payload = message.payload as { id: string };
      if (payload.id !== 'start') return;
      if (this.updatesInCurrentAction !== this.config.changedAgents) {
        throw new Error(
          `Expected ${this.config.changedAgents} updated agents before action_result, received ${this.updatesInCurrentAction}.`,
        );
      }
      this.actionCount += 1;
      this.updatesInCurrentAction = 0;
      return;
    }
    if (
      message.type.startsWith('chart_') ||
      message.type.startsWith('monitor_') ||
      message.type.startsWith('asset_')
    ) {
      throw new Error(`Unregistered optional family emitted ${message.type}.`);
    }
  }

  assert(actionCount: number): void {
    if (this.firstMessage || !this.stateSyncBegun || !this.stateSyncEnded)
      throw new Error('Missing complete v0.3 handshake/state-sync sequence.');
    if (this.agents.size !== this.config.agentCount)
      throw new Error(
        `Expected ${this.config.agentCount} synchronized agents, received ${this.agents.size}.`,
      );
    if (this.actionCount !== actionCount || this.updatesInCurrentAction !== 0) {
      throw new Error(`Expected ${actionCount} completed actions, received ${this.actionCount}.`);
    }
  }

  snapshot(): unknown {
    return {
      agents: [...this.agents.values()].sort((left, right) => left.id.localeCompare(right.id)),
    };
  }
}

export const workload: BenchmarkWorkload<RandomWalkBenchmarkConfig> = {
  schemaVersion: 2,
  id: 'v0.3.random-walk.sparse',
  version: 1,
  kind: 'protocol',
  category: 'publication',
  protocolVersion: '0.3',
  modelId: 'benchmark.v0.3.random-walk',
  actionId: 'start',
  actionContinuous: true,
  description: 'Deterministic sparse state publication with zero-update stable steps.',
  supportedSuites: ['node', 'ws', 'browser'],
  resolveConfig,
  createSession: (config) => randomWalkBinding.createSession(config),
  createSemanticValidator: (config) => new RandomWalkSemantics(config),
  expectedState,
  createBrowserCase({ config, endpoint, encoding, validation }) {
    return createWebScenarioCase({
      name: 'v0.3 sparse random walk',
      category: 'tensnap',
      variant: `ws-${encoding}`,
      config,
      validation,
      width: config.width,
      height: config.height,
      createTransport() {
        const transport = new WebSocketManagerImpl(
          'benchmark-random-walk',
          endpoint,
          encoding === 'msgpack',
          'strict',
        );
        transport.clientMessageValidation = validation;
        transport.serverMessageValidation = validation;
        return transport;
      },
    });
  },
};

export default workload;
