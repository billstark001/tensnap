import type { ActionEndPayload, ActionStartPayload, TickTimingBreakdown } from '@tensnap/protocol';

const METRIC_WINDOW_MS = 1_000;

export interface ActionRunMetricSnapshot {
  runtime: {
    tps: number;
    mspt: number;
  };
  simulator: {
    simulate_ms?: number;
    communicate_ms?: number;
    render_ms?: number;
  };
}

type RuntimeSample = {
  completedAt: number;
  durationMs: number;
};

type SimulatorSample = {
  completedAt: number;
  timings: TickTimingBreakdown;
};

type SimulatorTimingKey = 'simulate_ms' | 'communicate_ms' | 'render_ms';

const SIMULATOR_TIMING_KEYS: readonly SimulatorTimingKey[] = [
  'simulate_ms',
  'communicate_ms',
  'render_ms',
];

const defaultNow = () => performance.now();

/**
 * Metrics for one user-initiated action execution. Instances are deliberately
 * short-lived: beginning another action means creating a new instance, so a
 * status bar can never blend measurements from separate runs.
 */
export class ActionRunMetrics {
  private readonly dispatchedAtByTickId = new Map<string, number>();
  private readonly runtimeSamples: RuntimeSample[] = [];
  private readonly simulatorSamples: SimulatorSample[] = [];
  private runtimeHead = 0;
  private simulatorHead = 0;
  private runtimeDurationSum = 0;
  private readonly simulatorSums: Record<SimulatorTimingKey, number> = {
    simulate_ms: 0,
    communicate_ms: 0,
    render_ms: 0,
  };
  private readonly simulatorCounts: Record<SimulatorTimingKey, number> = {
    simulate_ms: 0,
    communicate_ms: 0,
    render_ms: 0,
  };

  constructor(
    private readonly actionId: string,
    private readonly now: () => number = defaultNow,
  ) {}

  recordDispatch(payload: ActionStartPayload): void {
    if (payload.id !== this.actionId || !payload.tick_id) return;
    this.dispatchedAtByTickId.set(payload.tick_id, this.now());
  }

  recordCompletion(payload: ActionEndPayload): ActionRunMetricSnapshot | null {
    if (payload.id !== this.actionId) return null;

    const dispatchedAt = this.takeDispatchTime(payload.tick_id);
    if (dispatchedAt === undefined) return null;

    const completedAt = this.now();
    const durationMs = Math.max(0, completedAt - dispatchedAt);
    this.runtimeSamples.push({
      completedAt,
      durationMs,
    });
    this.runtimeDurationSum += durationMs;
    if (payload.timings) {
      this.simulatorSamples.push({ completedAt, timings: payload.timings });
      this.addSimulatorTimings(payload.timings, 1);
    }
    this.trimSamples(completedAt);

    const runtimeSampleCount = this.runtimeSamples.length - this.runtimeHead;
    if (runtimeSampleCount === 0) return null;
    const mspt = this.runtimeDurationSum / runtimeSampleCount;

    const firstCompletedAt = this.runtimeSamples[this.runtimeHead].completedAt;
    const lastCompletedAt = this.runtimeSamples[this.runtimeSamples.length - 1].completedAt;
    const tps = runtimeSampleCount > 1
      ? ((runtimeSampleCount - 1) * 1_000) / Math.max(1, lastCompletedAt - firstCompletedAt)
      : 1_000 / Math.max(1, mspt);

    return {
      runtime: { tps, mspt },
      simulator: {
        simulate_ms: this.averageSimulatorTiming('simulate_ms'),
        communicate_ms: this.averageSimulatorTiming('communicate_ms'),
        render_ms: this.averageSimulatorTiming('render_ms'),
      },
    };
  }

  private takeDispatchTime(tickId?: string): number | undefined {
    if (!tickId) return undefined;
    const dispatchedAt = this.dispatchedAtByTickId.get(tickId);
    this.dispatchedAtByTickId.delete(tickId);
    return dispatchedAt;
  }

  private trimSamples(now: number): void {
    const cutoff = now - METRIC_WINDOW_MS;
    while (this.runtimeSamples[this.runtimeHead]?.completedAt < cutoff) {
      this.runtimeDurationSum -= this.runtimeSamples[this.runtimeHead].durationMs;
      this.runtimeHead += 1;
    }
    while (this.simulatorSamples[this.simulatorHead]?.completedAt < cutoff) {
      this.addSimulatorTimings(this.simulatorSamples[this.simulatorHead].timings, -1);
      this.simulatorHead += 1;
    }
    this.compactSamples();
  }

  private addSimulatorTimings(timings: TickTimingBreakdown, direction: 1 | -1): void {
    for (const key of SIMULATOR_TIMING_KEYS) {
      const value = timings[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      this.simulatorSums[key] += value * direction;
      this.simulatorCounts[key] += direction;
    }
  }

  private averageSimulatorTiming(key: SimulatorTimingKey): number | undefined {
    const count = this.simulatorCounts[key];
    return count === 0 ? undefined : this.simulatorSums[key] / count;
  }

  private compactSamples(): void {
    if (this.runtimeHead > 256 && this.runtimeHead * 2 >= this.runtimeSamples.length) {
      this.runtimeSamples.splice(0, this.runtimeHead);
      this.runtimeHead = 0;
    }
    if (this.simulatorHead > 256 && this.simulatorHead * 2 >= this.simulatorSamples.length) {
      this.simulatorSamples.splice(0, this.simulatorHead);
      this.simulatorHead = 0;
    }
  }
}
