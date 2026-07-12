import type { AgentRenderState } from '@tensnap/core/environment';
import type { BenchmarkCase } from '../types';
import { createComponentEnvironment } from './componentEnvironment';

interface Config { agentCount: number; updatesPerFrame: number; width: number; height: number }

export function createUniformAgentsCase(partial: Partial<Config> = {}): BenchmarkCase {
  const config: Config = { agentCount: partial.agentCount ?? 5_000, updatesPerFrame: partial.updatesPerFrame ?? 500, width: partial.width ?? 900, height: partial.height ?? 600 };
  return {
    name: 'UniformEnvironmentView agent updates', category: 'component', config: { ...config },
    async mount(container) {
      const agents: AgentRenderState[] = Array.from({ length: config.agentCount }, (_, index) => ({ id: `u_${index}`, icon: index % 2 ? 'circle' : 'square', size: 16, color: `hsl(${index % 360} 60% 50%)`, data: { group: index % 10 } }));
      const environment = createComponentEnvironment({ agents, width: 1, height: 1, display: 'uniform' });
      const { mountWebEnvironmentBenchmark } = await import('@tensnap/web/benchmark');
      const mounted = await mountWebEnvironmentBenchmark(container, { scenario: environment.scenario, environmentId: 'main', display: 'uniform', width: config.width, height: config.height });
      return {
        kind: 'component',
        tick(frame) {
          environment.agents.updateAgents(Array.from({ length: config.updatesPerFrame }, (_, offset) => {
            const index = (frame * config.updatesPerFrame + offset) % config.agentCount;
            return { id: `u_${index}`, color: `hsl(${(index + frame * 7) % 360} 60% 50%)` };
          }));
        },
        destroy: mounted.destroy,
      };
    },
  };
}
