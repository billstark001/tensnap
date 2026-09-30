import canvas2d from './comparisons/random-walk/canvas2d';
import leafer from './comparisons/random-walk/leafer';
import tensnapRenderer from './comparisons/random-walk/tensnap';
import { browserWorkload as externalSchellingTenSnapWeb } from './schelling/tensnap-web';
import coreTrace from './v0.3/core-trace/benchmark';
import randomWalk from './v0.3/random-walk/benchmark';
import snapshotRestore from './v0.3/snapshot-restore/benchmark';
import stateSync from './v0.3/state-sync/benchmark';
import type { BenchmarkWorkload } from '@tensnap/benchmark/harness';

const workloads = new Map<string, BenchmarkWorkload>([
  [randomWalk.id, randomWalk],
  [coreTrace.id, coreTrace],
  [stateSync.id, stateSync],
  [snapshotRestore.id, snapshotRestore],
  [canvas2d.id, canvas2d],
  [leafer.id, leafer],
  [tensnapRenderer.id, tensnapRenderer],
  [externalSchellingTenSnapWeb.id, externalSchellingTenSnapWeb],
]);

export function getBenchmarkWorkload(id: string): BenchmarkWorkload {
  const workload = workloads.get(id);
  if (!workload) throw new Error(`No benchmark workload is registered for ${id}.`);
  return workload;
}

export function listBenchmarkWorkloads(): readonly BenchmarkWorkload[] {
  return [...workloads.values()];
}
