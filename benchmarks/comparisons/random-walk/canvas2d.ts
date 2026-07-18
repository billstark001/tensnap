import type { BenchmarkWorkload } from '@tensnap/benchmark/harness';
import type { BrowserBenchmarkCase } from '@tensnap/benchmark/harness';
import { applyRandomWalkDelta, canonicalRandomWalkState, cloneRandomWalkAgents, createRandomWalkTrace, traceExpectedRandomWalkState } from '../../shared/random-walk';
import { resolveRendererComparisonConfig, type RendererComparisonConfig } from './config';

function draw(context: CanvasRenderingContext2D, config: RendererComparisonConfig, agents: ReturnType<typeof cloneRandomWalkAgents>): void {
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
    const trace = createRandomWalkTrace(config, config.traceFrames);
    const agents = cloneRandomWalkAgents(trace.initial);
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
            tick(frameIndex) {
              const delta = trace.frames[frameIndex];
              if (!delta) throw new Error(`Renderer profile needs trace frame ${frameIndex}; increase traceFrames.`);
              applyRandomWalkDelta(agents, delta);
              // Canvas is immediate-mode, so a non-empty delta requires a full
              // redraw. A zero-delta frame must not manufacture renderer work.
              if (delta.length > 0) draw(context, config, agents);
            },
            destroy() { canvas.remove(); },
          };
        },
      },
      snapshot() { return canonicalRandomWalkState(agents); },
      expectedState(totalFrames) { return traceExpectedRandomWalkState(trace, totalFrames); },
    };
  },
};

export default workload;
