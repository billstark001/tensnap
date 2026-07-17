import type { BenchmarkWorkload } from '@tensnap/benchmark/harness';
import type { BrowserBenchmarkCase } from '@tensnap/benchmark/harness';
import { canonicalRandomWalkState, createRandomWalkAgents, expectedRandomWalkState, stepRandomWalk } from '../../shared/random-walk';
import { createDeterministicRandom } from '../../shared/random';
import { resolveRendererComparisonConfig, type RendererComparisonConfig } from './config';

function draw(context: CanvasRenderingContext2D, config: RendererComparisonConfig, agents: ReturnType<typeof createRandomWalkAgents>): void {
  const scale = config.width / config.worldSize;
  context.clearRect(0, 0, config.width, config.height);
  for (const agent of agents) {
    context.fillStyle = agent.color;
    context.beginPath();
    context.arc(agent.x * scale, agent.y * scale, Math.max(1, scale * agent.size / 2), 0, Math.PI * 2);
    context.fill();
  }
}

export const workload: BenchmarkWorkload<RendererComparisonConfig> = {
  schemaVersion: 2,
  id: 'comparison.random-walk.canvas2d',
  version: 1,
  kind: 'browser',
  category: 'comparison',
  description: 'Direct Canvas 2D control for the same deterministic random-walk trace.',
  supportedSuites: ['browser'],
  resolveConfig: resolveRendererComparisonConfig,
  createBrowserCase({ config }): BrowserBenchmarkCase {
    const random = createDeterministicRandom(config.seed);
    const agents = createRandomWalkAgents(config, random);
    let tick = 0;
    return {
      case: {
        name: 'Random walk renderer comparison',
        category: 'renderer-control',
        variant: 'canvas2d',
        config,
        async mount(container) {
          const canvas = document.createElement('canvas');
          canvas.width = config.width;
          canvas.height = config.height;
          canvas.style.width = `${config.width}px`;
          canvas.style.height = `${config.height}px`;
          container.replaceChildren(canvas);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas 2D context is unavailable.');
          draw(context, config, agents);
          return {
            kind: 'component',
            tick() {
              stepRandomWalk(agents, config, random, tick);
              tick += 1;
              draw(context, config, agents);
            },
            destroy() { canvas.remove(); },
          };
        },
      },
      snapshot() { return canonicalRandomWalkState(agents); },
      expectedState(totalFrames) { return expectedRandomWalkState(config, totalFrames); },
    };
  },
};

export default workload;
