import type { RuntimeTaskSnapshot } from './PipelineRuntime';
import type { RunRenderBarrier } from './RunController';
import type { RenderTriggerMode } from './simulation-loop';

const RAF_CALIBRATION_SAMPLE_COUNT = 6;
const RAF_ESTIMATE_MAX_AGE_MS = 2_000;
const RAF_OBSERVATION_MAX_INTERVAL_MS = 250;
const RAF_SELECTION_EPSILON_MS = 0.5;

export interface BrowserRunRenderOptions {
  mode: RenderTriggerMode;
  maxTps: number;
  maxRenderFps: number;
}

export interface BrowserRunTimingHost {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  requestAnimationFrame(callback: (timestamp: number) => void): unknown | null;
}

const defaultTimingHost: BrowserRunTimingHost = {
  now: () => (typeof performance === 'undefined' ? Date.now() : performance.now()),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  requestAnimationFrame: (callback) => (
    typeof globalThis.requestAnimationFrame === 'function'
      ? globalThis.requestAnimationFrame(callback)
      : null
  ),
};

class RafCadenceEstimator {
  private estimateMs: number | null = null;
  private updatedAt = 0;
  private calibrating = false;
  private lastTimestamp: number | null = null;
  private samplesLeft = 0;

  constructor(private readonly host: BrowserRunTimingHost) {}

  get estimate(): number | null {
    return this.estimateMs;
  }

  observe(intervalMs: number, now: number): void {
    if (
      !Number.isFinite(intervalMs)
      || intervalMs <= 0
      || intervalMs > RAF_OBSERVATION_MAX_INTERVAL_MS
    ) {
      return;
    }
    if (this.estimateMs !== null && Math.abs(intervalMs - this.estimateMs) > 50) {
      return;
    }
    this.estimateMs = this.estimateMs === null
      ? intervalMs
      : (this.estimateMs * 3 + intervalMs) / 4;
    this.updatedAt = now;
  }

  ensureCalibration(now: number): void {
    if (this.calibrating) return;
    if (this.estimateMs !== null && now - this.updatedAt <= RAF_ESTIMATE_MAX_AGE_MS) return;

    this.calibrating = true;
    this.lastTimestamp = null;
    this.samplesLeft = RAF_CALIBRATION_SAMPLE_COUNT;

    const tick = (timestamp: number): void => {
      if (this.lastTimestamp !== null) {
        this.observe(timestamp - this.lastTimestamp, timestamp);
        this.samplesLeft -= 1;
      }
      this.lastTimestamp = timestamp;

      if (this.samplesLeft <= 0) {
        this.finishCalibration();
        return;
      }
      if (this.host.requestAnimationFrame(tick) === null) {
        this.finishCalibration();
      }
    };

    if (this.host.requestAnimationFrame(tick) === null) {
      this.finishCalibration();
    }
  }

  private finishCalibration(): void {
    this.calibrating = false;
    this.lastTimestamp = null;
    this.samplesLeft = 0;
  }
}

/**
 * Browser scheduling adapter for RunController.
 *
 * The shared controller calls this after a completed action has been applied.
 * Timeout mode preserves high-throughput runs, while rAF mode deliberately
 * aligns the next dispatch with a display frame. Auto mode mirrors the legacy
 * browser loop by selecting rAF only when the configured TPS cadence is slow
 * enough to benefit from frame alignment.
 */
export class BrowserRunRenderBarrier implements RunRenderBarrier {
  private readonly rafEstimator: RafCadenceEstimator;

  constructor(
    private readonly getOptions: () => BrowserRunRenderOptions,
    private readonly host: BrowserRunTimingHost = defaultTimingHost,
  ) {
    this.rafEstimator = new RafCadenceEstimator(host);
  }

  wait(task: RuntimeTaskSnapshot): Promise<void> {
    const options = this.normalizeOptions(this.getOptions());
    const intervalMs = options.maxTps <= 0 ? 0 : 1_000 / options.maxTps;
    const now = this.host.now();
    const dueAt = (task.dispatchedAt ?? now) + intervalMs;
    const mode = this.resolveMode(options, intervalMs, now);

    return mode === 'requestAnimationFrame'
      ? this.waitForAnimationFrame(dueAt)
      : this.waitForTimeout(dueAt);
  }

  private waitForTimeout(dueAt: number): Promise<void> {
    return new Promise((resolve) => {
      this.host.setTimeout(resolve, Math.max(1, dueAt - this.host.now()));
    });
  }

  private waitForAnimationFrame(dueAt: number): Promise<void> {
    return new Promise((resolve) => {
      let lastTimestamp: number | null = null;
      const tick = (timestamp: number): void => {
        if (lastTimestamp !== null) {
          this.rafEstimator.observe(timestamp - lastTimestamp, timestamp);
        }
        lastTimestamp = timestamp;

        if (timestamp >= dueAt) {
          resolve();
          return;
        }
        if (this.host.requestAnimationFrame(tick) === null) {
          void this.waitForTimeout(dueAt).then(resolve);
        }
      };

      if (this.host.requestAnimationFrame(tick) === null) {
        void this.waitForTimeout(dueAt).then(resolve);
      }
    });
  }

  private resolveMode(
    options: BrowserRunRenderOptions,
    intervalMs: number,
    now: number,
  ): Exclude<RenderTriggerMode, 'auto'> {
    if (options.mode !== 'auto') return options.mode;
    if (intervalMs <= 0) return 'setTimeout';

    this.rafEstimator.ensureCalibration(now);
    const estimate = this.rafEstimator.estimate;
    if (estimate === null) return 'setTimeout';

    const maxRenderIntervalMs = options.maxRenderFps <= 0
      ? 0
      : 1_000 / options.maxRenderFps;
    const rafAlignedIntervalMs = Math.max(estimate, maxRenderIntervalMs);
    return intervalMs + RAF_SELECTION_EPSILON_MS >= rafAlignedIntervalMs
      ? 'requestAnimationFrame'
      : 'setTimeout';
  }

  private normalizeOptions(options: BrowserRunRenderOptions): BrowserRunRenderOptions {
    return {
      mode: options.mode,
      maxTps: Number.isFinite(options.maxTps) ? Math.max(0, Math.floor(options.maxTps)) : 300,
      maxRenderFps: Number.isFinite(options.maxRenderFps)
        ? Math.max(0, Math.floor(options.maxRenderFps))
        : 120,
    };
  }
}
