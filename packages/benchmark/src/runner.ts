import {
  BenchmarkCase,
  BenchmarkRunOptions,
  BenchmarkRuntimeMode,
  BenchmarkRunnerMode,
  BenchmarkSchedulerMode,
  BenchmarkStats,
} from './types';
import type {
  ProtocolEncoding,
  RendererToSimulatorMessage,
} from '@tensnap/protocol';
import type {
  ISimulatorTransport,
  TransportConnectionState,
  TransportEventHandler,
  TransportEventMap,
} from '@tensnap/core';
import { RendererSession } from '@tensnap/core/runtime';
import {
  BrowserRunRenderBarrier,
  type RenderTriggerMode,
} from '@tensnap/core/runtime/browser';

const DEFAULT_BROWSER_LOOP_MAX_TPS = 300;
const DEFAULT_BROWSER_LOOP_MAX_RENDER_FPS = 120;
const STEP_ACTION_ID = 'step';

type BenchmarkTimingResult = {
  timings: number[];
  runDurationMs: number;
};

/**
 * Yield one browser frame (or one macro task when rAF is unavailable).
 *
 * Even web-scenario cases need a frame boundary so renderer-side rAF work can
 * progress between ticks; otherwise long async loops may starve animation
 * callbacks and appear as a deadlock.
 */
function waitForRaf(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function waitForTimeout(): Promise<number> {
  return new Promise((resolve) => setTimeout(() => resolve(performance.now()), 0));
}

function waitFrame(mode: BenchmarkSchedulerMode): Promise<number> {
  if (mode === 'timeout') {
    return waitForTimeout();
  }

  if (mode === 'raf') {
    if (typeof requestAnimationFrame !== 'function') {
      return waitForTimeout();
    }
    return waitForRaf();
  }

  if (typeof requestAnimationFrame !== 'function') {
    return waitForTimeout();
  }
  return waitForRaf();
}

function mapSchedulerModeToRenderTriggerMode(mode: BenchmarkSchedulerMode): RenderTriggerMode {
  if (mode === 'raf') {
    return 'requestAnimationFrame';
  }
  if (mode === 'timeout') {
    return 'setTimeout';
  }
  return 'auto';
}

async function runBenchmarkWithSimpleLoop(
  benchCase: BenchmarkCase,
  frames: number,
  warmupFrames: number,
  schedulerMode: BenchmarkSchedulerMode,
  onProgress?: (done: number, total: number) => void,
): Promise<BenchmarkTimingResult> {
  const totalFrames = warmupFrames + frames;
  const timings: number[] = [];
  let runStartedAt: number | null = null;
  let frameIndex = 0;

  while (frameIndex < totalFrames) {
    const isMeasuredFrame = frameIndex >= warmupFrames;
    if (isMeasuredFrame && runStartedAt == null) {
      runStartedAt = performance.now();
    }

    const t0 = performance.now();
    await benchCase.tick(frameIndex);
    const computeElapsed = performance.now() - t0;
    if (isMeasuredFrame) {
      timings.push(computeElapsed);
    }

    await waitFrame(schedulerMode);

    if (isMeasuredFrame) {
      onProgress?.(frameIndex - warmupFrames + 1, frames);
    } else {
      onProgress?.(0, frames);
    }

    frameIndex += 1;
  }

  const runEndedAt = performance.now();
  return {
    timings,
    runDurationMs: runStartedAt == null
      ? 1
      : Math.max(1, runEndedAt - runStartedAt),
  };
}

function createBenchmarkTransport(
  send: (message: RendererToSimulatorMessage) => void,
): ISimulatorTransport {
  return {
    connectionId: 'benchmark://renderer-session',
    transportKind: 'benchmark',
    encoding: 'json' as ProtocolEncoding,
    connectionState: 'open' as TransportConnectionState,
    isConnected: true,
    connect: async () => {},
    disconnect: () => {},
    destroy: () => {},
    on: <K extends keyof TransportEventMap>(
      _type: K,
      _handler: TransportEventHandler<TransportEventMap[K]>,
    ) => {},
    off: <K extends keyof TransportEventMap>(
      _type: K,
      _handler?: TransportEventHandler<TransportEventMap[K]>,
    ) => {},
    send,
  };
}

async function runBenchmarkWithRendererSession(
  benchCase: BenchmarkCase,
  frames: number,
  warmupFrames: number,
  schedulerMode: BenchmarkSchedulerMode,
  onProgress?: (done: number, total: number) => void,
): Promise<BenchmarkTimingResult> {
  const totalFrames = warmupFrames + frames;
  const timings: number[] = [];
  const renderBarrier = new BrowserRunRenderBarrier(() => ({
    mode: mapSchedulerModeToRenderTriggerMode(schedulerMode),
    maxTps: DEFAULT_BROWSER_LOOP_MAX_TPS,
    maxRenderFps: DEFAULT_BROWSER_LOOP_MAX_RENDER_FPS,
  }));
  const session = new RendererSession({ run: { renderBarrier } });

  let frameIndex = 0;
  let runStartedAt: number | null = null;
  let runEndedAt: number | null = null;
  let settled = false;

  try {
    const completion = await new Promise<BenchmarkTimingResult>((resolve, reject) => {
      const settle = (result?: BenchmarkTimingResult, error?: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve(result ?? {
          timings,
          runDurationMs: runStartedAt == null || runEndedAt == null
            ? 1
            : Math.max(1, runEndedAt - runStartedAt),
        });
      };

      const finalize = () => {
        runEndedAt = performance.now();
        settle();
      };

      session.attachTransport(createBenchmarkTransport((message) => {
        void (async () => {
          if (settled || message.type !== 'action_start') {
            return;
          }

          const currentFrame = frameIndex;
          if (currentFrame >= totalFrames) {
            return;
          }

          const isMeasuredFrame = currentFrame >= warmupFrames;
          if (isMeasuredFrame && runStartedAt == null) {
            runStartedAt = performance.now();
          }

          const t0 = performance.now();
          try {
            await benchCase.tick(currentFrame);
          } catch (error) {
            settle(undefined, error);
            return;
          }

          const computeElapsed = performance.now() - t0;
          if (isMeasuredFrame) {
            timings.push(computeElapsed);
          }

          frameIndex += 1;
          if (isMeasuredFrame) {
            onProgress?.(frameIndex - warmupFrames, frames);
          } else {
            onProgress?.(0, frames);
          }

          const payload = message.payload as { id: string; tick_id?: string };
          const shouldContinue = frameIndex < totalFrames;

          session.handleIncoming({
            type: 'action_end',
            payload: {
              id: payload.id,
              tick_id: payload.tick_id,
              continue: shouldContinue,
            },
          });

          if (!shouldContinue) {
            if (typeof queueMicrotask === 'function') {
              queueMicrotask(finalize);
            } else {
              window.setTimeout(finalize, 0);
            }
          }
        })();
      }));

      session.run.start({ actionId: STEP_ACTION_ID, maxSteps: totalFrames });
    });

    return completion;
  } finally {
    session.destroy();
  }
}

/**
 * Run a benchmark case for `frames` ticks.
 *
 * Per-tick protocol:
 *   1. `tick(frameIndex)` — update data/model
 *   2. For synthetic cases only: `requestAnimationFrame` — yield to browser to paint
 *   3. Record compute time and wall-clock throughput
 *
 * The first `warmupFrames` frames are discarded from timing.
 */
export async function runBenchmark(
  benchCase: BenchmarkCase,
  container: HTMLElement,
  frames = 200,
  warmupFrames = 10,
  options: BenchmarkRunOptions = {},
): Promise<BenchmarkStats> {
  const schedulerMode = options.schedulerMode ?? 'auto';
  const runtimeMode = options.runtimeMode ?? 'development';
  const runnerMode = options.runnerMode ?? 'simple';

  await benchCase.setup(container);

  try {
    const { timings, runDurationMs } = runnerMode === 'renderer-session'
      ? await runBenchmarkWithRendererSession(
        benchCase,
        frames,
        warmupFrames,
        schedulerMode,
        options.onProgress,
      )
      : await runBenchmarkWithSimpleLoop(
        benchCase,
        frames,
        warmupFrames,
        schedulerMode,
        options.onProgress,
      );

    return computeStats(
      benchCase.name,
      benchCase.suite,
      benchCase.config,
      runnerMode,
      schedulerMode,
      runtimeMode,
      timings,
      runDurationMs,
    );
  } finally {
    await benchCase.teardown();
  }
}

function computeStats(
  caseName: string,
  suite: 'synthetic' | 'web-scenario',
  config: Record<string, unknown>,
  runnerMode: BenchmarkRunnerMode,
  schedulerMode: BenchmarkSchedulerMode,
  runtimeMode: BenchmarkRuntimeMode,
  timings: number[],
  runDurationMs: number,
): BenchmarkStats {
  const sorted = [...timings].sort((a, b) => a - b);
  const n = sorted.length;
  const total = sorted.reduce((s, v) => s + v, 0);
  const mean = total / n;
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];
  const p95 = sorted[Math.floor(n * 0.95)];
  const min = sorted[0];
  const max = sorted[n - 1];
  const tps = (n * 1000) / runDurationMs;

  return {
    caseName,
    suite,
    config,
    runnerMode,
    schedulerMode,
    runtimeMode,
    frames: n,
    totalMs: Math.round(total * 100) / 100,
    meanMs: Math.round(mean * 100) / 100,
    medianMs: Math.round(median * 100) / 100,
    minMs: Math.round(min * 100) / 100,
    maxMs: Math.round(max * 100) / 100,
    p95Ms: Math.round(p95 * 100) / 100,
    tps: Math.round(tps * 10) / 10,
    timings: timings.map((v) => Math.round(v * 100) / 100),
  };
}

/** Serialize results as a pretty-printed JSON string. */
export function resultsToJson(results: BenchmarkStats[]): string {
  return JSON.stringify(results, null, 2);
}

/** Serialize results as a Markdown table grouped by suite. */
export function resultsToMarkdown(results: BenchmarkStats[]): string {
  const date = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const runtimeModes = Array.from(new Set(results.map((result) => result.runtimeMode)));
  const runtimeLabel = runtimeModes.length === 1 ? runtimeModes[0] : runtimeModes.join(', ');
  const runnerModes = Array.from(new Set(results.map((result) => result.runnerMode)));
  const runnerLabel = runnerModes.length === 1 ? runnerModes[0] : runnerModes.join(', ');
  let header = `# TenSnap Web Core — Benchmark Results\n\n_Generated: ${date}_\n\n_Runtime: ${runtimeLabel}_\n\n_Runner: ${runnerLabel}_\n\n`;

  const synthetic = results.filter((r) => r.suite === 'synthetic');
  const webScenario = results.filter((r) => r.suite === 'web-scenario');

  const tableHeader = [
    '| Suite | Runner | Scheduler | Runtime | Case | Frames | Mean (ms) | Median (ms) | Min (ms) | Max (ms) | p95 (ms) | TPS |',
    '|-------|--------|-----------|---------|------|-------:|----------:|------------:|---------:|---------:|---------:|----:|',
  ].join('\n');

  function buildRows(rows: BenchmarkStats[]): string {
    return rows
      .map(
        (r) =>
          `| ${r.suite} | ${r.runnerMode} | ${r.schedulerMode} | ${r.runtimeMode} | ${r.caseName} | ${r.frames} | ${r.meanMs} | ${r.medianMs} | ${r.minMs} | ${r.maxMs} | ${r.p95Ms} | ${r.tps} |`
      )
      .join('\n');
  }

  if (synthetic.length > 0) {
    header += '\n## Synthetic Suite\n\n';
    header += tableHeader + '\n' + buildRows(synthetic) + '\n';
  }

  if (webScenario.length > 0) {
    header += '\n## Web-Scenario Suite\n\n';
    header += tableHeader + '\n' + buildRows(webScenario) + '\n';
  }

  const configBlock =
    '\n## Configurations\n\n' +
    results
      .map(
        (r) =>
          `### [${r.suite}] ${r.caseName} (${r.runnerMode}, ${r.schedulerMode}, ${r.runtimeMode})\n\n\`\`\`json\n${JSON.stringify(r.config, null, 2)}\n\`\`\``
      )
      .join('\n\n');

  return header + configBlock;
}
