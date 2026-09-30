import type {
  BenchmarkConfig,
  ExternalBenchmarkResult,
  ExternalProcessBenchmarkWorkload,
} from '@tensnap/benchmark/harness';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

interface Range {
  min?: number;
  max?: number;
}

interface SchellingExternalConfig extends BenchmarkConfig {
  executable: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  /** Paths and immutable digests recorded and checked before publication. */
  environmentLocks?: Record<string, string>;
  /** The mode and invariant bounds common to every implementation. */
  expected: {
    mode: 'steady' | 'convergence';
    actionCount: number;
    metrics: Record<string, Range>;
    state?: Record<string, Range | string | number | boolean>;
  };
  seed: number;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value;
}

function resolveConfig(overrides: Partial<SchellingExternalConfig>): SchellingExternalConfig {
  if (!Array.isArray(overrides.args) || overrides.args.some((value) => typeof value !== 'string')) {
    throw new Error('external Schelling args must be an argv string array.');
  }
  const expected = overrides.expected;
  if (!expected || (expected.mode !== 'steady' && expected.mode !== 'convergence')) {
    throw new Error('external Schelling expected.mode must be steady or convergence.');
  }
  const seed = overrides.seed;
  if (typeof seed !== 'number' || !Number.isInteger(seed)) throw new Error('external Schelling seed must be an integer.');
  return {
    executable: requireString(overrides.executable, 'executable'),
    args: [...overrides.args],
    ...(overrides.cwd ? { cwd: overrides.cwd } : {}),
    ...(overrides.env ? { env: overrides.env } : {}),
    ...(overrides.timeoutMs ? { timeoutMs: overrides.timeoutMs } : {}),
    ...(overrides.environmentLocks ? { environmentLocks: overrides.environmentLocks } : {}),
    expected,
    seed,
  };
}

function interpolate(value: string, config: SchellingExternalConfig, repositoryRoot: string, replicate: number): string {
  return value
    .split('{repositoryRoot}').join(repositoryRoot)
    .split('{seed}').join(String(config.seed + replicate))
    .split('{replicate}').join(String(replicate));
}

function valueInRange(value: unknown, range: Range, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`External result ${name} must be a finite number.`);
  if (range.min !== undefined && value < range.min) throw new Error(`External result ${name}=${value} is below ${range.min}.`);
  if (range.max !== undefined && value > range.max) throw new Error(`External result ${name}=${value} is above ${range.max}.`);
}

export const workload: ExternalProcessBenchmarkWorkload<SchellingExternalConfig> = {
  schemaVersion: 2,
  id: 'system.schelling.external-process',
  version: 1,
  kind: 'external-process',
  category: 'system',
  description: 'Schema-v1 JSON adapter for a process-owned Schelling model implementation.',
  supportedSuites: ['node'],
  resolveConfig,
  createExternalCommand(config, context) {
    return {
      executable: interpolate(config.executable, config, context.repositoryRoot, context.replicate),
      args: config.args.map((value) => interpolate(value, config, context.repositoryRoot, context.replicate)),
      cwd: config.cwd ? path.resolve(context.repositoryRoot, interpolate(config.cwd, config, context.repositoryRoot, context.replicate)) : context.repositoryRoot,
      env: Object.fromEntries(Object.entries(config.env ?? {}).map(([name, value]) => [name, interpolate(value, config, context.repositoryRoot, context.replicate)])),
      timeoutMs: config.timeoutMs,
    };
  },
  validateExternalResult(config, result: ExternalBenchmarkResult, context) {
    for (const [relativePath, expectedHash] of Object.entries(config.environmentLocks ?? {})) {
      const actualHash = createHash('sha256').update(readFileSync(path.resolve(context.repositoryRoot, relativePath))).digest('hex');
      if (actualHash !== expectedHash) throw new Error(`External environment lock ${relativePath} does not match its declared SHA-256.`);
    }
    if (result.timingsMs.length !== config.expected.actionCount) {
      throw new Error(`External Schelling result has ${result.timingsMs.length} timings; expected ${config.expected.actionCount}.`);
    }
    const state = result.state as Record<string, unknown> | undefined;
    if (!state || state.mode !== config.expected.mode) throw new Error(`External Schelling result did not report mode=${config.expected.mode}.`);
    for (const [name, range] of Object.entries(config.expected.metrics)) {
      const value = result.metrics?.[name];
      valueInRange(Array.isArray(value) ? value[0] : value, range, `metrics.${name}`);
    }
    for (const [name, expected] of Object.entries(config.expected.state ?? {})) {
      const actual = state[name];
      if (typeof expected === 'object' && expected !== null) valueInRange(actual, expected as Range, `state.${name}`);
      else if (actual !== expected) throw new Error(`External Schelling state.${name} expected ${String(expected)}, received ${String(actual)}.`);
    }
  },
};

export default workload;
