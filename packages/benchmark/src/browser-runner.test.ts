import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ workload: vi.fn(), execute: vi.fn() }));
vi.mock('./runtime/leafer-runtime', () => ({}));
vi.mock('../../../benchmarks/registry', () => ({ getBenchmarkWorkload: mocks.workload }));
vi.mock('./browser-executor', () => ({ runBrowserBenchmark: mocks.execute }));

afterEach(() => {
  delete window.__TENSNAP_BENCHMARK_REQUEST__;
  delete window.__TENSNAP_BENCHMARK_RESULT__;
  document.body.replaceChildren();
  vi.resetModules();
});

it.each(['browser', 'protocol'])(
  'propagates validation through the %s workload branch',
  async (kind) => {
    document.body.innerHTML = '<div id="benchmark-root"></div>';
    const createBrowserCase = vi.fn(() =>
      kind === 'browser' ? { case: {}, snapshot: () => ({}), expectedState: () => ({}) } : {},
    );
    mocks.workload.mockReturnValue({
      kind,
      resolveConfig: (config: unknown) => config,
      createBrowserCase,
    });
    mocks.execute.mockResolvedValue({ snapshot: {} });
    window.__TENSNAP_BENCHMARK_REQUEST__ = {
      workloadId: 'fixture',
      config: {},
      endpoint: 'ws://localhost:1',
      encoding: 'json',
      validation: 'error',
      warmupActions: 1,
      measuredActions: 2,
    };
    await import('./browser-runner');
    await vi.waitFor(() => expect(window.__TENSNAP_BENCHMARK_RESULT__).toBeDefined());
    expect(createBrowserCase).toHaveBeenCalledWith(
      expect.objectContaining({ validation: 'error' }),
    );
    expect(window.__TENSNAP_BENCHMARK_RESULT__).toEqual(expect.objectContaining({ ok: true }));
  },
);
