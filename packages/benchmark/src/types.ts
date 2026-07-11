/** Single frame timing result in milliseconds. */
export interface FrameTiming {
  frameIndex: number;
  elapsed: number; // ms for this tick (compute only)
}

export type BenchmarkSchedulerMode = 'auto' | 'raf' | 'timeout';
export type BenchmarkSchedulerSelection = BenchmarkSchedulerMode | 'all';
export type BenchmarkRuntimeMode = 'development' | 'production';
export type BenchmarkRunnerMode = 'simple' | 'renderer-session';
export type BenchmarkRunnerSelection = BenchmarkRunnerMode | 'all';

export interface BenchmarkRunOptions {
  schedulerMode?: BenchmarkSchedulerMode;
  runtimeMode?: BenchmarkRuntimeMode;
  runnerMode?: BenchmarkRunnerMode;
  onProgress?: (done: number, total: number) => void;
}

/** Aggregated statistics for a benchmark case. */
export interface BenchmarkStats {
  caseName: string;
  config: Record<string, unknown>;
  /** Suite label: synthetic or web-scenario. */
  suite: 'synthetic' | 'web-scenario';
  runnerMode: BenchmarkRunnerMode;
  schedulerMode: BenchmarkSchedulerMode;
  runtimeMode: BenchmarkRuntimeMode;
  frames: number;
  totalMs: number;
  meanMs: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
  tps: number;
  timings: number[]; // raw per-tick compute elapsed ms
}

export interface BenchmarkCase {
  name: string;
  config: Record<string, unknown>;
  /** Suite label: synthetic or web-scenario. */
  suite: 'synthetic' | 'web-scenario';
  /** Called once before the run to create the DOM containers and views. */
  setup(container: HTMLElement): Promise<void> | void;
  /** Called for every benchmark frame; should update data but NOT wait for RAF. */
  tick(frameIndex: number): Promise<void> | void;
  /** Called once after the run to destroy resources. */
  teardown(): Promise<void> | void;
  /**
   * Optional hooks that put the case through the real RendererSession path.
   * Hosts can use `onCommit` to include their production store/UI commit in
   * the timing path without creating a second session runner.
   */
  runtime?: {
    record?: RecordingOptions | false;
    stopWhen?: string;
    setupSession?: (session: RendererSession) => void;
    applySessionStep?: (session: RendererSession, frameIndex: number) => Promise<void> | void;
    onCommit?: (session: RendererSession) => void;
  };
}

export interface BenchmarkRegressionGate {
  name: string;
  /** Maximum permitted p95 regression against the checked-in baseline. */
  maxP95RegressionPercent: number;
  /** Optional minimum throughput to catch gross scheduler/checkpoint regressions. */
  minTps?: number;
}

/** A named group of related benchmark cases with parameter variations. */
export interface CaseVariation {
  /** Short identifier used to match enable signals (e.g. 'LineChart'). */
  name: string;
  /** Human-readable description shown in the UI. */
  description: string;
  /** Suite label for all cases in this variation group. */
  suite: 'synthetic' | 'web-scenario';
  /** Ordered list of cases, typically from lightest to heaviest. Index 1 is the default "medium" configuration. */
  cases: BenchmarkCase[];
}
import type { RecordingOptions, RendererSession } from '@tensnap/core/runtime';
