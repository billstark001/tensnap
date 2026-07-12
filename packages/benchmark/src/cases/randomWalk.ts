import { Ellipse, Leafer } from '@leafer-ui/core';
import { AgentLayer, AgentStorage, type AgentRenderState } from '@tensnap/core/environment';
import { EnvironmentView } from '@tensnap/core/environment/browser';
import { modelBuilder, numberField } from '@tensnap/js/bindings';
import type { SimulatorSession } from '@tensnap/js/runtime';
import { InMemoryTransport } from '@tensnap/web-adapter/transport';
import type { BenchmarkCase } from '../types';
import { createWebScenarioCase } from './createWebScenarioCase';

export interface RandomWalkConfig {
  agentCount: number;
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
  config: RandomWalkConfig;
  agents: RandomWalkAgent[];
  random: () => number;
  tick: number;
}

const defaults: RandomWalkConfig = {
  agentCount: 2_000,
  worldSize: 100,
  stepSize: 0.8,
  width: 800,
  height: 800,
  seed: 20260712,
};

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createAgents(config: RandomWalkConfig, random: () => number): RandomWalkAgent[] {
  return Array.from({ length: config.agentCount }, (_, index) => ({
    id: `walker_${index}`,
    x: random() * config.worldSize,
    y: random() * config.worldSize,
    icon: 'circle',
    size: 0.7,
    color: `hsl(${index % 360} 70% 50%)`,
  }));
}

function stepAgents(agents: RandomWalkAgent[], config: RandomWalkConfig, random: () => number): void {
  for (const agent of agents) {
    agent.x = (agent.x + (random() * 2 - 1) * config.stepSize + config.worldSize) % config.worldSize;
    agent.y = (agent.y + (random() * 2 - 1) * config.stepSize + config.worldSize) % config.worldSize;
  }
}

const builder = modelBuilder<RandomWalkConfig, RandomWalkModel>({
  id: 'benchmark-random-walk',
  name: 'Benchmark Random Walk',
  description: 'A minimal random walk used to isolate Web communication and layer overhead.',
}, {
  defaults,
  create(config) {
    const random = createRandom(config.seed);
    return { config: { ...config }, agents: createAgents(config, random), random, tick: 0 };
  },
  getConfig(model) { return model.config; },
  step(model) {
    stepAgents(model.agents, model.config, model.random);
    model.tick += 1;
    return true;
  },
  reset(model) {
    model.random = createRandom(model.config.seed);
    model.agents = createAgents(model.config, model.random);
    model.tick = 0;
  },
  time(model) { return model.tick; },
});

builder.paramsFromConfig<RandomWalkConfig>({
  get: (model) => model.config,
  set(model, patch) { Object.assign(model.config, patch); },
  fields: {
    agentCount: numberField({ label: 'Agent Count', integer: true, runtime: false, min: 1 }),
    worldSize: numberField({ label: 'World Size', runtime: false, min: 1 }),
    stepSize: numberField({ label: 'Step Size', min: 0.01, step: 0.1 }),
  },
});

builder.env('main').agentLayer<RandomWalkAgent>('agents', {
  data: (model) => ({ width: model.config.worldSize, height: model.config.worldSize, coord_offset: 'float' }),
  items: (model) => model.agents,
});

const randomWalkBinding = builder.build();

function createTransport(config: RandomWalkConfig): InMemoryTransport {
  const session: SimulatorSession = randomWalkBinding.createSession(config);
  const connectionId = `benchmark-random-walk-${crypto.randomUUID()}`;
  return new InMemoryTransport({
    connectionId,
    async onConnect(send) {
      session.attach(send, connectionId);
      await session.open(connectionId);
    },
    onMessage(message) { return session.dispatch(message); },
    onDisconnect() { void session.close(); },
  }, connectionId);
}

function resolveConfig(partial: Partial<RandomWalkConfig>): RandomWalkConfig {
  return { ...defaults, ...partial };
}

export function createRawLeaferRandomWalkCase(partial: Partial<RandomWalkConfig> = {}): BenchmarkCase {
  const config = resolveConfig(partial);
  return {
    name: 'Random walk overhead', category: 'random-walk', variant: 'raw-leafer', config: { ...config },
    async mount(container) {
      const host = document.createElement('div');
      host.style.width = `${config.width}px`; host.style.height = `${config.height}px`;
      container.replaceChildren(host);
      const random = createRandom(config.seed);
      const agents = createAgents(config, random);
      const leafer = new Leafer({ view: host, width: config.width, height: config.height, type: 'design', pixelRatio: window.devicePixelRatio || 1 });
      const scale = config.width / config.worldSize;
      const shapes = agents.map((agent) => new Ellipse({ x: agent.x * scale, y: agent.y * scale, width: Math.max(1, scale * agent.size!), height: Math.max(1, scale * agent.size!), fill: agent.color }));
      leafer.add(shapes);
      return {
        kind: 'component',
        tick() {
          stepAgents(agents, config, random);
          for (let index = 0; index < agents.length; index += 1) {
            shapes[index].set({ x: agents[index].x * scale, y: agents[index].y * scale });
          }
        },
        destroy() { leafer.destroy(); host.remove(); },
      };
    },
  };
}

export function createLayerRandomWalkCase(partial: Partial<RandomWalkConfig> = {}): BenchmarkCase {
  const config = resolveConfig(partial);
  return {
    name: 'Random walk overhead', category: 'random-walk', variant: 'layers-no-transport', config: { ...config },
    async mount(container) {
      const host = document.createElement('div');
      host.style.width = `${config.width}px`; host.style.height = `${config.height}px`;
      container.replaceChildren(host);
      const random = createRandom(config.seed);
      const agents = createAgents(config, random);
      const storage = new AgentStorage();
      const view = new EnvironmentView(host, { throttleMs: 0 });
      view.addLayer(new AgentLayer(storage, { clickable: false, coordOffset: 'float', sceneBounds: { width: config.worldSize, height: config.worldSize } }));
      view.setViewport(0, 0, config.worldSize, config.worldSize);
      storage.setAgents(agents);
      return {
        kind: 'component',
        tick() { stepAgents(agents, config, random); storage.updateAgents(agents); },
        destroy() { view.destroy(); host.remove(); },
      };
    },
  };
}

export function createTransportRandomWalkCase(partial: Partial<RandomWalkConfig> = {}): BenchmarkCase {
  const config = resolveConfig(partial);
  return createWebScenarioCase({
    name: 'Random walk overhead', category: 'random-walk', variant: 'production-transport',
    config: { ...config }, width: config.width, height: config.height,
    createTransport: () => createTransport(config),
  });
}

export function createRandomWalkCases(partial: Partial<RandomWalkConfig> = {}): BenchmarkCase[] {
  return [
    createRawLeaferRandomWalkCase(partial),
    createLayerRandomWalkCase(partial),
    createTransportRandomWalkCase(partial),
  ];
}
