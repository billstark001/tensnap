import { Ellipse, Leafer } from '@leafer-ui/core';
import type { BenchmarkWorkload } from '@tensnap/benchmark/harness';
import type { BrowserBenchmarkCase } from '@tensnap/benchmark/harness';
import { canonicalRandomWalkState, createRandomWalkAgents, expectedRandomWalkState, stepRandomWalk } from '../../shared/random-walk';
import { createDeterministicRandom } from '../../shared/random';
import { resolveRendererComparisonConfig, type RendererComparisonConfig } from './config';

export const workload: BenchmarkWorkload<RendererComparisonConfig> = {
  schemaVersion: 2,
  id: 'comparison.random-walk.leafer',
  version: 1,
  kind: 'browser',
  category: 'comparison',
  description: 'Direct Leafer scene update control for the same deterministic random-walk trace.',
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
        variant: 'leafer',
        config,
        async mount(container) {
          const host = document.createElement('div');
          host.style.width = `${config.width}px`;
          host.style.height = `${config.height}px`;
          container.replaceChildren(host);
          const leafer = new Leafer({ view: host, width: config.width, height: config.height, type: 'design', pixelRatio: 1 });
          const scale = config.width / config.worldSize;
          const shapes = agents.map((agent) => new Ellipse({
            x: agent.x * scale,
            y: agent.y * scale,
            width: Math.max(1, scale * agent.size),
            height: Math.max(1, scale * agent.size),
            fill: agent.color,
          }));
          leafer.add(shapes);
          return {
            kind: 'component',
            tick() {
              stepRandomWalk(agents, config, random, tick);
              tick += 1;
              for (let index = 0; index < agents.length; index += 1) {
                shapes[index]!.set({ x: agents[index]!.x * scale, y: agents[index]!.y * scale });
              }
            },
            destroy() { leafer.destroy(); host.remove(); },
          };
        },
      },
      snapshot() { return canonicalRandomWalkState(agents); },
      expectedState(totalFrames) { return expectedRandomWalkState(config, totalFrames); },
    };
  },
};

export default workload;
