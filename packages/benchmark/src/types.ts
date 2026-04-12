/** Single frame timing result in milliseconds. */
export interface FrameTiming {
  frameIndex: number;
  elapsed: number; // ms for this frame (update + render wait)
}

/** Aggregated statistics for a benchmark case. */
export interface BenchmarkStats {
  caseName: string;
  config: Record<string, unknown>;
  frames: number;
  totalMs: number;
  meanMs: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
  fps: number;
  timings: number[]; // raw per-frame elapsed ms
}

export interface BenchmarkCase {
  name: string;
  config: Record<string, unknown>;
  /** Called once before the run to create the DOM containers and views. */
  setup(container: HTMLElement): Promise<void> | void;
  /** Called for every benchmark frame; should update data but NOT wait for RAF. */
  tick(frameIndex: number): void;
  /** Called once after the run to destroy resources. */
  teardown(): Promise<void> | void;
}
