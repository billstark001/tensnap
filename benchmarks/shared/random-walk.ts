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

export function canonicalRandomWalkState(agents: readonly RandomWalkAgent[]): { agents: Array<{ id: string; x: number; y: number }> } {
  return { agents: agents.map(({ id, x, y }) => ({ id, x, y })).sort((left, right) => left.id.localeCompare(right.id)) };
}

export function expectedRandomWalkState(config: RandomWalkFixtureConfig, steps: number): { agents: Array<{ id: string; x: number; y: number }> } {
  const random = createDeterministicRandom(config.seed);
  const agents = createRandomWalkAgents(config, random);
  for (let tick = 0; tick < steps; tick += 1) stepRandomWalk(agents, config, random, tick);
  return canonicalRandomWalkState(agents);
}
