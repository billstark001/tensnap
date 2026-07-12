import type { ISimulatorTransport } from '@tensnap/core';
import type { BenchmarkCase } from '../types';

export interface WebScenarioCaseDefinition {
  name: string;
  category?: 'model' | 'random-walk';
  variant?: string;
  config: Record<string, unknown>;
  width: number;
  height: number;
  actionId?: string;
  createTransport(): ISimulatorTransport;
}

/** Model cases delegate all rendering and execution to the production Web host. */
export function createWebScenarioCase(definition: WebScenarioCaseDefinition): BenchmarkCase {
  return {
    name: definition.name,
    category: definition.category ?? 'model',
    variant: definition.variant,
    config: definition.config,
    actionId: definition.actionId ?? 'start',
    async mount(container, options) {
      const { mountWebBenchmark } = await import('@tensnap/web/benchmark');
      const mounted = await mountWebBenchmark(container, {
        transport: definition.createTransport(),
        width: definition.width,
        height: definition.height,
        ...options,
      });
      return { kind: 'model', ...mounted };
    },
  };
}
