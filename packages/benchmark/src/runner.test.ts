import { afterEach, describe, expect, it, vi } from 'vitest';
import { resultsToMarkdown, runBenchmark } from './runner';
import type { BenchmarkCase, BenchmarkStats } from './types';
import { assertBenchmarkRegressionGate } from './regression-gates';
import { createReactZustandCommitCase } from './cases/reactZustandCommit';

function createBenchCase(): BenchmarkCase {
  return {
    name: 'Test Case',
    suite: 'synthetic',
    config: { size: 'small' },
    setup() {
      return;
    },
    tick() {
      return;
    },
    teardown() {
      return;
    },
  };
}

describe('runBenchmark', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses requestAnimationFrame in auto mode when available', async () => {
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });

    const stats = await runBenchmark(
      createBenchCase(),
      document.createElement('div'),
      1,
      0,
      { schedulerMode: 'auto', runtimeMode: 'development' },
    );

    expect(rafSpy).toHaveBeenCalled();
    expect(stats.runnerMode).toBe('simple');
    expect(stats.schedulerMode).toBe('auto');
    expect(stats.runtimeMode).toBe('development');
  });

  it('uses setTimeout in timeout mode', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler) => {
      if (typeof callback === 'function') {
        callback();
      }
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);

    const stats = await runBenchmark(
      createBenchCase(),
      document.createElement('div'),
      1,
      0,
      { schedulerMode: 'timeout', runtimeMode: 'production' },
    );

    expect(timeoutSpy).toHaveBeenCalled();
    expect(stats.runnerMode).toBe('simple');
    expect(stats.schedulerMode).toBe('timeout');
    expect(stats.runtimeMode).toBe('production');
  });

  it('runs with the production RendererSession implementation', async () => {
    vi.useFakeTimers();

    let tickCount = 0;
    const statsPromise = runBenchmark(
      {
        ...createBenchCase(),
        tick() {
          tickCount += 1;
        },
      },
      document.createElement('div'),
      2,
      0,
      { runnerMode: 'renderer-session', schedulerMode: 'timeout', runtimeMode: 'development' },
    );

    await vi.runAllTimersAsync();
    const stats = await statsPromise;

    expect(tickCount).toBe(2);
    expect(stats.runnerMode).toBe('renderer-session');
    expect(stats.schedulerMode).toBe('timeout');
  });

  it('covers recording, long-history conditions, trajectory updates, and host commits in one shared session', async () => {
    vi.useFakeTimers();
    let commits = 0;
    let recordedFrames = 0;
    const statsPromise = runBenchmark(
      {
        ...createBenchCase(),
        runtime: {
          record: { maxSteps: 10, maxBytes: 1024 * 1024 },
          stopWhen: 'charts.history >= 3 && metadata.tick >= 3',
          setupSession(session) {
            session.handleIncoming({ type: 'chart_create', payload: { id: 'history', label: 'History' } });
            session.handleIncoming({ type: 'env_create', payload: { id: 'main', type: '2d' } });
            session.handleIncoming({ type: 'env_layer_create', payload: { env_id: 'main', layer_id: 'agents', layer_type: 'agent' } });
            session.handleIncoming({ type: 'env_layer_create', payload: {
              env_id: 'main', layer_id: 'trails', layer_type: 'trajectory', dependency_layer_ids: { agent: 'agents' },
            } });
            session.handleIncoming({ type: 'item_create', payload: { env_id: 'main', layer_id: 'agents', items: [{ id: 'a', x: 0, y: 0 }] } });
          },
          applySessionStep(session, frame) {
            session.handleIncoming({ type: 'metadata_update', payload: { tick: frame + 1 } });
            session.handleIncoming({ type: 'chart_update', payload: { updates: [{ id: 'history', time: frame + 1, value: frame + 1 }] } });
            session.handleIncoming({ type: 'item_update', payload: { env_id: 'main', layer_id: 'agents', items: [{ id: 'a', x: frame + 1, y: frame + 1 }] } });
            recordedFrames = session.recorder.current?.frames.length ?? 0;
          },
          onCommit() { commits += 1; },
        },
      },
      document.createElement('div'),
      3,
      0,
      { runnerMode: 'renderer-session', schedulerMode: 'timeout' },
    );

    await vi.runAllTimersAsync();
    const stats = await statsPromise;
    expect(stats.frames).toBe(3);
    expect(commits).toBeGreaterThan(3);
    expect(recordedFrames).toBeGreaterThan(0);
  });

  it('runs a real React/Zustand commit from RendererSession messages', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const statsPromise = runBenchmark(
      createReactZustandCommitCase(),
      container,
      2,
      0,
      { runnerMode: 'renderer-session', schedulerMode: 'timeout' },
    );

    await vi.runAllTimersAsync();
    const stats = await statsPromise;
    expect(stats.frames).toBe(2);
    expect(container.querySelector('[data-benchmark="zustand-react-commit"]')).toBeNull();
  });
});

describe('assertBenchmarkRegressionGate', () => {
  it('rejects a p95 regression or throughput below the configured floor', () => {
    expect(() => assertBenchmarkRegressionGate(
      { name: 'recording-off', maxP95RegressionPercent: 2, minTps: 100 },
      { p95Ms: 1, tps: 200 },
      { p95Ms: 1.03, tps: 99 },
    )).toThrow(/p95 regressed/);
    expect(() => assertBenchmarkRegressionGate(
      { name: 'recording-off', maxP95RegressionPercent: 5, minTps: 100 },
      { p95Ms: 1, tps: 200 },
      { p95Ms: 1.03, tps: 99 },
    )).toThrow(/throughput/);
  });
});

describe('resultsToMarkdown', () => {
  it('includes scheduler and runtime metadata in reports', () => {
    const markdown = resultsToMarkdown([
      {
        caseName: 'Test Case',
        suite: 'synthetic',
        config: { size: 'small' },
        runnerMode: 'renderer-session',
        schedulerMode: 'raf',
        runtimeMode: 'production',
        frames: 10,
        totalMs: 12,
        meanMs: 1.2,
        medianMs: 1.1,
        minMs: 1,
        maxMs: 1.5,
        p95Ms: 1.4,
        tps: 60,
        timings: [1, 1.1, 1.2],
      } satisfies BenchmarkStats,
    ]);

    expect(markdown).toContain('Runtime: production');
    expect(markdown).toContain('Runner: renderer-session');
    expect(markdown).toContain('| Suite | Runner | Scheduler | Runtime | Case |');
    expect(markdown).toContain('| synthetic | renderer-session | raf | production | Test Case |');
  });
});
