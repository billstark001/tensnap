import type { AgentRenderState } from '@tensnap/core/environment';
import type { BenchmarkCase } from '../types';
import { createComponentEnvironment } from './componentEnvironment';

interface Config { agentCount: number; trailLength: number; worldSize: number; width: number; height: number }

export function createTrajectoryCase(partial: Partial<Config> = {}): BenchmarkCase {
  const config: Config = { agentCount: partial.agentCount ?? 200, trailLength: partial.trailLength ?? 300, worldSize: partial.worldSize ?? 100, width: partial.width ?? 800, height: partial.height ?? 800 };
  return {
    name: 'Environment2DView trajectory append', category: 'component', config: { ...config },
    async mount(container) {
      const agents: AgentRenderState[] = Array.from({ length: config.agentCount }, (_, index) => ({
        id: `t_${index}`, x: config.worldSize / 2, y: config.worldSize / 2,
        icon: 'circle', size: 0.8, color: `hsl(${index % 360} 70% 50%)`,
      }));
      const environment = createComponentEnvironment({
        agents, width: config.worldSize, height: config.worldSize,
        trajectory: { length: config.trailLength, width: 1, color: '#2563eb' },
      });
      const { mountWebEnvironmentBenchmark } = await import('@tensnap/web/benchmark');
      const mounted = await mountWebEnvironmentBenchmark(container, { scenario: environment.scenario, environmentId: 'main', display: '2d', width: config.width, height: config.height });
      return {
        kind: 'component',
        tick(frame) {
          const updates = agents.map((agent, index) => {
            const angle = frame * 0.08 + index * 0.13;
            const radius = 10 + (index % 35);
            const x = config.worldSize / 2 + Math.cos(angle) * radius;
            const y = config.worldSize / 2 + Math.sin(angle) * radius;
            agent.x = x; agent.y = y;
            environment.trajectories!.appendTrajectoryPoint(agent.id, { x, y, time: frame });
            return { id: agent.id, x, y };
          });
          environment.agents.updateAgents(updates);
        },
        destroy: mounted.destroy,
      };
    },
  };
}
