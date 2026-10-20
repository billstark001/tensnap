import { createRequire } from 'node:module';
import path from 'node:path';
import type {
  BenchmarkConfig,
  ExternalBenchmarkResult,
  ExternalProcessBenchmarkWorkload,
} from '../../../packages/benchmark/src/harness/types';

export interface AgentBenchmarkConfig extends BenchmarkConfig {
  case: 'control' | 'query' | 'collection';
  control: 'cli-single' | 'cli-batch' | 'http-batch';
  query: 'snapshot' | 'monitor' | 'agent' | 'neighbors' | 'cell';
  transport: 'cli' | 'http';
  collection: 'none' | 'archive' | 'full-history' | 'rolling';
  gridSize: number;
  steps: number;
  prepSteps: number;
  agentCount: number;
  changedAgents: number;
  retainedFrames: number;
  seed: number;
}

export function resolveConfig(input: Partial<AgentBenchmarkConfig> = {}): AgentBenchmarkConfig {
  const result: AgentBenchmarkConfig = {
    case: 'control',
    control: 'cli-batch',
    query: 'monitor',
    transport: 'cli',
    collection: 'none',
    gridSize: 50,
    steps: 495,
    prepSteps: 5,
    agentCount: 1_000,
    changedAgents: 100,
    retainedFrames: 128,
    seed: 20260718,
    ...input,
  };
  for (const key of Object.keys(input))
    if (!(key in result) || !Object.prototype.hasOwnProperty.call(defaultKeys, key))
      throw new Error(`Unknown agent benchmark option: ${key}`);
  const enums = {
    case: ['control', 'query', 'collection'],
    control: ['cli-single', 'cli-batch', 'http-batch'],
    query: ['snapshot', 'monitor', 'agent', 'neighbors', 'cell'],
    transport: ['cli', 'http'],
    collection: ['none', 'archive', 'full-history', 'rolling'],
  };
  for (const [key, choices] of Object.entries(enums))
    if (typeof result[key] !== 'string' || !choices.includes(result[key] as string))
      throw new Error(`Invalid ${key}: ${result[key]}`);
  for (const [key, min, max] of [
    ['gridSize', 5, 100],
    ['steps', 1, 100_000],
    ['prepSteps', 0, 500],
    ['agentCount', 1, 10_000],
    ['changedAgents', 0, result.agentCount],
    ['retainedFrames', 1, 100_000],
    ['seed', 0, 0xffffffff - 1000],
  ] as const) {
    const value = result[key];
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${key} must be an integer in [${min}, ${max}].`);
  }
  return result;
}

const defaultKeys = Object.fromEntries(
  [
    'case',
    'control',
    'query',
    'transport',
    'collection',
    'gridSize',
    'steps',
    'prepSteps',
    'agentCount',
    'changedAgents',
    'retainedFrames',
    'seed',
  ].map((key) => [key, true]),
);

export function validateResult(
  config: AgentBenchmarkConfig,
  result: ExternalBenchmarkResult,
  measuredActions: number,
): void {
  if (
    result.retainSemanticEvidence !== true ||
    !result.measurementEvidence ||
    !result.correctness?.state ||
    !result.correctness.expectedState ||
    result.correctness.valid !== true
  )
    throw new Error('Agent benchmark requires retained independent semantic evidence.');
  if (
    result.timingsMs.length !== measuredActions ||
    result.timingsMs.some((n) => !Number.isFinite(n) || n <= 0)
  )
    throw new Error('Agent benchmark has an invalid measurement series.');
  if (result.correctness.actionCount !== measuredActions)
    throw new Error('Incorrect trial operation count.');
  for (const name of [
    'daemonMaxRssBytes',
    'hostMaxRssBytes',
    'startupReadyMs',
    'contextDiskBytes',
  ]) {
    const value = result.metrics?.[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
      throw new Error(`Missing positive agent metric: ${name}`);
  }
  const state = result.correctness.state as { time?: number; succeededActions?: number };
  const expectedTime =
    config.case === 'collection'
      ? config.steps
      : config.prepSteps + (config.case === 'control' ? config.steps : 0);
  if (
    state.time !== expectedTime ||
    state.succeededActions !== (config.case === 'query' ? 0 : config.steps)
  )
    throw new Error('Agent benchmark did not reach the planned successful action boundary.');
  if (
    config.case === 'collection' &&
    config.collection !== 'none' &&
    !(
      typeof result.metrics?.recordingDiskBytes === 'number' &&
      result.metrics.recordingDiskBytes > 0
    )
  )
    throw new Error('Collection benchmark did not retain recording storage accounting.');
}

export const workload: ExternalProcessBenchmarkWorkload<AgentBenchmarkConfig> = {
  schemaVersion: 2,
  version: 1,
  id: 'system.agent-cli.v1',
  kind: 'external-process',
  category: 'system',
  supportedSuites: ['node'],
  description:
    'Public agent CLI control, bounded queries and long-history collection over real loopback WebSockets.',
  resolveConfig,
  createExternalCommand(config, context) {
    if (config.case !== 'query' && (context.warmupActions !== 0 || context.measuredActions !== 1))
      throw new Error(
        'Control/collection trial unit is one whole run: warmupActions=0, measuredActions=1.',
      );
    const root = context.repositoryRoot;
    const require = createRequire(path.join(root, 'packages/benchmark/package.json'));
    return {
      executable: process.execPath,
      args: [
        '--import',
        require.resolve('tsx'),
        path.join(root, 'benchmarks/agent/v1/run.ts'),
        JSON.stringify({
          config: { ...config, seed: config.seed + context.replicate },
          warmupActions: context.warmupActions,
          measuredActions: context.measuredActions,
        }),
      ],
      cwd: root,
      env: { TSX_TSCONFIG_PATH: path.join(root, 'packages/benchmark/tsconfig.json') },
      timeoutMs: 900_000,
    };
  },
  validateExternalResult(config, result, context) {
    validateResult(config, result, context.measuredActions);
  },
};

export default workload;
