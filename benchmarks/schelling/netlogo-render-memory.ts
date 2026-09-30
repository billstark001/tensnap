import type {
  BenchmarkConfig,
  ExternalBenchmarkResult,
  ExternalProcessBenchmarkWorkload,
} from '@tensnap/benchmark/harness';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

interface NetLogoMemoryRenderConfig extends BenchmarkConfig {
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  environmentLocks: Record<string, string>;
  seed: number;
  netlogoVersion: string;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value;
}

function resolveConfig(overrides: Partial<NetLogoMemoryRenderConfig>): NetLogoMemoryRenderConfig {
  if (!Array.isArray(overrides.args) || overrides.args.some((value) => typeof value !== 'string')) {
    throw new Error('NetLogo in-memory render args must be a string array.');
  }
  if (!overrides.environmentLocks || Object.keys(overrides.environmentLocks).length === 0) {
    throw new Error('NetLogo in-memory render benchmark requires immutable environment locks.');
  }
  if (!Number.isInteger(overrides.seed)) throw new Error('NetLogo render seed must be an integer.');
  return {
    executable: requiredString(overrides.executable, 'executable'),
    args: [...overrides.args],
    cwd: requiredString(overrides.cwd, 'cwd'),
    ...(overrides.env ? { env: overrides.env } : {}),
    ...(overrides.timeoutMs ? { timeoutMs: overrides.timeoutMs } : {}),
    environmentLocks: { ...overrides.environmentLocks },
    seed: overrides.seed!,
    netlogoVersion: requiredString(overrides.netlogoVersion, 'netlogoVersion'),
  };
}

function interpolate(
  value: string,
  config: NetLogoMemoryRenderConfig,
  root: string,
  replicate: number,
  warmupActions: number,
  measuredActions: number,
): string {
  return value
    .split('{repositoryRoot}').join(root)
    .split('{seed}').join(String(config.seed + replicate))
    .split('{replicate}').join(String(replicate))
    .split('{warmupActions}').join(String(warmupActions))
    .split('{measuredActions}').join(String(measuredActions));
}

function finiteSeries(result: ExternalBenchmarkResult, name: string, count: number): void {
  const value = result.stagesMs?.[name];
  if (!Array.isArray(value) || value.length !== count || value.some((item) => !Number.isFinite(item) || item < 0)) {
    throw new Error(`NetLogo ${name} must contain ${count} finite non-negative timings.`);
  }
}

export const workload: ExternalProcessBenchmarkWorkload<NetLogoMemoryRenderConfig> = {
  schemaVersion: 2,
  id: 'system.schelling.netlogo-render-memory',
  version: 1,
  kind: 'external-process',
  category: 'system',
  description: 'NetLogo 7 headless in-memory view rasterization with exact patch-state validation and an untimed PNG checkpoint.',
  supportedSuites: ['node'],
  resolveConfig,
  createExternalCommand(config, context) {
    const expand = (value: string) => interpolate(
      value,
      config,
      context.repositoryRoot,
      context.replicate,
      context.warmupActions,
      context.measuredActions,
    );
    return {
      executable: expand(config.executable),
      args: config.args.map(expand),
      cwd: path.resolve(context.repositoryRoot, expand(config.cwd)),
      env: Object.fromEntries(Object.entries(config.env ?? {}).map(([name, value]) => [name, expand(value)])),
      timeoutMs: config.timeoutMs,
    };
  },
  validateExternalResult(config, result, context) {
    for (const [relativePath, expectedHash] of Object.entries(config.environmentLocks)) {
      const actualHash = createHash('sha256')
        .update(readFileSync(path.resolve(context.repositoryRoot, relativePath)))
        .digest('hex');
      if (actualHash !== expectedHash) throw new Error(`NetLogo environment lock ${relativePath} does not match its SHA-256.`);
    }
    if (result.timingsMs.length !== context.measuredActions) {
      throw new Error(`NetLogo emitted ${result.timingsMs.length} timings; expected ${context.measuredActions}.`);
    }
    if (result.correctness?.actionCount !== context.warmupActions + context.measuredActions) {
      throw new Error('NetLogo action count does not include the complete warmup/measured sequence.');
    }
    if (result.runtime?.netlogo !== config.netlogoVersion) {
      throw new Error(`NetLogo runtime must be ${config.netlogoVersion}.`);
    }
    if ((result.state as { instrumentation?: unknown } | undefined)?.instrumentation !== 'headless-in-memory-view') {
      throw new Error('NetLogo render adapter did not declare headless-in-memory-view instrumentation.');
    }
    if (result.metrics?.patches !== 2_500) throw new Error('NetLogo render benchmark must validate 2,500 patches.');
    if (!result.visual?.checkpoints.final || !result.visual.inlinePngBase64?.final) {
      throw new Error('NetLogo render benchmark must retain a hashed final PNG.');
    }
    finiteSeries(result, 'modelTransitionMs', context.measuredActions);
    finiteSeries(result, 'patchRecolorMs', context.measuredActions);
    finiteSeries(result, 'viewRasterizationMs', context.measuredActions);
  },
};

export default workload;
