import { afterEach, describe, expect, it, vi } from 'vitest';
import { resultsToMarkdown, runBenchmark } from './runner';
import type { BenchmarkCase, BenchmarkStats } from './types';

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
