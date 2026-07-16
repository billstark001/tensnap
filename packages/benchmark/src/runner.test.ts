import { describe, expect, it, vi } from 'vitest';
import type { RendererSession, RendererSessionOutboundDetail, RunStatus } from '@tensnap/core/runtime';
import type { BenchmarkCase } from './types';
import { assertBenchmarkRegressionGate } from './regression-gates';
import { computeStats, resultsToMarkdown, runBenchmark } from './runner';

function createFakeModelCase(options: { stopReason?: RunStatus['stopReason']; stopAt?: number } = {}) {
  const destroy = vi.fn();
  const benchCase: BenchmarkCase = {
    name: 'Production path test', category: 'model', config: { model: 'test' }, actionId: 'start',
    async mount() {
      const events = new EventTarget();
      let currentStatus: RunStatus | null = null;
      const run = {
        get status() { return currentStatus; },
        start(spec: { actionId: string; maxSteps: number }) {
          const completedSteps = Math.min(options.stopAt ?? spec.maxSteps, spec.maxSteps);
          currentStatus = { id: 'run-1', spec: { mode: 'bounded', actionId: spec.actionId, maxSteps: spec.maxSteps }, state: 'running', completedSteps: 0, startedAt: 0, pauseRequested: false, inFlight: true };
          for (let index = 0; index < completedSteps; index += 1) {
            events.dispatchEvent(new CustomEvent<RendererSessionOutboundDetail>('outbound', { detail: {
              origin: 'optimistic-control', message: { type: 'action_invoke', payload: { id: spec.actionId, request_id: `request-${index}` } },
            } }));
          }
          currentStatus = { ...currentStatus, state: 'stopped', completedSteps, stopReason: options.stopReason ?? 'max-steps', inFlight: false };
          events.dispatchEvent(new CustomEvent('run:status', { detail: currentStatus }));
          return currentStatus;
        },
      };
      Object.defineProperty(events, 'run', { value: run });
      return { kind: 'model' as const, session: events as unknown as RendererSession, destroy };
    },
  };
  return { benchCase, destroy };
}

describe('runBenchmark', () => {
  it('measures action cycles from the production session boundary and discards warmup', async () => {
    const { benchCase, destroy } = createFakeModelCase();
    const stats = await runBenchmark(benchCase, document.createElement('div'), 3, 2, {
      renderTriggerMode: 'requestAnimationFrame', maxTps: 60, maxRenderFps: 60,
    });
    expect(stats).toMatchObject({
      category: 'model', host: 'tensnap-web', requestedFrames: 5,
      completedFrames: 5, measuredFrames: 3, stopReason: 'max-steps',
    });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('returns partial metrics when the simulator stops early', async () => {
    const { benchCase, destroy } = createFakeModelCase({ stopReason: 'simulator', stopAt: 93 });
    const stats = await runBenchmark(benchCase, document.createElement('div'), 100, 10);
    expect(stats).toMatchObject({
      requestedFrames: 110, completedFrames: 93, measuredFrames: 83, stopReason: 'simulator',
    });
    expect(destroy).toHaveBeenCalledOnce();
  });
});

describe('reports and regression gates', () => {
  it('reports shared cycle and component mutation metrics', () => {
    const stats = computeStats(
      { name: 'Case', category: 'component', config: {} },
      'setTimeout', 300, 120, 'production', 4, 1,
      { timings: [2, 4, 3], mutationTimings: [0.5, 0.7, 0.6], completedFrames: 4, stopReason: 'completed' },
    );
    const markdown = resultsToMarkdown([stats]);
    expect(stats.mutation).toMatchObject({ meanMs: 0.6, p95Ms: 0.7 });
    expect(markdown).toContain('| component | - | setTimeout | Case | 4 / 4 | completed |');
  });

  it('rejects p95 and throughput regressions', () => {
    expect(() => assertBenchmarkRegressionGate(
      { name: 'web-e2e', maxP95RegressionPercent: 2, minTps: 100 },
      { p95Ms: 1, tps: 200 }, { p95Ms: 1.03, tps: 99 },
    )).toThrow(/p95 regressed/);
  });
});
