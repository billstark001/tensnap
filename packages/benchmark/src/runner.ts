import { BenchmarkCase, BenchmarkStats } from './types';

/** Yield one event-loop turn via requestAnimationFrame (browser paint boundary).
 *
 * Used for synthetic benchmark cases between ticks to measure paint-bound
 * throughput under realistic browser scheduling conditions.
 *
 * Web-scenario cases do NOT use this gate — they follow the web renderer's
 * own scheduling semantics instead.
 */
function waitFrame(): Promise<DOMHighResTimeStamp> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
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
  onProgress?: (done: number, total: number) => void
): Promise<BenchmarkStats> {
  await benchCase.setup(container);

  const isWebScenario = benchCase.suite === 'web-scenario';

  const totalFrames = warmupFrames + frames;
  const timings: number[] = [];
  let runStartedAt: number | null = null;
  let frameIndex = 0;

  try {
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

      // Synthetic cases: yield via rAF to let the browser paint between frames.
      // Web-scenario cases are driven by their own internal rendering pipeline.
      if (!isWebScenario) {
        await waitFrame();
      }

      if (isMeasuredFrame) {
        onProgress?.(frameIndex - warmupFrames + 1, frames);
      } else {
        onProgress?.(0, frames);
      }

      frameIndex += 1;
    }

    const runEndedAt = performance.now();
    const runDurationMs = runStartedAt == null
      ? 1
      : Math.max(1, runEndedAt - runStartedAt);

    return computeStats(benchCase.name, benchCase.suite, benchCase.config, timings, runDurationMs);
  } finally {
    await benchCase.teardown();
  }
}

function computeStats(
  caseName: string,
  suite: 'synthetic' | 'web-scenario',
  config: Record<string, unknown>,
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

/** Serialise results as a pretty-printed JSON string. */
export function resultsToJson(results: BenchmarkStats[]): string {
  return JSON.stringify(results, null, 2);
}

/** Serialise results as a Markdown table grouped by suite. */
export function resultsToMarkdown(results: BenchmarkStats[]): string {
  const date = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  let header = `# TenSnap Web Core — Benchmark Results\n\n_Generated: ${date}_\n\n`;

  const synthetic = results.filter((r) => r.suite === 'synthetic');
  const webScenario = results.filter((r) => r.suite === 'web-scenario');

  const tableHeader = [
    '| Suite | Case | Frames | Mean (ms) | Median (ms) | Min (ms) | Max (ms) | p95 (ms) | TPS |',
    '|-------|------|-------:|----------:|------------:|---------:|---------:|---------:|----:|',
  ].join('\n');

  function buildRows(rows: BenchmarkStats[]): string {
    return rows
      .map(
        (r) =>
          `| ${r.suite} | ${r.caseName} | ${r.frames} | ${r.meanMs} | ${r.medianMs} | ${r.minMs} | ${r.maxMs} | ${r.p95Ms} | ${r.tps} |`
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
          `### [${r.suite}] ${r.caseName}\n\n\`\`\`json\n${JSON.stringify(r.config, null, 2)}\n\`\`\``
      )
      .join('\n\n');

  return header + configBlock;
}