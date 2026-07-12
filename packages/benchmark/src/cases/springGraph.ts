import type { AgentRenderState, GraphEdge } from '@tensnap/core/environment';
import type { BenchmarkCase } from '../types';
import { createComponentEnvironment } from './componentEnvironment';

interface Config { nodeCount: number; edgeProbability: number; perturbFraction: number; width: number; height: number }

export function createSpringGraphCase(partial: Partial<Config> = {}): BenchmarkCase {
  const config: Config = { nodeCount: partial.nodeCount ?? 250, edgeProbability: partial.edgeProbability ?? 0.025, perturbFraction: partial.perturbFraction ?? 0.08, width: partial.width ?? 800, height: partial.height ?? 700 };
  const nodeTemplate: AgentRenderState[] = Array.from({ length: config.nodeCount }, (_, index) => ({ id: `n_${index}`, x: (Math.random() - 0.5) * 100, y: (Math.random() - 0.5) * 100, icon: 'circle', size: 1, color: `hsl(${index % 360} 65% 55%)` }));
  const edges: GraphEdge[] = [];
  for (let source = 0; source < config.nodeCount; source += 1) {
    for (let target = source + 1; target < config.nodeCount; target += 1) {
      if (Math.random() < config.edgeProbability) edges.push({ source: `n_${source}`, target: `n_${target}` });
    }
  }
  return {
    name: 'Environment2DView spring graph', category: 'component', config: { ...config, edgeCount: edges.length },
    async mount(container) {
      const nodes = nodeTemplate.map((node) => ({ ...node }));
      const environment = createComponentEnvironment({ agents: nodes, edges: edges as Array<{ source: string; target: string }>, width: 100, height: 100 });
      const { mountWebEnvironmentBenchmark } = await import('@tensnap/web/benchmark');
      const mounted = await mountWebEnvironmentBenchmark(container, { scenario: environment.scenario, environmentId: 'main', display: '2d', width: config.width, height: config.height });
      return {
        kind: 'component',
        tick(frame) {
          const updateCount = Math.max(1, Math.floor(config.nodeCount * config.perturbFraction));
          const updates = Array.from({ length: updateCount }, (_, offset) => {
            const index = (frame * updateCount + offset) % nodes.length;
            const node = nodes[index];
            node.x = (node.x ?? 0) + Math.sin(frame + offset) * 2;
            node.y = (node.y ?? 0) + Math.cos(frame + offset) * 2;
            return { id: node.id, x: node.x, y: node.y };
          });
          environment.agents.updateAgents(updates);
        },
        destroy: mounted.destroy,
      };
    },
  };
}
