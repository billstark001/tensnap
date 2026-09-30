import type { RandomWalkFixtureConfig } from '../../shared/random-walk';

export interface RendererComparisonConfig extends RandomWalkFixtureConfig, Record<string, unknown> {
  width: number;
  height: number;
  /** Trace generation happens before mounting and is intentionally outside timed work. */
  traceFrames: number;
}

export const rendererComparisonDefaults: RendererComparisonConfig = {
  agentCount: 1_000,
  changedAgents: 1_000,
  worldSize: 100,
  stepSize: 0.8,
  seed: 20_260_712,
  width: 900,
  height: 700,
  traceFrames: 256,
};

function integer(value: unknown, name: string, minimum: number, maximum?: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || (maximum !== undefined && value > maximum)) {
    throw new Error(`${name} must be an integer in [${minimum}, ${maximum ?? '∞'}].`);
  }
  return value;
}

export function resolveRendererComparisonConfig(overrides: Partial<RendererComparisonConfig> = {}): RendererComparisonConfig {
  const config = { ...rendererComparisonDefaults, ...overrides };
  const agentCount = integer(config.agentCount, 'agentCount', 1, 10_000);
  return {
    ...config,
    agentCount,
    changedAgents: integer(config.changedAgents, 'changedAgents', 0, agentCount),
    width: integer(config.width, 'width', 1),
    height: integer(config.height, 'height', 1),
    traceFrames: integer(config.traceFrames, 'traceFrames', 1, 10_000),
    worldSize: typeof config.worldSize === 'number' && Number.isFinite(config.worldSize) && config.worldSize > 0 ? config.worldSize : rendererComparisonDefaults.worldSize,
    stepSize: typeof config.stepSize === 'number' && Number.isFinite(config.stepSize) && config.stepSize >= 0 ? config.stepSize : rendererComparisonDefaults.stepSize,
    seed: integer(config.seed, 'seed', 0, 0xffff_ffff),
  };
}
