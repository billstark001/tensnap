import type { ActionEndPayload, RendererToSimulatorMessage } from '@tensnap/core';
import type { RenderTriggerMode } from './settings';

const DEFAULT_MAX_TPS = 60;
const METRIC_WINDOW_MS = 1000;
const METRIC_EMIT_INTERVAL_MS = 250;
const RAF_CALIBRATION_SAMPLE_COUNT = 6;
const RAF_ESTIMATE_MAX_AGE_MS = 2000;
const RAF_OBSERVATION_MAX_INTERVAL_MS = 250;
const RAF_SELECTION_EPSILON_MS = 0.5;

export type ActionStartFactory = (id: string, continuous?: boolean) => RendererToSimulatorMessage;
export type MessageSender = (message: RendererToSimulatorMessage) => void;

type ActiveLoopHandle = {
  timeoutId: number | null;
  rafId: number | null;
  lastDispatchAt: number;
  nextDueAt: number;
  completedCount: number;
};

export type RuntimeMetrics = {
  tps: number | null;
  mspt: number | null;
};

type LoopOptions = {
  mode: RenderTriggerMode;
  maxTps: number;
  onMetricsChange?: (metrics: RuntimeMetrics) => void;
};

export class SimulationLoopController {
  private readonly activeLoops = new Map<string, ActiveLoopHandle>();
  private readonly mode: RenderTriggerMode;
  private readonly maxTps: number;
  private readonly onMetricsChange?: (metrics: RuntimeMetrics) => void;
  private readonly frameTimestamps: number[] = [];
  private readonly frameDurations: Array<{ timestamp: number; durationMs: number }> = [];
  private rafEstimateMs: number | null = null;
  private rafEstimateUpdatedAt = 0;
  private rafCalibrationId: number | null = null;
  private rafCalibrationLastTimestamp: number | null = null;
  private rafCalibrationSamplesRemaining = 0;
  private lastObservedRafTimestamp: number | null = null;
  private lastMetricsEmitAt = 0;

  constructor(
    private readonly sendMessage: MessageSender,
    private readonly createActionStartMessage: ActionStartFactory,
    options: Partial<LoopOptions> = {},
  ) {
    this.mode = options.mode ?? 'auto';
    this.maxTps = this.normalizeMaxTps(options.maxTps ?? DEFAULT_MAX_TPS);
    this.onMetricsChange = options.onMetricsChange;
  }

  isRunning(actionId: string): boolean {
    return this.activeLoops.has(actionId);
  }

  start(actionId: string): void {
    if (this.activeLoops.has(actionId)) {
      return;
    }
    const now = performance.now();
    const intervalMs = this.getMinIntervalMs();
    this.activeLoops.set(actionId, {
      timeoutId: null,
      rafId: null,
      lastDispatchAt: now,
      nextDueAt: now + intervalMs,
      completedCount: 0,
    });
    this.sendMessage(this.createActionStartMessage(actionId, true));
  }

  stop(actionId?: string): void {
    if (actionId) {
      this.clearSchedule(actionId);
      this.activeLoops.delete(actionId);
      this.emitMetricsIfNeeded(true);
      return;
    }

    for (const key of this.activeLoops.keys()) {
      this.clearSchedule(key);
    }
    this.activeLoops.clear();
    this.stopRafCalibration();
    this.lastObservedRafTimestamp = null;
    this.frameTimestamps.length = 0;
    this.frameDurations.length = 0;
    this.onMetricsChange?.({ tps: null, mspt: null });
  }

  handleActionEnd(payload: ActionEndPayload): void {
    const actionId = payload.id;
    if (!this.activeLoops.has(actionId)) {
      return;
    }

    const handle = this.activeLoops.get(actionId);
    const now = performance.now();
    const actionDurationMs = handle ? Math.max(0, now - handle.lastDispatchAt) : null;
    const shouldMeasureDuration = handle ? handle.completedCount > 0 : false;
    this.markFrame(now, shouldMeasureDuration ? actionDurationMs : null);
    if (handle) {
      handle.completedCount += 1;
    }

    if (payload.continue === false) {
      this.stop(actionId);
      return;
    }

    this.clearSchedule(actionId);
    this.scheduleNext(actionId);
  }

  dispose(): void {
    this.stop();
  }

  private scheduleNext(actionId: string): void {
    if (!this.activeLoops.has(actionId)) {
      return;
    }

    const mode = this.resolveMode(this.getMinIntervalMs());
    if (mode === 'requestAnimationFrame') {
      this.scheduleWithRaf(actionId);
      return;
    }

    this.scheduleWithTimeout(actionId);
  }

  private scheduleWithTimeout(actionId: string): void {
    const handle = this.activeLoops.get(actionId);
    if (!handle) {
      return;
    }
    const now = performance.now();
    const delayMs = Math.max(1, handle.nextDueAt - now);
    const timeoutId = window.setTimeout(() => {
      const handle = this.activeLoops.get(actionId);
      if (!handle) {
        return;
      }
      handle.timeoutId = null;
      this.dispatchActionStart(actionId, performance.now(), handle);
    }, delayMs);

    handle.timeoutId = timeoutId;
  }

  private scheduleWithRaf(actionId: string): void {
    const tick = (now: number) => {
      const handle = this.activeLoops.get(actionId);
      if (!handle) {
        return;
      }

      this.recordObservedRafInterval(now);

      if (now >= handle.nextDueAt) {
        handle.rafId = null;
        this.dispatchActionStart(actionId, now, handle);
        return;
      }

      handle.rafId = window.requestAnimationFrame(tick);
    };

    const handle = this.activeLoops.get(actionId);
    if (!handle) {
      return;
    }

    // Always yield at least one frame boundary in RAF mode to avoid starvation at high/unlimited TPS.
    if (handle.rafId != null) {
      return;
    }

    handle.rafId = window.requestAnimationFrame(tick);
  }

  private dispatchActionStart(actionId: string, now: number, handle: ActiveLoopHandle): void {
    const intervalMs = this.getMinIntervalMs();
    handle.lastDispatchAt = now;
    handle.nextDueAt = intervalMs > 0
      ? now + intervalMs
      : now;
    this.sendMessage(this.createActionStartMessage(actionId, true));
  }

  private clearSchedule(actionId: string): void {
    const handle = this.activeLoops.get(actionId);
    if (!handle) {
      return;
    }

    if (handle.timeoutId != null) {
      window.clearTimeout(handle.timeoutId);
      handle.timeoutId = null;
    }
    if (handle.rafId != null) {
      window.cancelAnimationFrame(handle.rafId);
      handle.rafId = null;
    }
  }

  private recordObservedRafInterval(now: number): void {
    if (this.lastObservedRafTimestamp != null) {
      this.updateRafEstimate(now - this.lastObservedRafTimestamp, now);
    }
    this.lastObservedRafTimestamp = now;
  }

  private updateRafEstimate(intervalMs: number, now: number): void {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > RAF_OBSERVATION_MAX_INTERVAL_MS) {
      return;
    }

    this.rafEstimateMs = this.rafEstimateMs == null
      ? intervalMs
      : (this.rafEstimateMs * 3 + intervalMs) / 4;
    this.rafEstimateUpdatedAt = now;
  }

  private ensureRafCalibration(now: number): void {
    if (typeof window.requestAnimationFrame !== 'function') {
      return;
    }

    if (this.rafCalibrationId != null) {
      return;
    }

    if (this.rafEstimateMs != null && now - this.rafEstimateUpdatedAt <= RAF_ESTIMATE_MAX_AGE_MS) {
      return;
    }

    this.rafCalibrationLastTimestamp = null;
    this.rafCalibrationSamplesRemaining = RAF_CALIBRATION_SAMPLE_COUNT;

    const calibrate = (timestamp: number) => {
      if (this.rafCalibrationLastTimestamp != null) {
        this.updateRafEstimate(timestamp - this.rafCalibrationLastTimestamp, timestamp);
        this.rafCalibrationSamplesRemaining -= 1;
      }

      this.rafCalibrationLastTimestamp = timestamp;

      if (this.rafCalibrationSamplesRemaining <= 0 || this.activeLoops.size === 0) {
        this.rafCalibrationId = null;
        this.rafCalibrationLastTimestamp = null;
        this.rafCalibrationSamplesRemaining = 0;
        return;
      }

      this.rafCalibrationId = window.requestAnimationFrame(calibrate);
    };

    this.rafCalibrationId = window.requestAnimationFrame(calibrate);
  }

  private stopRafCalibration(): void {
    if (this.rafCalibrationId != null) {
      window.cancelAnimationFrame(this.rafCalibrationId);
      this.rafCalibrationId = null;
    }
    this.rafCalibrationLastTimestamp = null;
    this.rafCalibrationSamplesRemaining = 0;
  }

  private markFrame(now: number, actionDurationMs: number | null): void {
    this.frameTimestamps.push(now);
    if (actionDurationMs != null && Number.isFinite(actionDurationMs)) {
      this.frameDurations.push({ timestamp: now, durationMs: actionDurationMs });
    }
    this.trimSamples(now);
    this.emitMetricsIfNeeded();
  }

  private trimSamples(now: number): void {
    while (this.frameTimestamps.length > 0 && now - this.frameTimestamps[0] > METRIC_WINDOW_MS) {
      this.frameTimestamps.shift();
    }
    while (this.frameDurations.length > 0 && now - this.frameDurations[0].timestamp > METRIC_WINDOW_MS) {
      this.frameDurations.shift();
    }
  }

  private emitMetricsIfNeeded(force = false): void {
    if (!this.onMetricsChange) {
      return;
    }
    const now = performance.now();
    if (!force && now - this.lastMetricsEmitAt < METRIC_EMIT_INTERVAL_MS) {
      return;
    }
    this.lastMetricsEmitAt = now;

    if (this.activeLoops.size === 0 || this.frameTimestamps.length === 0) {
      this.onMetricsChange({ tps: null, mspt: null });
      return;
    }

    let tps: number | null = null;
    if (this.frameTimestamps.length >= 2) {
      const oldest = this.frameTimestamps[0];
      const newest = this.frameTimestamps[this.frameTimestamps.length - 1];
      const span = Math.max(1, newest - oldest);
      tps = Number((((this.frameTimestamps.length - 1) * 1000) / span).toFixed(1));
    }

    let mspt: number | null = null;
    if (this.frameDurations.length > 0) {
      const total = this.frameDurations.reduce((sum, sample) => sum + sample.durationMs, 0);
      mspt = Number((total / this.frameDurations.length).toFixed(1));
    }

    this.onMetricsChange({ tps, mspt });
  }

  private resolveMode(intervalMs: number): Exclude<RenderTriggerMode, 'auto'> {
    if (this.mode === 'auto') {
      if (typeof window.requestAnimationFrame !== 'function') {
        return 'setTimeout';
      }

      if (intervalMs <= 0) {
        return 'setTimeout';
      }

      const now = performance.now();
      this.ensureRafCalibration(now);

      if (this.rafEstimateMs == null) {
        return 'setTimeout';
      }

      if (now - this.rafEstimateUpdatedAt > RAF_ESTIMATE_MAX_AGE_MS) {
        this.ensureRafCalibration(now);
      }

      return intervalMs + RAF_SELECTION_EPSILON_MS >= this.rafEstimateMs
        ? 'requestAnimationFrame'
        : 'setTimeout';
    }
    return this.mode;
  }

  private getMinIntervalMs(): number {
    if (this.maxTps <= 0) {
      return 0;
    }
    return 1000 / this.maxTps;
  }

  private normalizeMaxTps(value: number): number {
    if (!Number.isFinite(value)) {
      return DEFAULT_MAX_TPS;
    }
    return Math.max(0, Math.floor(value));
  }
}
