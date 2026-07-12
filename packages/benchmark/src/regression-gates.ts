import type { BenchmarkRegressionGate, BenchmarkStats } from './types';

/**
 * CI-friendly benchmark comparison. Keep baselines per machine class in the
 * invoking workflow; this module deliberately does not hard-code elapsed time
 * from a developer laptop.
 */
export function assertBenchmarkRegressionGate(
  gate: BenchmarkRegressionGate,
  baseline: Pick<BenchmarkStats, 'p95Ms' | 'tps'>,
  result: Pick<BenchmarkStats, 'p95Ms' | 'tps'>,
): void {
  if (baseline.p95Ms <= 0) throw new Error(`${gate.name}: baseline p95 must be positive.`);
  const regression = ((result.p95Ms - baseline.p95Ms) / baseline.p95Ms) * 100;
  if (regression > gate.maxP95RegressionPercent) {
    throw new Error(
      `${gate.name}: p95 regressed by ${regression.toFixed(1)}% (limit ${gate.maxP95RegressionPercent}%).`,
    );
  }
  if (gate.minTps !== undefined && result.tps < gate.minTps) {
    throw new Error(`${gate.name}: throughput ${result.tps} TPS is below the ${gate.minTps} TPS floor.`);
  }
}

/** Required runtime-path gate names for CI baseline artifacts. */
export const runtimeRegressionGates: readonly BenchmarkRegressionGate[] = [
  { name: 'react-zustand-renderer-session-commit', maxP95RegressionPercent: 10 },
  { name: 'recording-off', maxP95RegressionPercent: 2 },
  { name: 'recording-on', maxP95RegressionPercent: 15 },
  { name: 'condition-long-history', maxP95RegressionPercent: 10 },
  { name: 'trajectory-long-path', maxP95RegressionPercent: 10 },
  { name: 'agent-checkpoint', maxP95RegressionPercent: 15 },
];
