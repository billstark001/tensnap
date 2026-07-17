import { modelBuilder, numberField } from '@tensnap/js/bindings';
import { WebSocketManagerImpl } from '@tensnap/web/transport';
import {
  createWebScenarioCase,
  type BenchmarkSemanticValidator,
  type BenchmarkWorkload,
} from '@tensnap/benchmark/harness';
import type { AgentRenderState } from '@tensnap/core/environment';
import type { SimulatorToRendererMessage } from '@tensnap/protocol';

export interface RandomWalkBenchmarkConfig extends Record<string, unknown> {
  agentCount: number;
  changedAgents: number;
  worldSize: number;
  stepSize: number;
  width: number;
  height: number;
  seed: number;
}

interface RandomWalkAgent extends AgentRenderState {
  id: string;
  x: number;
  y: number;
}

interface RandomWalkModel {
  config: RandomWalkBenchmarkConfig;
  agents: RandomWalkAgent[];
  changed: RandomWalkAgent[];
  random: () => number;
  tick: number;
}

const defaults: RandomWalkBenchmarkConfig = {
  agentCount: 1_000,
  changedAgents: 100,
  worldSize: 100,
  stepSize: 0.8,
  width: 900,
  height: 700,
  seed: 20_260_712,
};

function randomFromSeed(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function requiredInteger(value: unknown, name: string, minimum: number, maximum?: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || (maximum !== undefined && value > maximum)) {
    throw new Error(`${name} must be an integer in [${minimum}, ${maximum ?? '∞'}].`);
  }
  return value;
}

function requiredNumber(value: unknown, name: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${name} must be a finite number >= ${minimum}.`);
  }
  return value;
}

function resolveConfig(overrides: Partial<RandomWalkBenchmarkConfig> = {}): RandomWalkBenchmarkConfig {
  const config = { ...defaults, ...overrides };
  const agentCount = requiredInteger(config.agentCount, 'agentCount', 1, 10_000);
  const changedAgents = requiredInteger(config.changedAgents, 'changedAgents', 0, agentCount);
  return {
    ...config,
    agentCount,
    changedAgents,
    worldSize: requiredNumber(config.worldSize, 'worldSize', Number.MIN_VALUE),
    stepSize: requiredNumber(config.stepSize, 'stepSize', 0),
    width: requiredInteger(config.width, 'width', 1),
    height: requiredInteger(config.height, 'height', 1),
    seed: requiredInteger(config.seed, 'seed', 0, 0xffff_ffff),
  };
}

function createAgents(config: RandomWalkBenchmarkConfig, random: () => number): RandomWalkAgent[] {
  return Array.from({ length: config.agentCount }, (_, index) => ({
    id: `walker_${index}`,
    x: random() * config.worldSize,
    y: random() * config.worldSize,
    icon: 'circle',
    size: 0.7,
    color: `hsl(${index % 360} 70% 50%)`,
  }));
}

function stepAgents(
  agents: RandomWalkAgent[],
  config: RandomWalkBenchmarkConfig,
  random: () => number,
  tick: number,
): RandomWalkAgent[] {
  const changed: RandomWalkAgent[] = [];
  for (let offset = 0; offset < config.changedAgents; offset += 1) {
    const index = (tick * config.changedAgents + offset) % agents.length;
    const agent = agents[index]!;
    agent.x = (agent.x + (random() * 2 - 1) * config.stepSize + config.worldSize) % config.worldSize;
    agent.y = (agent.y + (random() * 2 - 1) * config.stepSize + config.worldSize) % config.worldSize;
    changed.push(agent);
  }
  return changed;
}

function projectAgent(agent: RandomWalkAgent): Record<string, unknown> {
  return { id: agent.id, x: agent.x, y: agent.y, icon: agent.icon, size: agent.size, color: agent.color };
}

function projectUpdate(agent: RandomWalkAgent): Record<string, unknown> {
  return { id: agent.id, x: agent.x, y: agent.y };
}

const binding = modelBuilder<RandomWalkBenchmarkConfig, RandomWalkModel>({
  id: 'benchmark.v0.3.random-walk',
  name: 'v0.3 sparse random walk benchmark',
  description: 'Deterministic sparse agent updates for TenSnap v0.3 benchmark artifacts.',
}, {
  defaults,
  create(config) {
    const random = randomFromSeed(config.seed);
    return { config: { ...config }, agents: createAgents(config, random), changed: [], random, tick: 0 };
  },
  getConfig(model) { return model.config; },
  step(model) {
    model.changed = stepAgents(model.agents, model.config, model.random, model.tick);
    model.tick += 1;
    return true;
  },
  reset(model) {
    model.random = randomFromSeed(model.config.seed);
    model.agents = createAgents(model.config, model.random);
    model.changed = [];
    model.tick = 0;
  },
  time(model) { return model.tick; },
});

binding.paramsFromConfig<RandomWalkBenchmarkConfig>({
  get: (model) => model.config,
  set(model, patch) { Object.assign(model.config, patch); },
  fields: {
    agentCount: numberField({ label: 'Agent count', integer: true, runtime: false, min: 1, max: 10_000 }),
    changedAgents: numberField({ label: 'Changed agents per step', integer: true, runtime: false, min: 0 }),
    worldSize: numberField({ label: 'World size', runtime: false, min: 1 }),
    stepSize: numberField({ label: 'Step size', min: 0, step: 0.1 }),
  },
});

binding.env('main').agentLayer<RandomWalkAgent>('agents', {
  metadata: (model) => ({ width: model.config.worldSize, height: model.config.worldSize, coord_offset: 'float' }),
  items: (model) => model.agents,
  updates: (model) => model.changed,
  project: (_model, agent) => projectAgent(agent),
  updateProject: (_model, agent) => projectUpdate(agent as RandomWalkAgent),
});

const randomWalkBinding = binding.build();

function canonicalAgentState(agents: readonly RandomWalkAgent[]): { agents: Array<{ id: string; x: number; y: number }> } {
  return {
    agents: agents
      .map((agent) => ({ id: agent.id, x: agent.x, y: agent.y }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function expectedState(config: RandomWalkBenchmarkConfig, actionCount: number): unknown {
  const random = randomFromSeed(config.seed);
  const agents = createAgents(config, random);
  for (let tick = 0; tick < actionCount; tick += 1) stepAgents(agents, config, random, tick);
  return canonicalAgentState(agents);
}

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
      if (message.type !== 'simulator_info') throw new Error('v0.3 benchmark session must begin with simulator_info.');
    }
    if (message.type === 'state_sync_begin') {
      if (this.stateSyncBegun || this.stateSyncEnded) throw new Error('State sync transaction was not well formed.');
      this.stateSyncBegun = true;
      return;
    }
    if (message.type === 'state_sync_end') {
      if (!this.stateSyncBegun || this.stateSyncEnded) throw new Error('State sync ended without one open transaction.');
      this.stateSyncEnded = true;
      return;
    }
    if (message.type === 'item_create') {
      const payload = message.payload as { env_id: string; layer_id: string; items: Array<Record<string, unknown>> };
      if (payload.env_id !== 'main' || payload.layer_id !== 'agents') throw new Error('Unexpected item_create target.');
      for (const item of payload.items) {
        if (typeof item.id !== 'string' || typeof item.x !== 'number' || typeof item.y !== 'number') {
          throw new Error('Initial agent item is incomplete.');
        }
        this.agents.set(item.id, { id: item.id, x: item.x, y: item.y });
      }
      return;
    }
    if (message.type === 'item_update') {
      const payload = message.payload as { env_id: string; layer_id: string; items: Array<Record<string, unknown>> };
      if (payload.env_id !== 'main' || payload.layer_id !== 'agents') throw new Error('Unexpected item_update target.');
      for (const item of payload.items) {
        const keys = Object.keys(item).sort();
        if (keys.join(',') !== 'id,x,y' || typeof item.id !== 'string' || typeof item.x !== 'number' || typeof item.y !== 'number') {
          throw new Error('Incremental agent updates must contain only id, x, and y.');
        }
        if (!this.agents.has(item.id)) throw new Error(`Update references unknown agent ${item.id}.`);
        this.agents.set(item.id, { id: item.id, x: item.x, y: item.y });
        this.updatesInCurrentAction += 1;
      }
      return;
    }
    if (message.type === 'action_result') {
      const payload = message.payload as { id: string };
      if (payload.id !== 'start') return;
      if (this.updatesInCurrentAction !== this.config.changedAgents) {
        throw new Error(`Expected ${this.config.changedAgents} updated agents before action_result, received ${this.updatesInCurrentAction}.`);
      }
      this.actionCount += 1;
      this.updatesInCurrentAction = 0;
      return;
    }
    if (message.type.startsWith('chart_') || message.type.startsWith('monitor_') || message.type.startsWith('asset_')) {
      throw new Error(`Unregistered optional family emitted ${message.type}.`);
    }
  }

  assert(actionCount: number): void {
    if (this.firstMessage || !this.stateSyncBegun || !this.stateSyncEnded) throw new Error('Missing complete v0.3 handshake/state-sync sequence.');
    if (this.agents.size !== this.config.agentCount) throw new Error(`Expected ${this.config.agentCount} synchronized agents, received ${this.agents.size}.`);
    if (this.actionCount !== actionCount || this.updatesInCurrentAction !== 0) {
      throw new Error(`Expected ${actionCount} completed actions, received ${this.actionCount}.`);
    }
  }

  snapshot(): unknown {
    return { agents: [...this.agents.values()].sort((left, right) => left.id.localeCompare(right.id)) };
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
      width: config.width,
      height: config.height,
      createTransport() {
        const transport = new WebSocketManagerImpl('benchmark-random-walk', endpoint, encoding === 'msgpack', 'strict');
        transport.clientMessageValidation = validation;
        transport.serverMessageValidation = validation;
        return transport;
      },
    });
  },
};

export default workload;
