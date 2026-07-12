import type { RendererSession } from '@tensnap/core/runtime';
import type { RenderTriggerMode } from '@tensnap/web/store';

export type BenchmarkCategory = 'component' | 'model' | 'random-walk';
export type BenchmarkRuntimeMode = 'development' | 'production';
export type BenchmarkRenderTriggerSelection = RenderTriggerMode | 'all';

export interface BenchmarkHostOptions {
  renderTriggerMode: RenderTriggerMode;
  maxTps: number;
  maxRenderFps: number;
}

export interface BenchmarkRunOptions {
  renderTriggerMode?: RenderTriggerMode;
  maxTps?: number;
  maxRenderFps?: number;
  runtimeMode?: BenchmarkRuntimeMode;
  onProgress?: (done: number, total: number) => void;
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
  category: BenchmarkCategory;
  variant?: string;
  config: Record<string, unknown>;
  actionId?: string;
  mount(container: HTMLElement, options: BenchmarkHostOptions): Promise<MountedBenchmarkCase>;
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

/** Shared cycle metrics plus category-specific execution metadata. */
export interface BenchmarkStats extends MetricSummary {
  caseName: string;
  category: BenchmarkCategory;
  variant?: string;
  config: Record<string, unknown>;
  host: 'tensnap-web';
  renderTriggerMode: RenderTriggerMode;
  maxTps: number;
  maxRenderFps: number;
  runtimeMode: BenchmarkRuntimeMode;
  requestedFrames: number;
  completedFrames: number;
  warmupFrames: number;
  measuredFrames: number;
  stopReason: string;
  timings: number[];
  /** Component/direct-layer mutation cost before the shared browser render barrier. */
  mutation?: MetricSummary & { timings: number[] };
  /** Random-walk full-cycle overhead relative to the raw Leafer case. */
  overheadVsRawPercent?: number;
  /** Random-walk synchronous mutation overhead relative to raw Leafer. */
  mutationOverheadVsRawPercent?: number;
}

export interface BenchmarkRegressionGate {
  name: string;
  maxP95RegressionPercent: number;
  minTps?: number;
}

export interface CaseGroup {
  name: string;
  category: BenchmarkCategory;
  description: string;
  cases: BenchmarkCase[];
}
