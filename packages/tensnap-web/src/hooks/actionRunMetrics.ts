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

const defaultNow = () => (
  typeof performance === 'undefined' ? Date.now() : performance.now()
);

const average = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

/**
 * Metrics for one user-initiated action execution. Instances are deliberately
 * short-lived: beginning another action means creating a new instance, so a
 * status bar can never blend measurements from separate runs.
 */
export class ActionRunMetrics {
  private readonly dispatchedAtByTickId = new Map<string, number>();
  private readonly runtimeSamples: RuntimeSample[] = [];
  private readonly simulatorSamples: SimulatorSample[] = [];

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
    this.runtimeSamples.push({
      completedAt,
      durationMs: Math.max(0, completedAt - dispatchedAt),
    });
    if (payload.timings) {
      this.simulatorSamples.push({ completedAt, timings: payload.timings });
    }
    this.trimSamples(completedAt);

    const mspt = average(this.runtimeSamples.map((sample) => sample.durationMs));
    if (mspt === undefined) return null;

    const timestamps = this.runtimeSamples.map((sample) => sample.completedAt);
    const tps = timestamps.length > 1
      ? ((timestamps.length - 1) * 1_000) / Math.max(1, timestamps[timestamps.length - 1] - timestamps[0])
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
    if (tickId) {
      const dispatchedAt = this.dispatchedAtByTickId.get(tickId);
      this.dispatchedAtByTickId.delete(tickId);
      return dispatchedAt;
    }

    // Older simulators may omit tick_id. There is only one request in flight
    // for a RunController, so accept that legacy response only when it cannot
    // be confused with a prior stopped run of the same action.
    if (this.dispatchedAtByTickId.size !== 1) return undefined;
    const [entry] = this.dispatchedAtByTickId;
    this.dispatchedAtByTickId.delete(entry[0]);
    return entry[1];
  }

  private trimSamples(now: number): void {
    const cutoff = now - METRIC_WINDOW_MS;
    while (this.runtimeSamples[0]?.completedAt < cutoff) {
      this.runtimeSamples.shift();
    }
    while (this.simulatorSamples[0]?.completedAt < cutoff) {
      this.simulatorSamples.shift();
    }
  }

  private averageSimulatorTiming(
    key: 'simulate_ms' | 'communicate_ms' | 'render_ms',
  ): number | undefined {
    return average(this.simulatorSamples.flatMap((sample) => {
      const value = sample.timings[key];
      return typeof value === 'number' && Number.isFinite(value) ? [value] : [];
    }));
  }
}
