import type { RendererSessionOutboundDetail, RunStatus, RuntimeTaskSnapshot } from '@tensnap/core/runtime';
import { BrowserRunRenderBarrier } from '@tensnap/core/runtime/browser';
import type { ActionInvokePayload } from '@tensnap/protocol';
import type { RenderTriggerMode } from '@tensnap/web/store';
import type {
  BenchmarkCase,
  BenchmarkRunOptions,
  BenchmarkRuntimeMode,
  BenchmarkStats,
  MetricSummary,
  MountedComponentBenchmark,
  MountedModelBenchmark,
} from './types';

const DEFAULT_MAX_TPS = 300;
const DEFAULT_MAX_RENDER_FPS = 120;

interface TimingResult {
  timings: number[];
  mutationTimings?: number[];
  completedFrames: number;
  stopReason: string;
}

async function measureModelRun(
  mounted: MountedModelBenchmark,
  actionId: string,
  frames: number,
  warmupFrames: number,
  onProgress?: (done: number, total: number) => void,
): Promise<TimingResult> {
  const session = mounted.session;
  const totalSteps = frames + warmupFrames;
  const timings: number[] = [];
  let dispatchIndex = 0;
  let activeDispatch: { index: number; startedAt: number } | null = null;

  return new Promise<TimingResult>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      session.removeEventListener('outbound', onOutbound);
      session.removeEventListener('run:status', onRunStatus);
    };
    const settle = (result?: TimingResult, error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error !== undefined) reject(error);
      else resolve(result!);
    };
    const completeActiveCycle = (completedAt: number) => {
      if (!activeDispatch) return;
      if (activeDispatch.index >= warmupFrames) {
        timings.push(completedAt - activeDispatch.startedAt);
        onProgress?.(timings.length, frames);
      } else {
        onProgress?.(0, frames);
      }
      activeDispatch = null;
    };
    const onOutbound = ((event: Event) => {
      const detail = (event as CustomEvent<RendererSessionOutboundDetail>).detail;
      if (detail.message.type !== 'action_invoke') return;
      const payload = detail.message.payload as ActionInvokePayload;
      if (payload.id !== actionId) return;
      const now = performance.now();
      completeActiveCycle(now);
      activeDispatch = { index: dispatchIndex, startedAt: now };
      dispatchIndex += 1;
    }) as EventListener;
    const onRunStatus = ((event: Event) => {
      const status = (event as CustomEvent<RunStatus | null>).detail;
      if (!status || status.id !== session.run.status?.id || status.state === 'running' || status.inFlight) return;
      completeActiveCycle(performance.now());
      settle({
        timings,
        completedFrames: status.completedSteps,
        stopReason: status.stopReason ?? status.state,
      });
    }) as EventListener;

    session.addEventListener('outbound', onOutbound);
    session.addEventListener('run:status', onRunStatus);
    try {
      session.run.start({ mode: 'bounded', actionId, maxSteps: totalSteps, record: false });
    } catch (error) {
      settle(undefined, error);
    }
  });
}

async function measureComponentRun(
  mounted: MountedComponentBenchmark,
  frames: number,
  warmupFrames: number,
  options: { renderTriggerMode: RenderTriggerMode; maxTps: number; maxRenderFps: number },
  onProgress?: (done: number, total: number) => void,
): Promise<TimingResult> {
  const barrier = new BrowserRunRenderBarrier(() => ({
    mode: options.renderTriggerMode,
    maxTps: options.maxTps,
    maxRenderFps: options.maxRenderFps,
  }));
  const totalFrames = frames + warmupFrames;
  const timings: number[] = [];
  const mutationTimings: number[] = [];

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    const cycleStartedAt = performance.now();
    const mutationStartedAt = performance.now();
    await mounted.tick(frameIndex);
    const mutationElapsed = performance.now() - mutationStartedAt;
    const task: RuntimeTaskSnapshot = {
      id: `component-${frameIndex}`,
      key: 'component-render',
      continuous: true,
      stage: 'applied',
      enqueuedAt: cycleStartedAt,
      dispatchedAt: cycleStartedAt,
      completedAt: performance.now(),
      appliedAt: performance.now(),
      renderedAt: null,
      continueRequested: true,
    };
    await barrier.wait(task);
    if (frameIndex >= warmupFrames) {
      timings.push(performance.now() - cycleStartedAt);
      mutationTimings.push(mutationElapsed);
      onProgress?.(timings.length, frames);
    } else {
      onProgress?.(0, frames);
    }
  }

  return { timings, mutationTimings, completedFrames: totalFrames, stopReason: 'completed' };
}

export async function runBenchmark(
  benchCase: BenchmarkCase,
  container: HTMLElement,
  frames = 200,
  warmupFrames = 10,
  options: BenchmarkRunOptions = {},
): Promise<BenchmarkStats> {
  if (!Number.isInteger(frames) || frames < 1) throw new Error('frames must be a positive integer.');
  if (!Number.isInteger(warmupFrames) || warmupFrames < 0) throw new Error('warmupFrames must be a non-negative integer.');

  const renderTriggerMode = options.renderTriggerMode ?? 'auto';
  const maxTps = options.maxTps ?? DEFAULT_MAX_TPS;
  const maxRenderFps = options.maxRenderFps ?? DEFAULT_MAX_RENDER_FPS;
  const runtimeMode = options.runtimeMode ?? 'development';
  const mounted = await benchCase.mount(container, { renderTriggerMode, maxTps, maxRenderFps });

  try {
    const result = mounted.kind === 'model'
      ? await measureModelRun(mounted, benchCase.actionId ?? 'start', frames, warmupFrames, options.onProgress)
      : await measureComponentRun(mounted, frames, warmupFrames, { renderTriggerMode, maxTps, maxRenderFps }, options.onProgress);
    return computeStats(benchCase, renderTriggerMode, maxTps, maxRenderFps, runtimeMode, frames + warmupFrames, warmupFrames, result);
  } finally {
    mounted.destroy();
  }
}

function summarize(timings: number[]): MetricSummary {
  if (timings.length === 0) {
    return { totalMs: 0, meanMs: 0, medianMs: 0, minMs: 0, maxMs: 0, p95Ms: 0, tps: 0 };
  }
  const sorted = [...timings].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const round2 = (value: number) => Math.round(value * 100) / 100;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  return {
    totalMs: round2(total),
    meanMs: round2(total / sorted.length),
    medianMs: round2(median),
    minMs: round2(sorted[0]),
    maxMs: round2(sorted[sorted.length - 1]),
    p95Ms: round2(p95),
    tps: Math.round((sorted.length * 1000 / Math.max(0.001, total)) * 10) / 10,
  };
}

export function computeStats(
  benchCase: Pick<BenchmarkCase, 'name' | 'category' | 'variant' | 'config'>,
  renderTriggerMode: RenderTriggerMode,
  maxTps: number,
  maxRenderFps: number,
  runtimeMode: BenchmarkRuntimeMode,
  requestedFrames: number,
  warmupFrames: number,
  result: TimingResult,
): BenchmarkStats {
  const cycle = summarize(result.timings);
  const mutation = result.mutationTimings
    ? { ...summarize(result.mutationTimings), timings: result.mutationTimings.map((value) => Math.round(value * 100) / 100) }
    : undefined;
  return {
    ...cycle,
    caseName: benchCase.name,
    category: benchCase.category,
    variant: benchCase.variant,
    config: benchCase.config,
    host: 'tensnap-web',
    renderTriggerMode,
    maxTps,
    maxRenderFps,
    runtimeMode,
    requestedFrames,
    completedFrames: result.completedFrames,
    warmupFrames,
    measuredFrames: result.timings.length,
    stopReason: result.stopReason,
    timings: result.timings.map((value) => Math.round(value * 100) / 100),
    mutation,
  };
}

export function resultsToJson(results: BenchmarkStats[]): string {
  return JSON.stringify(results, null, 2);
}

export function resultsToMarkdown(results: BenchmarkStats[]): string {
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const tableHeader = '| Category | Variant | Trigger | Case | Completed / requested | Stop | Cycle mean | Cycle p95 | Cycle TPS | Mutation mean | Mutation p95 | vs raw |';
  const divider = '|---|---|---|---|---:|---|---:|---:|---:|---:|---:|---:|';
  const rows = results.map((result) => (
    `| ${result.category} | ${result.variant ?? '-'} | ${result.renderTriggerMode} | ${result.caseName} | ${result.completedFrames} / ${result.requestedFrames} | ${result.stopReason} | ${result.meanMs} | ${result.p95Ms} | ${result.tps} | ${result.mutation?.meanMs ?? '-'} | ${result.mutation?.p95Ms ?? '-'} | ${result.overheadVsRawPercent === undefined ? '-' : `${result.overheadVsRawPercent}%`} |`
  )).join('\n');
  const configurations = results.map((result) => (
    `### [${result.category}] ${result.caseName}${result.variant ? ` — ${result.variant}` : ''}\n\n\`\`\`json\n${JSON.stringify(result.config, null, 2)}\n\`\`\``
  )).join('\n\n');
  return `# TenSnap Web Benchmark\n\n_Generated: ${generatedAt}_\n\nCycle latency is shared by all suites. Component and direct-layer cases additionally report synchronous mutation cost. Model runs report their actual stop reason and completed steps.\n\n${tableHeader}\n${divider}\n${rows}\n\n## Configurations\n\n${configurations}`;
}
