import type { RendererSession } from '@tensnap/core/runtime';
import type { RenderTriggerMode } from '@tensnap/web/store';

export type BrowserBenchmarkCategory = 'tensnap' | 'renderer-control' | 'external';
export type BenchmarkRuntimeMode = 'production';

export interface BenchmarkHostOptions {
  renderTriggerMode: RenderTriggerMode;
  maxTps: number;
  maxRenderFps: number;
}

export interface MountedComponentBenchmark {
  kind: 'component';
  tick(frameIndex: number): void | Promise<void>;
  destroy(): void;
}

export interface MountedModelBenchmark {
  kind: 'model';
  session: RendererSession;
  destroy(): void;
}

export type MountedBenchmarkCase = MountedComponentBenchmark | MountedModelBenchmark;

export interface BenchmarkCase {
  name: string;
  category: BrowserBenchmarkCategory;
  variant?: string;
  config: Record<string, unknown>;
  actionId?: string;
  mount(container: HTMLElement, options: BenchmarkHostOptions): Promise<MountedBenchmarkCase>;
}

export interface BrowserBenchmarkCase {
  readonly case: BenchmarkCase;
  /** State after the complete warmup + measured sequence. */
  snapshot(): unknown;
  /** Independently replayed expected state for semantic verification. */
  expectedState(totalFrames: number): unknown;
}

export interface MetricSummary {
  totalMs: number;
  meanMs: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
  tps: number;
}

export interface BrowserBenchmarkStats {
  caseName: string;
  category: BrowserBenchmarkCategory;
  variant?: string;
  config: Record<string, unknown>;
  runtimeMode: BenchmarkRuntimeMode;
  completedFrames: number;
  measuredFrames: number;
  stopReason: string;
  timings: number[];
  /** Synchronous state mutation time before the browser render barrier. */
  mutationTimings?: number[];
}
