import { WebSocketManagerImpl } from '@tensnap/web/transport';
import {
  createWebScenarioCase,
  type BenchmarkConfig,
  type BrowserBenchmarkCase,
  type BrowserBenchmarkWorkload,
} from '@tensnap/benchmark/harness';

interface TenSnapWebConfig extends BenchmarkConfig {
  executable: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  environmentLocks?: Record<string, string>;
  endpoint: string;
  encoding?: 'json' | 'msgpack';
  width?: number;
  height?: number;
  seed: number;
}

export function resolveTenSnapWebConfig(overrides: Partial<TenSnapWebConfig>): TenSnapWebConfig {
  if (typeof overrides.executable !== 'string' || !Array.isArray(overrides.args) || overrides.args.some((value) => typeof value !== 'string')) {
    throw new Error('TenSnap external browser requires executable and argv args.');
  }
  if (typeof overrides.endpoint !== 'string' || !overrides.endpoint.startsWith('ws://')) throw new Error('endpoint must be ws:// URL.');
  if (typeof overrides.seed !== 'number' || !Number.isInteger(overrides.seed)) throw new Error('seed must be an integer.');
  return {
    executable: overrides.executable, args: [...overrides.args], endpoint: overrides.endpoint, seed: overrides.seed, encoding: overrides.encoding ?? 'json',
    ...(overrides.cwd ? { cwd: overrides.cwd } : {}), ...(overrides.env ? { env: overrides.env } : {}), ...(overrides.timeoutMs ? { timeoutMs: overrides.timeoutMs } : {}),
    ...(overrides.environmentLocks ? { environmentLocks: overrides.environmentLocks } : {}),
    width: overrides.width ?? 900, height: overrides.height ?? 700,
  };
}

/** Browser-case registration used only by the production browser-runner page. */
export const browserWorkload: BrowserBenchmarkWorkload<TenSnapWebConfig> = {
  schemaVersion: 2,
  id: 'system.schelling.tensnap-web-client',
  version: 1,
  kind: 'browser',
  category: 'system',
  description: 'Production TenSnap Web host connected to an external Schelling simulator.',
  supportedSuites: ['browser'],
  resolveConfig: resolveTenSnapWebConfig,
  createBrowserCase({ config }): BrowserBenchmarkCase {
    return {
      case: createWebScenarioCase({
        name: 'External Schelling TenSnap Web', category: 'tensnap', variant: 'external-simulator', config,
        width: config.width ?? 900, height: config.height ?? 700,
        createTransport: () => new WebSocketManagerImpl('benchmark-schelling', config.endpoint, config.encoding === 'msgpack', 'strict'),
      }),
      snapshot: () => ({ endpoint: config.endpoint }),
      expectedState: () => ({ endpoint: config.endpoint }),
    };
  },
};

export type { TenSnapWebConfig };
export default browserWorkload;
