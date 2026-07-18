import { createDeterministicRandom } from './random';

export interface RandomWalkFixtureConfig {
  agentCount: number;
  changedAgents: number;
  worldSize: number;
  stepSize: number;
  seed: number;
}

export interface RandomWalkAgent {
  id: string;
  x: number;
  y: number;
  icon: 'circle';
  size: number;
  color: string;
}

/** A precomputed input trace. Generating model dynamics is never timed as renderer work. */
export interface RandomWalkTrace {
  readonly initial: readonly RandomWalkAgent[];
  readonly frames: readonly (readonly RandomWalkAgent[])[];
}

export function createRandomWalkAgents(config: RandomWalkFixtureConfig, random = createDeterministicRandom(config.seed)): RandomWalkAgent[] {
  return Array.from({ length: config.agentCount }, (_, index) => ({
    id: `walker_${index}`,
    x: random() * config.worldSize,
    y: random() * config.worldSize,
    icon: 'circle',
    size: 0.7,
    color: `hsl(${index % 360} 70% 50%)`,
  }));
}

export function stepRandomWalk(
  agents: RandomWalkAgent[],
  config: RandomWalkFixtureConfig,
  random: () => number,
  tick: number,
): RandomWalkAgent[] {
  const changed: RandomWalkAgent[] = [];
  for (let offset = 0; offset < config.changedAgents; offset += 1) {
    const agent = agents[(tick * config.changedAgents + offset) % agents.length]!;
    agent.x = (agent.x + (random() * 2 - 1) * config.stepSize + config.worldSize) % config.worldSize;
    agent.y = (agent.y + (random() * 2 - 1) * config.stepSize + config.worldSize) % config.worldSize;
    changed.push(agent);
  }
  return changed;
}

export function cloneRandomWalkAgents(agents: readonly RandomWalkAgent[]): RandomWalkAgent[] {
  return agents.map((agent) => ({ ...agent }));
}

export function createRandomWalkTrace(config: RandomWalkFixtureConfig, frames: number): RandomWalkTrace {
  if (!Number.isInteger(frames) || frames < 0) throw new Error('Random-walk trace frame count must be a non-negative integer.');
  const random = createDeterministicRandom(config.seed);
  const agents = createRandomWalkAgents(config, random);
  const deltas: RandomWalkAgent[][] = [];
  for (let tick = 0; tick < frames; tick += 1) {
    // Deltas must not retain references to mutable simulation agents.
    deltas.push(stepRandomWalk(agents, config, random, tick).map((agent) => ({ ...agent })));
  }
  // Regenerate the initial state so the precomputation itself cannot leak into a renderer.
  return { initial: createRandomWalkAgents(config), frames: deltas };
}

export function applyRandomWalkDelta(agents: RandomWalkAgent[], delta: readonly RandomWalkAgent[]): void {
  for (const update of delta) {
    const index = Number(update.id.slice('walker_'.length));
    const agent = agents[index];
    if (!agent) throw new Error(`Random-walk delta refers to unknown agent ${update.id}.`);
    agent.x = update.x;
    agent.y = update.y;
  }
}

export function traceExpectedRandomWalkState(trace: RandomWalkTrace, steps: number): { agents: Array<{ id: string; x: number; y: number }> } {
  if (steps > trace.frames.length) throw new Error(`Trace has ${trace.frames.length} frames but ${steps} were requested.`);
  const agents = cloneRandomWalkAgents(trace.initial);
  for (let index = 0; index < steps; index += 1) applyRandomWalkDelta(agents, trace.frames[index]!);
  return canonicalRandomWalkState(agents);
}

export function canonicalRandomWalkState(agents: readonly RandomWalkAgent[]): { agents: Array<{ id: string; x: number; y: number }> } {
  return { agents: agents.map(({ id, x, y }) => ({ id, x, y })).sort((left, right) => left.id.localeCompare(right.id)) };
}

export function expectedRandomWalkState(config: RandomWalkFixtureConfig, steps: number): { agents: Array<{ id: string; x: number; y: number }> } {
  const random = createDeterministicRandom(config.seed);
  const agents = createRandomWalkAgents(config, random);
  for (let tick = 0; tick < steps; tick += 1) stepRandomWalk(agents, config, random, tick);
  return canonicalRandomWalkState(agents);
}
