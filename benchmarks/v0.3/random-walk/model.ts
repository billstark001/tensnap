// Shared deterministic model and reference trajectory; independent of browser adapters.
import { modelBuilder, numberField } from '@tensnap/js/bindings';
import type { AgentRenderState } from '@tensnap/core/environment';

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
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    (maximum !== undefined && value > maximum)
  ) {
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

export function resolveConfig(
  overrides: Partial<RandomWalkBenchmarkConfig> = {},
): RandomWalkBenchmarkConfig {
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
    agent.x =
      (agent.x + (random() * 2 - 1) * config.stepSize + config.worldSize) % config.worldSize;
    agent.y =
      (agent.y + (random() * 2 - 1) * config.stepSize + config.worldSize) % config.worldSize;
    changed.push(agent);
  }
  return changed;
}

function projectAgent(agent: RandomWalkAgent): Record<string, unknown> {
  return {
    id: agent.id,
    x: agent.x,
    y: agent.y,
    icon: agent.icon,
    size: agent.size,
    color: agent.color,
  };
}

function projectUpdate(agent: RandomWalkAgent): Record<string, unknown> {
  return { id: agent.id, x: agent.x, y: agent.y };
}

const binding = modelBuilder<RandomWalkBenchmarkConfig, RandomWalkModel>(
  {
    id: 'benchmark.v0.3.random-walk',
    name: 'v0.3 sparse random walk benchmark',
    description: 'Deterministic sparse agent updates for TenSnap v0.3 benchmark artifacts.',
  },
  {
    defaults,
    create(config) {
      const random = randomFromSeed(config.seed);
      return {
        config: { ...config },
        agents: createAgents(config, random),
        changed: [],
        random,
        tick: 0,
      };
    },
    getConfig(model) {
      return model.config;
    },
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
    time(model) {
      return model.tick;
    },
  },
);

binding.paramsFromConfig<RandomWalkBenchmarkConfig>({
  get: (model) => model.config,
  set(model, patch) {
    Object.assign(model.config, patch);
  },
  fields: {
    agentCount: numberField({
      label: 'Agent count',
      integer: true,
      runtime: false,
      min: 1,
      max: 10_000,
    }),
    changedAgents: numberField({
      label: 'Changed agents per step',
      integer: true,
      runtime: false,
      min: 0,
    }),
    worldSize: numberField({ label: 'World size', runtime: false, min: 1 }),
    stepSize: numberField({ label: 'Step size', min: 0, step: 0.1 }),
  },
});

binding.env('main').agentLayer<RandomWalkAgent>('agents', {
  metadata: (model) => ({
    width: model.config.worldSize,
    height: model.config.worldSize,
    coord_offset: 'float',
  }),
  items: (model) => model.agents,
  updates: (model) => model.changed,
  project: (_model, agent) => projectAgent(agent),
  updateProject: (_model, agent) => projectUpdate(agent as RandomWalkAgent),
});

export const randomWalkBinding = binding.build();

function canonicalAgentState(agents: readonly RandomWalkAgent[]): {
  agents: Array<{ id: string; x: number; y: number }>;
} {
  return {
    agents: agents
      .map((agent) => ({ id: agent.id, x: agent.x, y: agent.y }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function expectedState(config: RandomWalkBenchmarkConfig, actionCount: number): unknown {
  const random = randomFromSeed(config.seed);
  const agents = createAgents(config, random);
  for (let tick = 0; tick < actionCount; tick += 1) stepAgents(agents, config, random, tick);
  return canonicalAgentState(agents);
}
