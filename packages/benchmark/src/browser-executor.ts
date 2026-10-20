import type {
  RendererSessionOutboundDetail,
  RendererSessionMessageDetail,
  RunStatus,
  RuntimeTaskSnapshot,
} from '@tensnap/core/runtime';
import { BrowserRunRenderBarrier } from '@tensnap/core/runtime/browser';
import type { ActionInvokePayload, ActionResultPayload } from '@tensnap/protocol';
import { resolveBrowserBenchmarkRunOptions } from './browser-options';
import type {
  BenchmarkCase,
  BrowserBenchmarkRunOptions,
  BrowserBenchmarkStats,
  MountedComponentBenchmark,
  MountedModelBenchmark,
  ResolvedBrowserBenchmarkRunOptions,
  BrowserRunDiagnostics,
} from './browser-types';

interface TimingResult {
  diagnostics?: BrowserRunDiagnostics;
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
  options: ResolvedBrowserBenchmarkRunOptions,
): Promise<TimingResult> {
  const totalSteps = frames + warmupFrames;
  const timings: number[] = [];
  let dispatchIndex = 0;
  let activeDispatch: {
    index: number;
    startedAt: number;
    requestId: string;
    resultAppliedMs?: number;
  } | null = null;
  const diagnostics: BrowserRunDiagnostics | undefined = options.diagnostics
    ? { actions: [], rafTimestampsMs: [] }
    : undefined;
  return new Promise<TimingResult>((resolve, reject) => {
    let settled = false;
    let rafHandle: number | undefined;
    const observeRaf = (timestamp: number) => {
      diagnostics!.rafTimestampsMs.push(timestamp);
      rafHandle = requestAnimationFrame(observeRaf);
    };
    if (diagnostics) rafHandle = requestAnimationFrame(observeRaf);
    const cleanup = () => {
      if (rafHandle !== undefined) cancelAnimationFrame(rafHandle);
      if (diagnostics) mounted.session.removeEventListener('message', onMessage);
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
      if (activeDispatch.index >= warmupFrames)
        timings.push(completedAt - activeDispatch.startedAt);
      diagnostics?.actions.push({
        requestId: activeDispatch.requestId,
        dispatchMs: activeDispatch.startedAt,
        resultAppliedMs: activeDispatch.resultAppliedMs,
        completedMs: completedAt,
      });
      activeDispatch = null;
    };
    const onOutbound = ((event: Event) => {
      const detail = (event as CustomEvent<RendererSessionOutboundDetail>).detail;
      if (detail.message.type !== 'action_invoke') return;
      const payload = detail.message.payload as ActionInvokePayload;
      if (payload.id !== actionId) return;
      const now = performance.now();
      completeActiveCycle(now);
      activeDispatch = { index: dispatchIndex, startedAt: now, requestId: payload.request_id };
      dispatchIndex += 1;
    }) as EventListener;
    const onMessage = ((event: Event) => {
      const { message } = (event as CustomEvent<RendererSessionMessageDetail>).detail;
      if (
        message.type === 'action_result' &&
        activeDispatch &&
        activeDispatch.resultAppliedMs === undefined &&
        (message.payload as ActionResultPayload).id === actionId &&
        (message.payload as ActionResultPayload).request_id === activeDispatch.requestId
      ) {
        activeDispatch.resultAppliedMs = performance.now();
      }
    }) as EventListener;
    const onRunStatus = ((event: Event) => {
      const status = (event as CustomEvent<RunStatus | null>).detail;
      if (
        !status ||
        status.id !== mounted.session.run.status?.id ||
        status.state === 'running' ||
        status.inFlight
      )
        return;
      completeActiveCycle(performance.now());
      const completionMetric =
        options.renderTriggerMode === 'requestAnimationFrame'
          ? 'actionToRenderCompleteMs'
          : 'actionToRunCompletionMs';
      settle({
        ...(diagnostics ? { diagnostics } : {}),
        timings,
        // rAF is the comparable next-paint boundary. Timeout/auto are scheduler
        // completion modes and must not be labelled as visible-frame latency.
        stageTimings: { [completionMetric]: timings },
        completedFrames: status.completedSteps,
        stopReason: status.stopReason ?? status.state,
      });
    }) as EventListener;
    mounted.session.addEventListener('outbound', onOutbound);
    if (diagnostics) mounted.session.addEventListener('message', onMessage);
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
    const result =
      mounted.kind === 'model'
        ? await measureModelRun(
            mounted,
            benchCase.actionId ?? 'start',
            measuredFrames,
            warmupFrames,
            options,
          )
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
      ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
      ...(result.mutationTimings ? { mutationTimings: result.mutationTimings } : {}),
      ...(result.stageTimings ? { stageTimings: result.stageTimings } : {}),
      ...(mounted.kind === 'model' ? { snapshot: mounted.snapshot() } : {}),
      ...(mounted.kind === 'model' && mounted.validationPolicy
        ? { effectiveValidation: mounted.validationPolicy() }
        : {}),
    };
  } finally {
    mounted.destroy();
  }
}
