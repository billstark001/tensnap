import type { SimulatorSession } from '@tensnap/js/runtime';
import type {
  ProtocolEncoding,
  ProtocolValidationLevel,
  SimulatorToRendererMessage,
} from '@tensnap/protocol';
import type { BrowserBenchmarkCase } from '../browser-types';
import type { BenchmarkCase } from '../browser-types';
import type { BrowserBenchmarkRunOptions, ResolvedBrowserBenchmarkRunOptions } from '../browser-types';

/** Where an experiment executes. `ws` always means a real loopback WebSocket. */
export type BenchmarkSuite = 'node' | 'ws' | 'browser';
export type BenchmarkConfig = Record<string, unknown>;
export type BenchmarkWorkloadKind = 'protocol' | 'node' | 'browser' | 'external-process' | 'external-browser';
export type BenchmarkCategory = 'publication' | 'core' | 'snapshot' | 'renderer' | 'comparison' | 'system';

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

/**
 * A process owned by a framework outside the TypeScript workspace.  The
 * command is deliberately argv-based: no shell is involved and a manifest
 * records exactly what was executed.
 */
export interface ExternalCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface ExternalProcessContext {
  readonly repositoryRoot: string;
  readonly replicate: number;
  readonly warmupActions: number;
  readonly measuredActions: number;
}

export interface ExternalBrowserContext extends ExternalProcessContext {
  /** Available loopback port selected for this replicate's external server. */
  readonly port: number;
}

/** The final JSON object emitted by an external framework on stdout. */
export interface ExternalBenchmarkResult {
  readonly schemaVersion: 1;
  readonly timingsMs: readonly number[];
  readonly metrics?: Readonly<Record<string, number | readonly number[]>>;
  readonly state?: unknown;
  readonly expectedState?: unknown;
  readonly correctness?: {
    readonly valid: boolean;
    readonly actionCount: number;
    readonly state?: unknown;
    readonly expectedState?: unknown;
  };
  /** Optional stage timestamps/durations, e.g. modelMs and actionToFrameMs. */
  readonly stagesMs?: Readonly<Record<string, number | readonly number[]>>;
  /** Framework/interpreter versions captured by the adapter, not inferred by the harness. */
  readonly runtime?: Readonly<Record<string, string>>;
}

/** A headless system benchmark whose result is a schema-v1 JSON line. */
export interface ExternalProcessBenchmarkWorkload<TConfig extends BenchmarkConfig = BenchmarkConfig>
  extends BenchmarkWorkloadBase<TConfig> {
  readonly kind: 'external-process';
  createExternalCommand(config: TConfig, context: ExternalProcessContext): ExternalCommand;
  /** Validate framework-independent invariants in the external JSON result. */
  validateExternalResult?(config: TConfig, result: ExternalBenchmarkResult, context: ExternalProcessContext): void;
}

export interface ExternalBrowserAction {
  /** A Playwright selector for one deterministic model step. */
  readonly selector: string;
  /** Maximum time to wait for the post-render revision after each click. */
  readonly timeoutMs?: number;
}

/** A browser-visible value owned by the benchmark subject, not the harness. */
export interface ExternalBrowserDomSignal {
  readonly selector: string;
  /** Read this attribute; omitted means textContent. */
  readonly attribute?: string;
}

export interface ExternalBrowserStateOracle {
  /** Monotonic integer updated after the framework has committed the visible state. */
  readonly revision: ExternalBrowserDomSignal;
  /** JSON-encoded canonical model/renderer state for semantic verification. */
  readonly state: ExternalBrowserDomSignal;
}

export interface ExternalBrowserObservation {
  readonly initialRevision: number;
  readonly finalRevision: number;
  readonly initialState: unknown;
  readonly finalState: unknown;
}

export interface ExternalBrowserSpec {
  readonly server: ExternalCommand;
  /** Repository-relative immutable environment files checked before launch. */
  readonly environmentLocks?: Readonly<Record<string, string>>;
  readonly url: string;
  readonly readySelector: string;
  readonly action: ExternalBrowserAction;
  /** Required for a comparable action-to-render-complete measurement. */
  readonly stateOracle?: ExternalBrowserStateOracle;
  /**
   * Screenshot checkpoints are written outside the timed interval. A
   * reference hash makes visual regressions a hard correctness failure.
   */
  readonly visualOracle?: {
    readonly checkpointActions: readonly number[];
    readonly referenceSha256?: Readonly<Record<string, string>>;
  };
  /** Use the production benchmark Web host against an external simulator WS. */
  readonly tensnapHarness?: {
    readonly workloadId: string;
    readonly config: BenchmarkConfig;
    readonly endpoint: string;
    readonly encoding: ProtocolEncoding;
    readonly validation: ProtocolValidationLevel;
  };
}

/** A browser-driven external system, such as Mesa/Solara or WGLMakie. */
export interface ExternalBrowserBenchmarkWorkload<TConfig extends BenchmarkConfig = BenchmarkConfig>
  extends BenchmarkWorkloadBase<TConfig> {
  readonly kind: 'external-browser';
  createExternalBrowserSpec(config: TConfig, context: ExternalBrowserContext): ExternalBrowserSpec;
  /**
   * Convert framework-specific state into an independently checkable canonical
   * contract. Returning equal state/expectedState values is permitted only
   * after this callback has validated all declared invariants.
   */
  validateExternalBrowserObservation?(
    config: TConfig,
    observation: ExternalBrowserObservation,
    context: ExternalProcessContext,
  ): { readonly state: unknown; readonly expectedState: unknown };
}

export type BenchmarkWorkload<TConfig extends BenchmarkConfig = BenchmarkConfig> =
  | ProtocolBenchmarkWorkload<TConfig>
  | NodeBenchmarkWorkload<TConfig>
  | BrowserBenchmarkWorkload<TConfig>
  | ExternalProcessBenchmarkWorkload<TConfig>
  | ExternalBrowserBenchmarkWorkload<TConfig>;

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
  /** Submission profiles require a clean, identifiable implementation. */
  readonly requireCleanGit?: boolean;
  /** Publication runs always use a fresh process for every replicate. */
  readonly processIsolation?: 'required' | 'off';
  /** Randomly permute systems inside each replicate block. */
  readonly randomizedBlocks?: boolean;
  readonly comparisons?: readonly BenchmarkComparison[];
  readonly workloads: readonly BenchmarkProfileWorkload[];
}

export interface BenchmarkProfileWorkload {
  /** Stable identifier used by comparison declarations and artifact plans. */
  readonly id?: string;
  /** Human-readable implementation/system label. */
  readonly system?: string;
  /** Override profile defaults when a system exposes a different trial unit. */
  readonly warmupActions?: number;
  /** Override profile defaults when a system exposes a different trial unit. */
  readonly measuredActions?: number;
  /** Browser scheduling for this workload; omitted values use the harness defaults. */
  readonly browserOptions?: BrowserBenchmarkRunOptions;
  /** Metric used in the primary report and paired comparison. */
  readonly primaryMetric?: string;
  /** Renderer-visible functionality included in this condition. */
  readonly featureLevel?: string;
  /** Publication-facing independent variables such as agent/change counts. */
  readonly dimensions?: Readonly<Record<string, string | number | boolean>>;
  /** Conditions in the same group must produce identical canonical state per block. */
  readonly stateEquivalenceGroup?: string;
  readonly module: string;
  readonly config?: BenchmarkConfig;
}

export interface BenchmarkComparison {
  readonly id: string;
  readonly baseline: string;
  readonly treatments: readonly string[];
  /** `cycle`, a metric name, or a stage name. Defaults to each run's primary metric. */
  readonly metric?: string;
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
  /** The randomized block shared by all systems for a paired replicate. */
  readonly block: number;
  readonly timingsMs: readonly number[];
  readonly metrics: Readonly<Record<string, readonly number[]>>;
  readonly messageCounts: Readonly<Record<string, number>>;
  readonly wireBytes: BenchmarkWireBytes;
  readonly correctness: BenchmarkCorrectness;
  readonly process: {
    readonly isolated: boolean;
    readonly wallMs: number;
    readonly userCpuMs: number | null;
    readonly systemCpuMs: number | null;
    readonly maxRssBytes: number | null;
  };
  readonly stagesMs?: Readonly<Record<string, readonly number[]>>;
  readonly visual?: {
    readonly checkpoints: Readonly<Record<string, string>>;
    /** Relative PNG paths persisted beside the manifest. */
    readonly files?: Readonly<Record<string, string>>;
    /** Harness-private source data; stripped before manifest/raw-sample output. */
    readonly inlinePngBase64?: Readonly<Record<string, string>>;
  };
  readonly runtime?: Readonly<Record<string, string>>;
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
  readonly stages: Readonly<Record<string, DistributionSummary>>;
  readonly wireBytes: BenchmarkWireBytes;
  readonly messageCounts: Readonly<Record<string, number>>;
}

export interface PairedComparisonSummary {
  readonly id: string;
  readonly metric: string;
  readonly suite: BenchmarkSuite;
  readonly baseline: string;
  readonly treatment: string;
  readonly pairs: number;
  /** treatment / baseline. Values below 1 favour the treatment. */
  readonly medianRatio: number;
  readonly bootstrapMedianRatioCi95: readonly [number, number];
  /** treatment - baseline, in milliseconds. */
  readonly medianDifferenceMs: number;
  readonly bootstrapMedianDifferenceCi95Ms: readonly [number, number];
}

export interface BenchmarkRun {
  readonly id: string;
  /** Profile-level identity, retained when several systems share one adapter module. */
  readonly profileWorkloadId?: string;
  /** Human-readable profile-level system label. */
  readonly system?: string;
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
    readonly processIsolated: boolean;
    readonly primaryMetric: string;
    readonly featureLevel?: string;
    readonly dimensions?: Readonly<Record<string, string | number | boolean>>;
    readonly stateEquivalenceGroup?: string;
    readonly browser?: {
      readonly name: 'chromium';
      readonly version: string;
      readonly viewport: { readonly width: number; readonly height: number; readonly deviceScaleFactor: number };
      readonly headless: true;
      /** Resolved scheduling policy used for this browser run. */
      readonly runOptions?: ResolvedBrowserBenchmarkRunOptions;
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
  readonly comparisons: readonly PairedComparisonSummary[];
  readonly integrity: {
    readonly profileSha256: string;
    readonly expectedRunIds: readonly string[];
    readonly samplesSha256: string | null;
    /** Checksums for every derived publication artifact. */
    readonly filesSha256?: Readonly<Record<string, string>>;
  };
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
