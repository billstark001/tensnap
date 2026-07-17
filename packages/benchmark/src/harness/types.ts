import type { SimulatorSession } from '@tensnap/js/runtime';
import type {
  ProtocolEncoding,
  ProtocolValidationLevel,
  SimulatorToRendererMessage,
} from '@tensnap/protocol';
import type { BrowserBenchmarkCase } from '../browser-types';
import type { BenchmarkCase } from '../browser-types';

/** Where an experiment executes. `ws` always means a real loopback WebSocket. */
export type BenchmarkSuite = 'node' | 'ws' | 'browser';
export type BenchmarkConfig = Record<string, unknown>;
export type BenchmarkWorkloadKind = 'protocol' | 'node' | 'browser';
export type BenchmarkCategory = 'publication' | 'core' | 'snapshot' | 'renderer' | 'comparison';

interface BenchmarkWorkloadBase<TConfig extends BenchmarkConfig = BenchmarkConfig> {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly version: 1;
  readonly kind: BenchmarkWorkloadKind;
  readonly category: BenchmarkCategory;
  readonly description: string;
  readonly supportedSuites: readonly BenchmarkSuite[];
  resolveConfig(overrides?: Partial<TConfig>): TConfig;
}

/**
 * A production protocol path. This is the only workload type permitted to
 * enter the simulator, codec, and WebSocket runners.
 */
export interface ProtocolBenchmarkWorkload<TConfig extends BenchmarkConfig = BenchmarkConfig>
  extends BenchmarkWorkloadBase<TConfig> {
  readonly kind: 'protocol';
  readonly protocolVersion: '0.3';
  readonly modelId: string;
  readonly actionId: string;
  readonly actionContinuous: boolean;
  createSession(config: TConfig): SimulatorSession;
  createSemanticValidator(config: TConfig): BenchmarkSemanticValidator;
  expectedState(config: TConfig, actionCount: number): unknown;
  createBrowserCase?(options: ProtocolBrowserCaseOptions<TConfig>): BenchmarkCase;
}

/** A local, deterministic microbenchmark for a renderer-core or archive path. */
export interface NodeBenchmarkWorkload<TConfig extends BenchmarkConfig = BenchmarkConfig>
  extends BenchmarkWorkloadBase<TConfig> {
  readonly kind: 'node';
  createNodeCase(config: TConfig): NodeBenchmarkCase;
}

/** A deterministic browser-only benchmark, including renderer controls. */
export interface BrowserBenchmarkWorkload<TConfig extends BenchmarkConfig = BenchmarkConfig>
  extends BenchmarkWorkloadBase<TConfig> {
  readonly kind: 'browser';
  createBrowserCase(options: BrowserCaseOptions<TConfig>): BrowserBenchmarkCase;
}

export type BenchmarkWorkload<TConfig extends BenchmarkConfig = BenchmarkConfig> =
  | ProtocolBenchmarkWorkload<TConfig>
  | NodeBenchmarkWorkload<TConfig>
  | BrowserBenchmarkWorkload<TConfig>;

export interface ProtocolBrowserCaseOptions<TConfig extends BenchmarkConfig = BenchmarkConfig> {
  config: TConfig;
  endpoint: string;
  encoding: ProtocolEncoding;
  validation: ProtocolValidationLevel;
}

export interface BrowserCaseOptions<TConfig extends BenchmarkConfig = BenchmarkConfig> {
  config: TConfig;
}

export interface NodeBenchmarkCase {
  /** Perform exactly one deterministic measured operation. */
  run(iteration: number): NodeBenchmarkIteration | Promise<NodeBenchmarkIteration>;
  /** Renderer-visible state after all warmup and measured operations. */
  snapshot(): unknown;
  /** Independent expected state for semantic verification. */
  expectedState(iterations: number): unknown;
}

export interface NodeBenchmarkIteration {
  /** Per-iteration quantities such as archive byte length, outside wall-clock timing. */
  readonly metrics?: Readonly<Record<string, number>>;
}

export interface BenchmarkSemanticValidator {
  observe(message: SimulatorToRendererMessage): void;
  assert(actionCount: number): void;
  snapshot(): unknown;
}

export interface BenchmarkProfile {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly description: string;
  readonly suites: readonly BenchmarkSuite[];
  readonly repetitions: number;
  readonly warmupActions: number;
  readonly measuredActions: number;
  readonly encodings: readonly ProtocolEncoding[];
  readonly validation: readonly ProtocolValidationLevel[];
  readonly workloads: readonly BenchmarkProfileWorkload[];
}

export interface BenchmarkProfileWorkload {
  readonly module: string;
  readonly config?: BenchmarkConfig;
}

export interface BenchmarkWireBytes {
  readonly rendererToSimulator: number;
  readonly simulatorToRenderer: number;
}

export interface BenchmarkCorrectness {
  readonly valid: boolean;
  readonly actionCount: number;
  readonly stateHash: string;
  readonly expectedStateHash: string;
  readonly error?: string;
}

export interface BenchmarkReplicate {
  readonly index: number;
  readonly timingsMs: readonly number[];
  readonly metrics: Readonly<Record<string, readonly number[]>>;
  readonly messageCounts: Readonly<Record<string, number>>;
  readonly wireBytes: BenchmarkWireBytes;
  readonly correctness: BenchmarkCorrectness;
}

export interface DistributionSummary {
  readonly count: number;
  readonly meanMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly madMs: number;
  readonly bootstrapMedianCi95Ms: readonly [number, number];
}

export interface BenchmarkRunSummary {
  readonly cycle: DistributionSummary;
  readonly replicateMediansMs: readonly number[];
  readonly metrics: Readonly<Record<string, DistributionSummary>>;
  readonly wireBytes: BenchmarkWireBytes;
  readonly messageCounts: Readonly<Record<string, number>>;
}

export interface BenchmarkRun {
  readonly suite: BenchmarkSuite;
  readonly workload: {
    readonly id: string;
    readonly version: number;
    readonly kind: BenchmarkWorkloadKind;
    readonly category: BenchmarkCategory;
    readonly protocolVersion?: string;
    readonly module: string;
    readonly config: BenchmarkConfig;
    readonly configHash: string;
  };
  readonly execution: {
    readonly encoding?: ProtocolEncoding;
    readonly validation?: ProtocolValidationLevel;
    readonly warmupActions: number;
    readonly measuredActions: number;
    readonly repetitions: number;
    readonly processIsolated: false;
    readonly browser?: {
      readonly name: 'chromium';
      readonly version: string;
      readonly viewport: { readonly width: number; readonly height: number; readonly deviceScaleFactor: number };
      readonly headless: true;
    };
  };
  readonly samples: readonly BenchmarkReplicate[];
  readonly summary: BenchmarkRunSummary;
}

export interface BenchmarkArtifact {
  readonly schemaVersion: 2;
  readonly generatedAt: string;
  readonly profile: BenchmarkProfile;
  readonly harness: {
    readonly package: '@tensnap/benchmark';
    readonly version: string;
    readonly gitSha: string | null;
  };
  readonly implementation: {
    readonly gitSha: string | null;
    readonly dirty: boolean | null;
    readonly lockfileSha256: string | null;
  };
  readonly environment: BenchmarkEnvironment;
  readonly runs: readonly BenchmarkRun[];
}

export interface BenchmarkEnvironment {
  readonly os: string;
  readonly release: string;
  readonly arch: string;
  readonly cpu: readonly { readonly model: string; readonly speedMHz: number }[];
  readonly memoryBytes: number;
  readonly node: string;
  readonly v8: string;
  readonly pnpmUserAgent: string | null;
}
