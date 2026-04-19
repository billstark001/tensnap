import { BenchmarkCase, BenchmarkStats } from './types';

/** Yield one event-loop turn via requestAnimationFrame (browser paint boundary). */
function waitFrame(): Promise<DOMHighResTimeStamp> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

/**
 * Run a benchmark case for `frames` ticks.
 *
 * Protocol per tick:
 *   1. `tick(i)` — update data (computation)
 *   2. `requestAnimationFrame` — yield to browser to paint
 *   3. record compute time and wall-clock throughput
 *
 * The first `warmupFrames` frames are discarded.
 */
export async function runBenchmark(
  benchCase: BenchmarkCase,
  container: HTMLElement,
  frames = 200,
  warmupFrames = 10,
  onProgress?: (done: number, total: number) => void
): Promise<BenchmarkStats> {
  // --- setup ---
  await benchCase.setup(container);

  // --- warmup ---
  for (let i = 0; i < warmupFrames; i++) {
    benchCase.tick(i);
    await waitFrame();
    onProgress?.(0, frames); // still 0 real progress during warmup
  }

  // --- measured run ---
  const timings: number[] = [];
  const runStartedAt = performance.now();

  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    benchCase.tick(i);
    const computeElapsed = performance.now() - t0;
    timings.push(computeElapsed);
    await waitFrame();
    onProgress?.(i + 1, frames);
  }
  const runEndedAt = performance.now();
  const runDurationMs = Math.max(1, runEndedAt - runStartedAt);

  // --- teardown ---
  await benchCase.teardown();

  return computeStats(benchCase.name, benchCase.config, timings, runDurationMs);
}

function computeStats(
  caseName: string,
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

/** Serialise results as a Markdown table. */
export function resultsToMarkdown(results: BenchmarkStats[]): string {
  const date = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const header = `# TenSnap Web Core — Benchmark Results\n\n_Generated: ${date}_\n\n`;

  const tableHeader = [
    '| Case | Frames | Mean (ms) | Median (ms) | Min (ms) | Max (ms) | p95 (ms) | TPS |',
    '|------|-------:|----------:|------------:|---------:|---------:|---------:|----:|',
  ].join('\n');

  const rows = results
    .map(
      (r) =>
        `| ${r.caseName} | ${r.frames} | ${r.meanMs} | ${r.medianMs} | ${r.minMs} | ${r.maxMs} | ${r.p95Ms} | ${r.tps} |`
    )
    .join('\n');

  const configBlock =
    '\n\n## Configurations\n\n' +
    results
      .map(
        (r) =>
          `### ${r.caseName}\n\n\`\`\`json\n${JSON.stringify(r.config, null, 2)}\n\`\`\``
      )
      .join('\n\n');

  return header + tableHeader + '\n' + rows + configBlock;
}
