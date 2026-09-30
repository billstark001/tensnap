import './runtime/leafer-runtime';

import { getBenchmarkWorkload } from '../../../benchmarks/registry';
import { runBrowserBenchmark } from './browser-executor';
import type { BrowserBenchmarkRunOptions } from './browser-types';
import type { ProtocolEncoding } from '@tensnap/protocol';
import type { ProtocolValidationLevel } from '@tensnap/protocol';

interface BrowserRequest {
  workloadId: string;
  config: Record<string, unknown>;
  endpoint?: string;
  encoding?: ProtocolEncoding;
  validation?: ProtocolValidationLevel;
  warmupActions: number;
  measuredActions: number;
  browserOptions?: BrowserBenchmarkRunOptions;
}

declare global {
  interface Window {
    __TENSNAP_BENCHMARK_REQUEST__?: BrowserRequest;
    __TENSNAP_BENCHMARK_RESULT__?: unknown;
  }
}

async function main(): Promise<void> {
  const request = window.__TENSNAP_BENCHMARK_REQUEST__;
  if (!request) throw new Error('Missing browser benchmark request.');
  const workload = getBenchmarkWorkload(request.workloadId);
  const root = document.getElementById('benchmark-root');
  if (!root) throw new Error('Benchmark root is missing.');
  const config = workload.resolveConfig(request.config);
  if (workload.kind === 'browser') {
    const benchmark = workload.createBrowserCase({ config });
    const stats = await runBrowserBenchmark(benchmark.case, root, request.measuredActions, request.warmupActions, request.browserOptions);
    window.__TENSNAP_BENCHMARK_RESULT__ = {
      ok: true,
      stats,
      // Model cases expose the production renderer Scenario snapshot through
      // the mounted host. Component controls keep their independent fixture
      // snapshot supplied by the workload.
      snapshot: stats.snapshot ?? benchmark.snapshot(),
      expectedState: benchmark.expectedState(request.measuredActions + request.warmupActions),
    };
    return;
  }
  if (workload.kind !== 'protocol' || !workload.createBrowserCase) {
    throw new Error(`${workload.id} does not provide a browser execution path.`);
  }
  if (!request.endpoint || !request.encoding || !request.validation) {
    throw new Error(`Protocol browser workload ${workload.id} requires endpoint, encoding, and validation.`);
  }
  const benchCase = workload.createBrowserCase({ config, endpoint: request.endpoint, encoding: request.encoding, validation: request.validation });
  const stats = await runBrowserBenchmark(benchCase, root, request.measuredActions, request.warmupActions, request.browserOptions);
  window.__TENSNAP_BENCHMARK_RESULT__ = { ok: true, stats, snapshot: stats.snapshot };
}

void main().catch((error) => {
  window.__TENSNAP_BENCHMARK_RESULT__ = {
    ok: false,
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  };
});
