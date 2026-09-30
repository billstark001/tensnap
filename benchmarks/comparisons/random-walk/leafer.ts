import { Ellipse, Leafer } from '@leafer-ui/core';
import type { BenchmarkWorkload } from '@tensnap/benchmark/harness';
import type { BrowserBenchmarkCase } from '@tensnap/benchmark/harness';
import { applyRandomWalkDelta, canonicalRandomWalkState, cloneRandomWalkAgents, createRandomWalkTrace, traceExpectedRandomWalkState } from '../../shared/random-walk';
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
    const trace = createRandomWalkTrace(config, config.traceFrames);
    const agents = cloneRandomWalkAgents(trace.initial);
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
            tick(frameIndex) {
              const delta = trace.frames[frameIndex];
              if (!delta) throw new Error(`Renderer profile needs trace frame ${frameIndex}; increase traceFrames.`);
              applyRandomWalkDelta(agents, delta);
              for (const update of delta) {
                const index = Number(update.id.slice('walker_'.length));
                shapes[index]!.set({ x: update.x * scale, y: update.y * scale });
              }
            },
            destroy() { leafer.destroy(); host.remove(); },
          };
        },
      },
      snapshot() { return canonicalRandomWalkState(agents); },
      expectedState(totalFrames) { return traceExpectedRandomWalkState(trace, totalFrames); },
    };
  },
};

export default workload;
