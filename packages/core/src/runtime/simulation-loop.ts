/**
 * runtime/simulation-loop.ts
 *
 * Browser-only implementation: SimulationLoopController and related types.
 * Re-exported via `@tensnap/core/runtime/browser`.
 */

import { PipelineRuntime } from './PipelineRuntime';
import type { RuntimeTaskSnapshot } from './PipelineRuntime';
import type { ActionEndPayload, RendererToSimulatorMessage } from '../protocol';

// Hot-path runtime helpers are intentionally consumed here so continuous runs
// do not allocate cloned command/task snapshots every tick.

// #region Constants

const DEFAULT_MAX_TPS = 300;
const DEFAULT_MAX_RENDER_FPS = 120;
const METRIC_WINDOW_MS = 1000;
const METRIC_EMIT_INTERVAL_MS = 250;
const RAF_CALIBRATION_SAMPLE_COUNT = 6;
const RAF_ESTIMATE_MAX_AGE_MS = 2000;
const RAF_OBSERVATION_MAX_INTERVAL_MS = 250;
const RAF_SELECTION_EPSILON_MS = 0.5;

// #endregion Constants

// #region Types

export type RenderTriggerMode = 'auto' | 'setTimeout' | 'requestAnimationFrame';

export type StateSyncPhase = 'idle' | 'requested' | 'receiving';

export interface StateSyncStatus {
  requestId: string | null;
  phase: StateSyncPhase;
}

export type ActionStartFactory = (
  id: string,
  continuous?: boolean,
  tickId?: string,
) => RendererToSimulatorMessage;

export type MessageSender = (message: RendererToSimulatorMessage) => void;
export type ActionEventSource = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

type DispatchTimingState = {
  lastDispatchAt: number;
  completedCount: number;
};

export type RuntimeMetrics = {
  tps: number | null;
  mspt: number | null;
};

export type SimulationLoopState = {
  runningActions: ReadonlySet<string>;
};

type LoopOptions = {
  sendMessage?: MessageSender;
  createActionStartMessage?: ActionStartFactory;
  mode: RenderTriggerMode;
  maxTps: number;
  maxRenderFps: number;
  onMetricsChange?: (metrics: RuntimeMetrics) => void;
};

type TriggerFiredCallback = (task: RuntimeTaskSnapshot, now: number) => void;

// #endregion Types

// #region RafEstimator

/**
 * Tracks the display's rAF cadence via passive interval observation and,
 * when necessary, an active background calibration pass.
 *
 * Passive observation is driven for free by the DispatchTrigger's rAF loop
 * whenever a continuous action is running, so dedicated calibration is only
 * needed during the cold-start period before the first action fires.
 */
class RafEstimator {
  private ms: number | null = null;
  private updatedAt = 0;
  private calibrationId: number | null = null;
  private calibrationLastTs: number | null = null;
  private calibrationSamplesLeft = 0;

  get estimate(): number | null { return this.ms; }
  get estimateUpdatedAt(): number { return this.updatedAt; }

  isStale(now: number): boolean {
    return this.ms === null || now - this.updatedAt > RAF_ESTIMATE_MAX_AGE_MS;
  }

  /** Incorporate one observed rAF interval into the smoothed estimate. */
  observe(intervalMs: number, now: number): void {
    if (
      !Number.isFinite(intervalMs) ||
      intervalMs <= 0 ||
      intervalMs > RAF_OBSERVATION_MAX_INTERVAL_MS
    ) {
      return;
    }
    // Reject extreme outliers (e.g. tab switch, debugger pause) that would
    // corrupt the smoothed estimate for a long time.
    if (this.ms !== null && Math.abs(intervalMs - this.ms) > 50) {
      return;
    }
    this.ms = this.ms === null
      ? intervalMs
      : (this.ms * 3 + intervalMs) / 4;
    this.updatedAt = now;
  }

  /**
   * Start a background calibration pass when the estimate is absent or stale
   * and no pass is already running. `isActive` is queried each frame so the
   * pass can abort early (e.g. when there is nothing left to calibrate for).
   */
  ensureCalibration(now: number, isActive: () => boolean): void {
    if (typeof window.requestAnimationFrame !== 'function') return;
    if (this.calibrationId !== null) return;
    if (!this.isStale(now)) return;

    this.calibrationLastTs = null;
    this.calibrationSamplesLeft = RAF_CALIBRATION_SAMPLE_COUNT;

    const tick = (ts: number): void => {
      if (this.calibrationLastTs !== null) {
        this.observe(ts - this.calibrationLastTs, ts);
        this.calibrationSamplesLeft -= 1;
      }
      this.calibrationLastTs = ts;

      if (this.calibrationSamplesLeft <= 0 || !isActive()) {
        this.calibrationId = null;
        this.calibrationLastTs = null;
        this.calibrationSamplesLeft = 0;
        return;
      }
      this.calibrationId = window.requestAnimationFrame(tick);
    };

    this.calibrationId = window.requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.calibrationId !== null) {
      window.cancelAnimationFrame(this.calibrationId);
      this.calibrationId = null;
    }
    this.calibrationLastTs = null;
    this.calibrationSamplesLeft = 0;
  }

  reset(): void {
    this.stop();
    this.ms = null;
    this.updatedAt = 0;
  }
}

// #endregion RafEstimator

// #region DispatchTrigger

/**
 * Manages one pending dispatch, arming it via `setTimeout` or
 * `requestAnimationFrame`. Also passively observes rAF intervals during its
 * own loop so the DispatchTrigger contributes to RafEstimator for free.
 *
 * Intended lifecycle:
 *   setPending(task) → arm(dueAt, mode) → [onFired fires] → caller calls clear()
 *
 * `disarm()` and `clear()` may be called at any point to cancel.
 */
class DispatchTrigger {
  onFired: TriggerFiredCallback = () => { };

  private pending: RuntimeTaskSnapshot | null = null;
  private timeoutId: number | null = null;
  private rafId: number | null = null;
  private lastObservedRafTs: number | null = null;

  constructor(
    private readonly rafEstimator: RafEstimator,
    private readonly now: () => number = () => performance.now(),
  ) { }

  get hasPending(): boolean { return this.pending !== null; }
  get pendingTask(): RuntimeTaskSnapshot | null { return this.pending; }

  /**
   * Replace the current pending task and clear any live handles.
   * Must be followed by `arm()` (or `schedulePendingDispatch()` in the
   * controller) to actually start the timer.
   */
  setPending(task: RuntimeTaskSnapshot): void {
    this.clearHandles();
    this.pending = task;
  }

  /**
   * Arm the timer for the current pending task.
   * Safe to call when already armed — clears the previous handle first.
   */
  arm(dueAt: number, mode: Exclude<RenderTriggerMode, 'auto'>): void {
    if (!this.pending) return;
    this.clearHandles();
    if (mode === 'requestAnimationFrame') {
      this.armRaf(dueAt);
    } else {
      this.armTimeout(dueAt);
    }
  }

  /** Cancel live handles, retaining the pending task for future rescheduling. */
  disarm(): void {
    this.clearHandles();
  }

  /** Cancel live handles and drop the pending task entirely. */
  clear(): void {
    this.clearHandles();
    this.pending = null;
    this.lastObservedRafTs = null;
  }

  reset(): void {
    this.clear();
  }

  private armTimeout(dueAt: number): void {
    const delayMs = Math.max(1, dueAt - this.now());
    this.timeoutId = window.setTimeout(() => {
      const task = this.pending;
      if (!task) return;
      this.timeoutId = null;
      this.onFired(task, this.now());
    }, delayMs);
  }

  private armRaf(dueAt: number): void {
    const tick = (now: number): void => {
      // Immediately clear our own handle so that:
      // 1. Any concurrent arm() call sees rafId = null (clearHandles already sets
      //    it, but this is a safety net for stale-handle timing in real browsers).
      // 2. The re-queue at the bottom always starts from a clean state.
      this.rafId = null;

      const task = this.pending;
      if (!task) {
        this.lastObservedRafTs = null;
        return;
      }

      // Passive interval observation — contributes to the rAF estimate for free
      // while a continuous action is in flight, without a dedicated calibration loop.
      if (this.lastObservedRafTs !== null) {
        this.rafEstimator.observe(now - this.lastObservedRafTs, now);
      }
      this.lastObservedRafTs = now;

      if (now >= dueAt) {
        this.onFired(task, now);
        return;
      }
      this.rafId = window.requestAnimationFrame(tick);
    };

    this.rafId = window.requestAnimationFrame(tick);
  }

  private clearHandles(): void {
    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}

// #endregion DispatchTrigger

// #region Module Helpers

export const createIdleLoopState = (): SimulationLoopState => ({
  runningActions: new Set(),
});

const createIdleStateSyncStatus = (): StateSyncStatus => ({
  requestId: null,
  phase: 'idle',
});

// #endregion Module Helpers

// #region SimulationLoopController

const defaultNow = () => performance.now();

export class SimulationLoopController {

  // #region Fields

  private readonly runtime = new PipelineRuntime();
  private readonly subscribers = new Set<() => void>();
  private readonly dispatchTimingByKey = new Map<string, DispatchTimingState>();
  private readonly frameTimestamps: number[] = [];
  private readonly frameDurations: Array<{ timestamp: number; durationMs: number }> = [];
  private readonly rafEstimator = new RafEstimator();
  private readonly trigger: DispatchTrigger;

  private readonly handleScenarioActionEnd = (event: Event): void => {
    this.handleActionEnd((event as CustomEvent<ActionEndPayload>).detail);
  };

  private subscriptions = 0;
  private options: LoopOptions = {
    mode: 'auto',
    maxTps: DEFAULT_MAX_TPS,
    maxRenderFps: DEFAULT_MAX_RENDER_FPS,
  };
  private stateSync = createIdleStateSyncStatus();
  private renderCommitTimeoutId: number | null = null;
  private renderCommitTaskId: string | null = null;
  private lastMetricsEmitAt = 0;

  /**
   * Running sum of all `durationMs` values currently live in `frameDurations`.
   * Maintained incrementally in markFrame/trimSamples so that the mspt
   * calculation is O(1) instead of performing a full array reduce on every emit.
   */
  private frameDurationSum = 0;

  /**
   * Cached result of `!!(sendMessage && createActionStartMessage)`.
   * Recomputed only when options change so the hot-path check is a single
   * boolean read rather than two optional-chaining dereferences.
   */
  private dispatchReady = false;

  // #endregion Fields

  constructor(
    private readonly scenario: ActionEventSource,
    private readonly now: () => number = defaultNow,
  ) {
    this.trigger = new DispatchTrigger(this.rafEstimator, this.now);
    this.trigger.onFired = (task, now) => this.dispatchActionStart(task, now);
  }

  // #region Lifecycle

  retain(): () => void {
    this.subscriptions += 1;
    if (this.subscriptions === 1) {
      this.scenario.addEventListener('action:end', this.handleScenarioActionEnd);
    }
    return () => { this.release(); };
  }

  dispose(): void {
    this.subscriptions = 1;
    this.release();
  }

  reset(): void {
    this.resetControllerState();
  }

  private release(): void {
    if (this.subscriptions === 0) return;

    this.subscriptions -= 1;
    if (this.subscriptions > 0) return;

    this.scenario.removeEventListener('action:end', this.handleScenarioActionEnd);
    this.resetControllerState();
  }

  private resetControllerState(): void {
    this.trigger.reset();
    this.clearRenderCommit();
    this.runtime.reset();
    this.dispatchTimingByKey.clear();
    this.stateSync = createIdleStateSyncStatus();
    this.rafEstimator.reset();
    this.frameTimestamps.length = 0;
    this.frameDurations.length = 0;
    this.frameDurationSum = 0;
    this.lastMetricsEmitAt = 0;
    this.emitMetrics({ tps: null, mspt: null });
    this.emit();
  }

  // #endregion Lifecycle

  // #region Public API

  updateOptions(options: Partial<LoopOptions>): void {
    const previousMode = this.options.mode;
    const previousMaxTps = this.options.maxTps;
    const previousMaxRenderFps = this.options.maxRenderFps;

    this.options = {
      ...this.options,
      ...options,
      maxTps: this.normalizeMaxTps(options.maxTps ?? this.options.maxTps),
      maxRenderFps: this.normalizeMaxRenderFps(options.maxRenderFps ?? this.options.maxRenderFps),
    };
    // Recompute once here rather than on every canDispatch() / flushCommands() call.
    this.dispatchReady = !!(this.options.sendMessage && this.options.createActionStartMessage);

    if (
      this.trigger.hasPending &&
      (
        previousMode !== this.options.mode ||
        previousMaxTps !== this.options.maxTps ||
        previousMaxRenderFps !== this.options.maxRenderFps
      )
    ) {
      this.trigger.disarm();
      this.schedulePendingDispatch();
    }

    this.emitMetricsIfNeeded(true);
  }

  syncStateSync(status: StateSyncStatus): void {
    const previous = this.stateSync;
    if (previous.requestId === status.requestId && previous.phase === status.phase) {
      return;
    }

    this.stateSync = { requestId: status.requestId, phase: status.phase };

    if (status.phase === 'requested' && status.requestId) {
      this.runtime.requestStateSync(status.requestId);
      this.trigger.disarm();
    } else if (status.phase === 'receiving') {
      const requestId = status.requestId ?? previous.requestId ?? undefined;
      if (requestId && previous.requestId !== requestId) {
        this.runtime.requestStateSync(requestId);
      }
      this.runtime.recordStateSyncBoundary('begin', { request_id: requestId });
      this.trigger.disarm();
    } else if (status.phase === 'idle' && previous.phase !== 'idle') {
      this.runtime.recordStateSyncBoundary('end', { request_id: previous.requestId ?? undefined });
      this.schedulePendingDispatch();
      this.flushCommands();
    }
  }

  canDispatch(): boolean {
    return this.dispatchReady;
  }

  isRunning(actionId: string): boolean {
    return this.runtime.hasContinuousKey(actionId);
  }

  requestAction(actionId: string, continuous = false): void {
    if (continuous && this.isRunning(actionId)) {
      this.cancel(actionId);
      return;
    }
    if (!continuous) {
      this.cancel();
    }
    this.runtime.enqueue(actionId, { continuous });
    this.flushCommands();
    this.emit();
  }

  cancel(actionId?: string): void {
    if (actionId !== undefined) {
      this.runtime.cancel(actionId);
      this.dispatchTimingByKey.delete(actionId);
      this.discardScheduledDispatch(actionId);
      this.emit();
      this.emitMetricsIfNeeded(true);
      return;
    }

    this.runtime.cancel();
    this.dispatchTimingByKey.clear();
    this.discardScheduledDispatch();
    this.emit();
    this.emitMetrics({ tps: null, mspt: null });
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => { this.subscribers.delete(listener); };
  }

  getState(): SimulationLoopState {
    return {
      runningActions: new Set(this.runtime.getContinuousKeys()),
    };
  }

  // #endregion Public API

  // #region Command Flushing

  private flushCommands(): void {
    if (!this.dispatchReady) return;

    let task = this.runtime.takeNextDispatchTask();
    while (task !== null) {
      this.scheduleDispatch(task);
      task = this.runtime.takeNextDispatchTask();
    }
  }

  // #endregion Command Flushing

  // #region Dispatch Scheduling

  private scheduleDispatch(task: RuntimeTaskSnapshot): void {
    // Always store the new task even when sync is active — it will be armed by
    // schedulePendingDispatch once the sync phase returns to idle.
    this.trigger.setPending(task);
    this.schedulePendingDispatch();
  }

  private schedulePendingDispatch(): void {
    const task = this.trigger.pendingTask;
    if (!task || this.stateSync.phase !== 'idle' || !this.dispatchReady) return;

    if (!task.continuous || !this.dispatchTimingByKey.has(task.key)) {
      this.dispatchActionStart(task);
      return;
    }

    const { dueAt, mode } = this.computeScheduleParams(task.key);
    this.trigger.arm(dueAt, mode);
  }

  /** Compute timing and mode for a continuous task that already has dispatch history. */
  private computeScheduleParams(key: string): {
    dueAt: number;
    mode: Exclude<RenderTriggerMode, 'auto'>;
  } {
    const intervalMs = this.getMinIntervalMs();
    const timing = this.dispatchTimingByKey.get(key);
    const dueAt = timing !== undefined
      ? timing.lastDispatchAt + intervalMs
      : this.now();
    return { dueAt, mode: this.resolveMode(intervalMs) };
  }

  private dispatchActionStart(task: RuntimeTaskSnapshot, now = this.now()): void {
    if (!this.options.sendMessage || !this.options.createActionStartMessage) return;

    // Clear before sending — covers both the immediate path (no trigger was
    // armed) and the deferred path (trigger just fired its callback).
    this.trigger.clear();

    if (task.continuous) {
      const existing = this.dispatchTimingByKey.get(task.key);
      if (existing !== undefined) {
        // Mutate in place — avoids a redundant Map.set on the hot continuous path.
        existing.lastDispatchAt = now;
      } else {
        this.dispatchTimingByKey.set(task.key, { lastDispatchAt: now, completedCount: 0 });
      }
    }

    this.options.sendMessage(
      this.options.createActionStartMessage(task.key, task.continuous, task.id),
    );
  }

  private discardScheduledDispatch(actionId?: string): void {
    const task = this.trigger.pendingTask;
    if (!task) return;
    if (actionId !== undefined && task.key !== actionId) return;

    this.trigger.clear();
    this.runtime.completeTask(task.id, { continue: false });
    this.runtime.markTaskApplied(task.id);
    this.runtime.markTaskRendered(task.id);
    this.flushCommands();
  }

  private resolveMode(intervalMs: number): Exclude<RenderTriggerMode, 'auto'> {
    if (this.options.mode !== 'auto') return this.options.mode;
    if (typeof window.requestAnimationFrame !== 'function' || intervalMs <= 0) return 'setTimeout';

    const now = this.now();
    this.rafEstimator.ensureCalibration(
      now,
      () => this.runtime.getContinuousKeyCount() > 0,
    );

    const estimate = this.rafEstimator.estimate;
    if (estimate === null) return 'setTimeout';

    const maxRenderIntervalMs = this.getMinRenderIntervalMs();
    const rafAlignedIntervalMs = maxRenderIntervalMs > 0
      ? Math.max(estimate, maxRenderIntervalMs)
      : estimate;

    return intervalMs + RAF_SELECTION_EPSILON_MS >= rafAlignedIntervalMs
      ? 'requestAnimationFrame'
      : 'setTimeout';
  }

  private getMinIntervalMs(): number {
    return this.options.maxTps <= 0 ? 0 : 1000 / this.options.maxTps;
  }

  private getMinRenderIntervalMs(): number {
    return this.options.maxRenderFps <= 0 ? 0 : 1000 / this.options.maxRenderFps;
  }

  // #endregion Dispatch Scheduling

  // #region Action Event Handling

  private handleActionEnd(payload: ActionEndPayload): void {
    const activeTask = this.runtime.peekActiveTaskRef();
    if (!activeTask) return;

    // matchActiveTask receives the already-fetched snapshot — no second
    // getSnapshot() call needed (unlike the original resolveTask design).
    const task = this.matchActiveTask(activeTask, payload);
    if (!task) return;

    const now = this.now();
    const timing = this.dispatchTimingByKey.get(task.key);
    if (timing !== undefined) {
      const durationMs = Math.max(0, now - timing.lastDispatchAt);
      this.markFrame(now, timing.completedCount > 0 ? durationMs : null);
      timing.completedCount += 1;
    }

    if (payload.continue === false) {
      this.runtime.cancel(task.key);
      this.dispatchTimingByKey.delete(task.key);
    }

    if (!this.runtime.completeTask(task.id, { continue: payload.continue, timings: payload.timings })) {
      return;
    }
    this.runtime.markTaskApplied(task.id);
    this.scheduleRenderCommit(task.id);
    this.emit();
  }

  private matchActiveTask(
    activeTask: RuntimeTaskSnapshot,
    payload: ActionEndPayload,
  ): RuntimeTaskSnapshot | null {
    if (payload.tick_id) {
      return activeTask.id === payload.tick_id ? activeTask : null;
    }
    return activeTask.key === payload.id ? activeTask : null;
  }

  // #endregion Action Event Handling

  // #region Render Commit

  private scheduleRenderCommit(taskId: string): void {
    this.clearRenderCommit();
    this.renderCommitTaskId = taskId;

    const commit = (): void => {
      if (this.renderCommitTaskId !== taskId) return;
      this.clearRenderCommit();
      if (!this.runtime.markTaskRendered(taskId)) return;
      this.flushCommands();
      this.emit();
    };

    if (typeof queueMicrotask === 'function') {
      queueMicrotask(commit);
    } else {
      this.renderCommitTimeoutId = window.setTimeout(commit, 0);
    }
  }

  private clearRenderCommit(): void {
    if (this.renderCommitTimeoutId !== null) {
      window.clearTimeout(this.renderCommitTimeoutId);
      this.renderCommitTimeoutId = null;
    }
    this.renderCommitTaskId = null;
  }

  // #endregion Render Commit

  // #region Metrics

  private markFrame(now: number, actionDurationMs: number | null): void {
    this.frameTimestamps.push(now);
    if (actionDurationMs !== null && Number.isFinite(actionDurationMs)) {
      this.frameDurations.push({ timestamp: now, durationMs: actionDurationMs });
      this.frameDurationSum += actionDurationMs;
    }
    this.trimSamples(now);
    this.emitMetricsIfNeeded();
  }

  private trimSamples(now: number): void {
    // Compute cutoff once and reuse — avoids a subtraction per iteration.
    const cutoff = now - METRIC_WINDOW_MS;

    while (this.frameTimestamps.length > 0 && this.frameTimestamps[0] < cutoff) {
      this.frameTimestamps.shift();
    }
    while (this.frameDurations.length > 0 && this.frameDurations[0].timestamp < cutoff) {
      // Keep frameDurationSum in sync so emitMetricsIfNeeded never needs reduce.
      this.frameDurationSum -= this.frameDurations[0].durationMs;
      this.frameDurations.shift();
    }
  }

  private emitMetricsIfNeeded(force = false): void {
    if (!this.options.onMetricsChange) return;

    const now = this.now();
    if (!force && now - this.lastMetricsEmitAt < METRIC_EMIT_INTERVAL_MS) return;
    this.lastMetricsEmitAt = now;

    if (
      this.runtime.getContinuousKeyCount() === 0 ||
      this.frameTimestamps.length === 0
    ) {
      this.emitMetrics({ tps: null, mspt: null });
      return;
    }

    let tps: number | null = null;
    const tsCount = this.frameTimestamps.length;
    if (tsCount >= 2) {
      const span = Math.max(1, this.frameTimestamps[tsCount - 1] - this.frameTimestamps[0]);
      tps = Number((((tsCount - 1) * 1000) / span).toFixed(1));
    }

    // O(1) — running sum maintained in markFrame/trimSamples; no reduce needed.
    const mspt = this.frameDurations.length > 0
      ? Number((this.frameDurationSum / this.frameDurations.length).toFixed(1))
      : null;

    this.emitMetrics({ tps, mspt });
  }

  private emitMetrics(metrics: RuntimeMetrics): void {
    this.options.onMetricsChange?.(metrics);
  }

  // #endregion Metrics

  // #region Internal Helpers

  private normalizeMaxTps(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_MAX_TPS;
    return Math.max(0, Math.floor(value));
  }

  private normalizeMaxRenderFps(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_MAX_RENDER_FPS;
    return Math.max(0, Math.floor(value));
  }

  private emit(): void {
    this.subscribers.forEach((listener) => { listener(); });
  }

  // #endregion Internal Helpers
}

// #endregion SimulationLoopController
