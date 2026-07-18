import type { BenchmarkConfig, ExternalBrowserBenchmarkWorkload } from '@tensnap/benchmark/harness';
import path from 'node:path';

interface ExternalBrowserConfig extends BenchmarkConfig {
  executable: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  environmentLocks?: Record<string, string>;
  url: string;
  readySelector: string;
  actionSelector: string;
  actionTimeoutMs?: number;
  checkpointActions?: number[];
  referenceSha256?: Record<string, string>;
  seed: number;
}

function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value;
}

function resolveConfig(overrides: Partial<ExternalBrowserConfig>): ExternalBrowserConfig {
  if (!Array.isArray(overrides.args) || overrides.args.some((value) => typeof value !== 'string')) throw new Error('args must be a string array.');
  const seed = overrides.seed;
  if (typeof seed !== 'number' || !Number.isInteger(seed)) throw new Error('seed must be an integer.');
  return {
    executable: string(overrides.executable, 'executable'), args: [...overrides.args],
    ...(overrides.cwd ? { cwd: overrides.cwd } : {}), ...(overrides.env ? { env: overrides.env } : {}),
    ...(overrides.timeoutMs ? { timeoutMs: overrides.timeoutMs } : {}),
    ...(overrides.environmentLocks ? { environmentLocks: overrides.environmentLocks } : {}),
    url: string(overrides.url, 'url'), readySelector: string(overrides.readySelector, 'readySelector'), actionSelector: string(overrides.actionSelector, 'actionSelector'),
    ...(overrides.actionTimeoutMs ? { actionTimeoutMs: overrides.actionTimeoutMs } : {}),
    ...(overrides.checkpointActions ? { checkpointActions: overrides.checkpointActions } : {}),
    ...(overrides.referenceSha256 ? { referenceSha256: overrides.referenceSha256 } : {}),
    seed,
  };
}

function interpolate(value: string, config: ExternalBrowserConfig, root: string, replicate: number): string {
  return value.split('{repositoryRoot}').join(root).split('{seed}').join(String(config.seed + replicate)).split('{replicate}').join(String(replicate));
}

export const workload: ExternalBrowserBenchmarkWorkload<ExternalBrowserConfig> = {
  schemaVersion: 2,
  id: 'system.schelling.external-browser',
  version: 1,
  kind: 'external-browser',
  category: 'system',
  description: 'Process-owned browser system benchmark with screenshot frame checkpoints.',
  supportedSuites: ['browser'],
  resolveConfig,
  createExternalBrowserSpec(config, context) {
    const expand = (value: string) => interpolate(value, config, context.repositoryRoot, context.replicate);
    return {
      server: {
        executable: expand(config.executable),
        args: config.args.map(expand),
        cwd: config.cwd ? path.resolve(context.repositoryRoot, expand(config.cwd)) : context.repositoryRoot,
        env: Object.fromEntries(Object.entries(config.env ?? {}).map(([key, value]) => [key, expand(value)])),
        timeoutMs: config.timeoutMs,
      },
      url: expand(config.url), readySelector: config.readySelector,
      action: { selector: config.actionSelector, timeoutMs: config.actionTimeoutMs },
      ...(config.checkpointActions ? { visualOracle: { checkpointActions: config.checkpointActions, ...(config.referenceSha256 ? { referenceSha256: config.referenceSha256 } : {}) } } : {}),
    };
  },
};

export default workload;
