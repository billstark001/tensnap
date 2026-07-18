import type { RendererSessionOutboundDetail, RunStatus, RuntimeTaskSnapshot } from '@tensnap/core/runtime';
import { BrowserRunRenderBarrier } from '@tensnap/core/runtime/browser';
import type { ActionInvokePayload } from '@tensnap/protocol';
import { resolveBrowserBenchmarkRunOptions } from './browser-options';
import type {
  BenchmarkCase,
  BrowserBenchmarkRunOptions,
  BrowserBenchmarkStats,
  MountedComponentBenchmark,
  MountedModelBenchmark,
  ResolvedBrowserBenchmarkRunOptions,
} from './browser-types';

interface TimingResult {
  timings: number[];
  mutationTimings?: number[];
  stageTimings?: Record<string, number[]>;
  completedFrames: number;
  stopReason: string;
}

async function measureModelRun(
  mounted: MountedModelBenchmark,
  actionId: string,
  frames: number,
  warmupFrames: number,
): Promise<TimingResult> {
  const totalSteps = frames + warmupFrames;
  const timings: number[] = [];
  let dispatchIndex = 0;
  let activeDispatch: { index: number; startedAt: number } | null = null;
  return new Promise<TimingResult>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      mounted.session.removeEventListener('outbound', onOutbound);
      mounted.session.removeEventListener('run:status', onRunStatus);
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
      if (activeDispatch.index >= warmupFrames) timings.push(completedAt - activeDispatch.startedAt);
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
      if (!status || status.id !== mounted.session.run.status?.id || status.state === 'running' || status.inFlight) return;
      completeActiveCycle(performance.now());
      settle({
        timings,
        stageTimings: { actionToRunCompletionMs: timings },
        completedFrames: status.completedSteps,
        stopReason: status.stopReason ?? status.state,
      });
    }) as EventListener;
    mounted.session.addEventListener('outbound', onOutbound);
    mounted.session.addEventListener('run:status', onRunStatus);
    try {
      mounted.session.run.start({ mode: 'bounded', actionId, maxSteps: totalSteps, record: false });
    } catch (error) {
      settle(undefined, error);
    }
  });
}

async function measureComponentRun(
  mounted: MountedComponentBenchmark,
  frames: number,
  warmupFrames: number,
  options: ResolvedBrowserBenchmarkRunOptions,
): Promise<TimingResult> {
  const barrier = new BrowserRunRenderBarrier(() => ({
    mode: options.renderTriggerMode,
    maxTps: options.maxTps,
    maxRenderFps: options.maxRenderFps,
  }));
  const timings: number[] = [];
  const mutationTimings: number[] = [];
  const totalFrames = frames + warmupFrames;
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    const startedAt = performance.now();
    const mutationStartedAt = performance.now();
    await mounted.tick(frameIndex);
    const mutationElapsed = performance.now() - mutationStartedAt;
    const task: RuntimeTaskSnapshot = {
      id: `browser-component-${frameIndex}`,
      key: 'benchmark-render',
      continuous: true,
      stage: 'applied',
      enqueuedAt: startedAt,
      dispatchedAt: startedAt,
      completedAt: performance.now(),
      appliedAt: performance.now(),
      renderedAt: null,
      continueRequested: true,
    };
    await barrier.wait(task);
    if (frameIndex >= warmupFrames) {
      timings.push(performance.now() - startedAt);
      mutationTimings.push(mutationElapsed);
    }
  }
  return {
    timings,
    mutationTimings,
    stageTimings: { rendererMutationMs: mutationTimings, actionToFrameMs: timings },
    completedFrames: totalFrames,
    stopReason: 'completed',
  };
}

/** Execute a single browser workload through the production render path. */
export async function runBrowserBenchmark(
  benchCase: BenchmarkCase,
  container: HTMLElement,
  measuredFrames: number,
  warmupFrames: number,
  browserOptions?: BrowserBenchmarkRunOptions,
): Promise<BrowserBenchmarkStats> {
  const options = resolveBrowserBenchmarkRunOptions(browserOptions);
  const mounted = await benchCase.mount(container, options);
  try {
    const result = mounted.kind === 'model'
      ? await measureModelRun(mounted, benchCase.actionId ?? 'start', measuredFrames, warmupFrames)
      : await measureComponentRun(mounted, measuredFrames, warmupFrames, options);
    return {
      caseName: benchCase.name,
      category: benchCase.category,
      variant: benchCase.variant,
      config: benchCase.config,
      runtimeMode: 'production',
      completedFrames: result.completedFrames,
      measuredFrames: result.timings.length,
      stopReason: result.stopReason,
      timings: result.timings,
      ...(result.mutationTimings ? { mutationTimings: result.mutationTimings } : {}),
      ...(result.stageTimings ? { stageTimings: result.stageTimings } : {}),
    };
  } finally {
    mounted.destroy();
  }
}
