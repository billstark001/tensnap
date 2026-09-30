import type { ISimulatorTransport } from '@tensnap/core';
import type { BenchmarkCase } from '../browser-types';

export interface WebScenarioCaseDefinition {
  name: string;
  category?: 'tensnap';
  variant?: string;
  config: Record<string, unknown>;
  width: number;
  height: number;
  actionId?: string;
  createTransport(): ISimulatorTransport;
}

/** Mount a workload through the production Web host, rather than a benchmark-only renderer. */
export function createWebScenarioCase(definition: WebScenarioCaseDefinition): BenchmarkCase {
  return {
    name: definition.name,
    category: definition.category ?? 'tensnap',
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
