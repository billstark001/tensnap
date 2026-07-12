import type { AgentRenderState } from '@tensnap/core/environment';
import type { BenchmarkCase } from '../types';
import { createComponentEnvironment } from './componentEnvironment';

interface Config { columns: number; rows: number; width: number; height: number }

export function createGridAgentsCase(partial: Partial<Config> = {}): BenchmarkCase {
  const config: Config = { columns: partial.columns ?? 80, rows: partial.rows ?? 60, width: partial.width ?? 900, height: partial.height ?? 675 };
  return {
    name: 'Environment2DView dense grid agents', category: 'component', config: { ...config, agentCount: config.columns * config.rows },
    async mount(container) {
      const agents: AgentRenderState[] = Array.from({ length: config.columns * config.rows }, (_, index) => ({
        id: `g_${index}`, x: index % config.columns, y: Math.floor(index / config.columns),
        icon: 'square', size: 0.9, color: `hsl(${index % 360} 55% 50%)`,
      }));
      const environment = createComponentEnvironment({ agents, width: config.columns, height: config.rows, grid: true });
      const { mountWebEnvironmentBenchmark } = await import('@tensnap/web/benchmark');
      const mounted = await mountWebEnvironmentBenchmark(container, { scenario: environment.scenario, environmentId: 'main', display: '2d', width: config.width, height: config.height });
      return {
        kind: 'component',
        tick(frame) {
          environment.agents.updateAgents(agents.map((agent, index) => ({
            id: agent.id,
            color: `hsl(${(index + frame * 3) % 360} 55% 50%)`,
          })));
        },
        destroy: mounted.destroy,
      };
    },
  };
}
