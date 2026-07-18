import { type AgentStorage } from '@tensnap/core/environment';
import type { BenchmarkWorkload } from '@tensnap/benchmark/harness';
import type { BrowserBenchmarkCase } from '@tensnap/benchmark/harness';
import { applyRandomWalkDelta, canonicalRandomWalkState, cloneRandomWalkAgents, createRandomWalkTrace, traceExpectedRandomWalkState } from '../../shared/random-walk';
import { createAgentScenario } from '../../shared/scenario';
import { resolveRendererComparisonConfig, type RendererComparisonConfig } from './config';

export const workload: BenchmarkWorkload<RendererComparisonConfig> = {
  schemaVersion: 2,
  id: 'comparison.random-walk.tensnap-renderer',
  version: 1,
  kind: 'browser',
  category: 'comparison',
  description: 'TenSnap Scenario, storage, React, and Leafer renderer for the same deterministic random-walk trace.',
  supportedSuites: ['browser'],
  resolveConfig: resolveRendererComparisonConfig,
  createBrowserCase({ config }): BrowserBenchmarkCase {
    const trace = createRandomWalkTrace(config, config.traceFrames);
    const agents = cloneRandomWalkAgents(trace.initial);
    return {
      case: {
        name: 'Random walk renderer comparison',
        category: 'tensnap',
        variant: 'tensnap-renderer',
        config,
        async mount(container) {
          const scenario = createAgentScenario(agents, config.worldSize);
          const environment = scenario.environments.get('main');
          if (!environment) throw new Error('Benchmark environment is missing.');
          const storage = environment.layers.get('agents')?.storage as AgentStorage | undefined;
          if (!storage) throw new Error('Benchmark agent storage is missing.');
          const { mountWebEnvironmentBenchmark } = await import('@tensnap/web/benchmark');
          const mounted = await mountWebEnvironmentBenchmark(container, {
            scenario,
            environmentId: 'main',
            display: '2d',
            width: config.width,
            height: config.height,
          });
          return {
            kind: 'component',
            tick(frameIndex) {
              const changed = trace.frames[frameIndex];
              if (!changed) throw new Error(`Renderer profile needs trace frame ${frameIndex}; increase traceFrames.`);
              applyRandomWalkDelta(agents, changed);
              storage.updateAgents(changed.map(({ id, x, y }) => ({ id, x, y })));
            },
            destroy: mounted.destroy,
          };
        },
      },
      snapshot() { return canonicalRandomWalkState(agents); },
      expectedState(totalFrames) { return traceExpectedRandomWalkState(trace, totalFrames); },
    };
  },
};

export default workload;
