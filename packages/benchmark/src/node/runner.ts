import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { cpus, platform, release, totalmem, arch, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import WebSocket, { type RawData } from 'ws';
import {
  createProtocolCodec,
  type AnyProtocolMessage,
  type ProtocolEncoding,
  type ProtocolValidationLevel,
  type RendererToSimulatorMessage,
  type SimulatorToRendererMessage,
} from '@tensnap/protocol';
import { createWebSocketTransportHost, normalizeWebSocketRawData } from '@tensnap/js/transport';
import type {
  BenchmarkArtifact,
  BenchmarkConfig,
  BenchmarkCorrectness,
  BenchmarkEnvironment,
  BenchmarkProfile,
  BenchmarkReplicate,
  BenchmarkRun,
  BenchmarkRunSummary,
  BenchmarkSemanticValidator,
  BenchmarkSuite,
  BenchmarkWireBytes,
  BenchmarkWorkload,
  BrowserBenchmarkWorkload,
  DistributionSummary,
  ExternalBenchmarkResult,
  ExternalBrowserBenchmarkWorkload,
  ExternalBrowserObservation,
  ExternalBrowserSpec,
  ExternalCommand,
  ExternalProcessBenchmarkWorkload,
  NodeBenchmarkWorkload,
  PairedComparisonSummary,
  ProtocolBenchmarkWorkload,
} from '../harness/types';
import { resolveBrowserBenchmarkRunOptions } from '../browser-options';
import type { ResolvedBrowserBenchmarkRunOptions } from '../browser-types';

const EMPTY_BYTES: BenchmarkWireBytes = { rendererToSimulator: 0, simulatorToRenderer: 0 };
const benchmarkRequire = createRequire(import.meta.url);

export interface ResolvedProfileWorkload {
  id: string;
  system: string;
  warmupActions: number;
  measuredActions: number;
  modulePath: string;
  workload: BenchmarkWorkload;
  config: BenchmarkConfig;
  browserOptions: ResolvedBrowserBenchmarkRunOptions;
  primaryMetric: string;
  featureLevel?: string;
  dimensions?: Readonly<Record<string, string | number | boolean>>;
  stateEquivalenceGroup?: string;
}

export interface RunProfileOptions {
  repositoryRoot: string;
  profile: BenchmarkProfile;
  workloads: readonly ResolvedProfileWorkload[];
  suites: readonly BenchmarkSuite[];
  /** Optional CLI-facing progress reporter; omitted for programmatic callers. */
  onProgress?: (message: string) => void;
  /** Zero-based blocks to execute; omitted executes the complete profile. */
  blocks?: readonly number[];
  /** Previously journaled samples used by resume/merge. */
  existingReplicates?: readonly BenchmarkJournalSample[];
  /** Persist a completed replicate before proceeding to the next target. */
  onReplicate?: (record: BenchmarkJournalSample) => void | Promise<void>;
  /** Execution identity captured before the first journal record. */
  artifactContext?: BenchmarkArtifactContext;
}

export type BenchmarkArtifactContext = Pick<BenchmarkArtifact, 'harness' | 'implementation' | 'environment'>;

export interface BenchmarkJournalHeader {
  readonly type: 'header';
  readonly schemaVersion: 1;
  readonly profile: BenchmarkProfile;
  readonly profileSha256: string;
  readonly suites: readonly BenchmarkSuite[];
  readonly implementationGitSha: string | null;
  /** Prevent resume/merge from silently combining different execution hosts. */
  readonly artifactContext: BenchmarkArtifactContext;
  readonly expectedRunIds: readonly string[];
}

export interface BenchmarkJournalSample {
  readonly type: 'sample';
  readonly runId: string;
  readonly block: number;
  readonly sample: BenchmarkReplicate;
  readonly browserVersion?: string;
}

export interface BenchmarkJournal {
  readonly header: BenchmarkJournalHeader;
  readonly samples: readonly BenchmarkJournalSample[];
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function numberOption(value: unknown, name: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}.`);
  }
  return value;
}

export function validateProfile(value: unknown): BenchmarkProfile {
  if (typeof value !== 'object' || value === null) throw new Error('Benchmark profile must be an object.');
  const profile = value as Partial<BenchmarkProfile>;
  if (profile.schemaVersion !== 2) throw new Error('Benchmark profile schemaVersion must be 2.');
  if (!profile.id || !profile.description) throw new Error('Benchmark profile requires id and description.');
  if (!Array.isArray(profile.suites) || profile.suites.length === 0 || profile.suites.some((suite) => !['node', 'ws', 'browser'].includes(suite))) {
    throw new Error('Benchmark profile suites must contain node, ws, and/or browser.');
  }
  numberOption(profile.repetitions, 'repetitions', 1);
  numberOption(profile.warmupActions, 'warmupActions', 0);
  numberOption(profile.measuredActions, 'measuredActions', 1);
  if (!Array.isArray(profile.encodings) || profile.encodings.length === 0 || profile.encodings.some((encoding) => encoding !== 'json' && encoding !== 'msgpack')) {
    throw new Error('Benchmark profile encodings must contain json and/or msgpack.');
  }
  if (!Array.isArray(profile.validation) || profile.validation.length === 0 || profile.validation.some((level) => !['off', 'warning', 'error'].includes(level))) {
    throw new Error('Benchmark profile validation must contain off, warning, and/or error.');
  }
  if (!Array.isArray(profile.workloads) || profile.workloads.length === 0 || profile.workloads.some((workload) => !workload.module)) {
    throw new Error('Benchmark profile requires at least one workload module.');
  }
  for (const workload of profile.workloads) {
    if (workload.warmupActions !== undefined) numberOption(workload.warmupActions, `workload ${workload.id ?? workload.module} warmupActions`, 0);
    if (workload.measuredActions !== undefined) numberOption(workload.measuredActions, `workload ${workload.id ?? workload.module} measuredActions`, 1);
    if (workload.primaryMetric !== undefined && (!workload.primaryMetric || typeof workload.primaryMetric !== 'string')) {
      throw new Error(`workload ${workload.id ?? workload.module} primaryMetric must be a non-empty string.`);
    }
    if (workload.featureLevel !== undefined && (!workload.featureLevel || typeof workload.featureLevel !== 'string')) {
      throw new Error(`workload ${workload.id ?? workload.module} featureLevel must be a non-empty string.`);
    }
    if (workload.dimensions !== undefined && (typeof workload.dimensions !== 'object' || workload.dimensions === null || Array.isArray(workload.dimensions))) {
      throw new Error(`workload ${workload.id ?? workload.module} dimensions must be an object.`);
    }
    if (workload.stateEquivalenceGroup !== undefined && (!workload.stateEquivalenceGroup || typeof workload.stateEquivalenceGroup !== 'string')) {
      throw new Error(`workload ${workload.id ?? workload.module} stateEquivalenceGroup must be a non-empty string.`);
    }
  }
  if (profile.processIsolation !== undefined && profile.processIsolation !== 'required' && profile.processIsolation !== 'off') {
    throw new Error('processIsolation must be required or off.');
  }
  const ids = profile.workloads.map((workload) => workload.id).filter((id): id is string => Boolean(id));
  if (new Set(ids).size !== ids.length) throw new Error('Benchmark workload ids must be unique.');
  if (profile.comparisons !== undefined) {
    if (!Array.isArray(profile.comparisons)) throw new Error('comparisons must be an array.');
    const declared = new Set(ids);
    const byId = new Map(profile.workloads.flatMap((workload) => workload.id ? [[workload.id, workload] as const] : []));
    for (const comparison of profile.comparisons) {
      if (!comparison?.id || !comparison.baseline || !Array.isArray(comparison.treatments) || comparison.treatments.length === 0) {
        throw new Error('Each comparison requires id, baseline, and treatments.');
      }
      if (comparison.metric !== undefined && (!comparison.metric || typeof comparison.metric !== 'string')) {
        throw new Error(`Comparison ${comparison.id} metric must be a non-empty string.`);
      }
      if (!declared.has(comparison.baseline) || comparison.treatments.some((id: string) => !declared.has(id))) {
        throw new Error(`Comparison ${comparison.id} refers to an undeclared workload id.`);
      }
      const baseline = byId.get(comparison.baseline)!;
      for (const treatmentId of comparison.treatments) {
        const treatment = byId.get(treatmentId)!;
        if (baseline.featureLevel !== treatment.featureLevel) throw new Error(`Comparison ${comparison.id} mixes feature levels.`);
        if (stableJson(baseline.dimensions ?? {}) !== stableJson(treatment.dimensions ?? {})) throw new Error(`Comparison ${comparison.id} mixes workload dimensions.`);
        if ((baseline.warmupActions ?? profile.warmupActions) !== (treatment.warmupActions ?? profile.warmupActions)
          || (baseline.measuredActions ?? profile.measuredActions) !== (treatment.measuredActions ?? profile.measuredActions)) {
          throw new Error(`Comparison ${comparison.id} mixes action counts.`);
        }
        if (!comparison.metric && (baseline.primaryMetric ?? 'cycle') !== (treatment.primaryMetric ?? 'cycle')) {
          throw new Error(`Comparison ${comparison.id} requires an explicit metric because primary metrics differ.`);
        }
      }
    }
  }
  return profile as BenchmarkProfile;
}

export async function loadProfileWorkloads(profilePath: string, profile: BenchmarkProfile): Promise<ResolvedProfileWorkload[]> {
  return Promise.all(profile.workloads.map(async (entry) => {
    const modulePath = path.resolve(path.dirname(profilePath), entry.module);
    const imported = await import(pathToFileURL(modulePath).href);
    const workload = (imported.default ?? imported.workload) as BenchmarkWorkload | undefined;
    if (!workload || workload.schemaVersion !== 2 || !['protocol', 'node', 'browser', 'external-process', 'external-browser'].includes(workload.kind)
      || !Array.isArray(workload.supportedSuites) || typeof workload.resolveConfig !== 'function') {
      throw new Error(`${modulePath} does not export a schema v2 benchmark workload.`);
    }
    const config = workload.resolveConfig(entry.config ?? {});
    const id = entry.id ?? `${workload.id}:${sha256(config).slice(0, 12)}`;
    return {
      id,
      system: entry.system ?? workload.id,
      warmupActions: entry.warmupActions ?? profile.warmupActions,
      measuredActions: entry.measuredActions ?? profile.measuredActions,
      modulePath,
      workload,
      config,
      browserOptions: resolveBrowserBenchmarkRunOptions(entry.browserOptions),
      primaryMetric: entry.primaryMetric ?? 'cycle',
      ...(entry.featureLevel ? { featureLevel: entry.featureLevel } : {}),
      ...(entry.dimensions ? { dimensions: entry.dimensions } : {}),
      ...(entry.stateEquivalenceGroup ? { stateEquivalenceGroup: entry.stateEquivalenceGroup } : {}),
    };
  }));
}

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

interface ProcessMeasurementStart {
  readonly wallStartedAt: number;
  readonly usage: ReturnType<typeof process.resourceUsage>;
}

function startProcessMeasurement(): ProcessMeasurementStart {
  return { wallStartedAt: nowMs(), usage: process.resourceUsage() };
}

function processMeasurement(start: ProcessMeasurementStart, isolated = false): BenchmarkReplicate['process'] {
  const usage = process.resourceUsage();
  // Node reports maxRSS in bytes on macOS and KiB on Linux/Windows.
  const maxRssBytes = platform() === 'darwin' ? usage.maxRSS : usage.maxRSS * 1024;
  return {
    isolated,
    wallMs: nowMs() - start.wallStartedAt,
    userCpuMs: (usage.userCPUTime - start.usage.userCPUTime) / 1_000,
    systemCpuMs: (usage.systemCPUTime - start.usage.systemCPUTime) / 1_000,
    // maxRSS is a process-lifetime peak and is meaningful only in a fresh
    // replicate process. Never present it as a per-replicate delta otherwise.
    maxRssBytes: isolated ? maxRssBytes : null,
  };
}

function externalWallMeasurement(start: ProcessMeasurementStart): BenchmarkReplicate['process'] {
  return { isolated: true, wallMs: nowMs() - start.wallStartedAt, userCpuMs: null, systemCpuMs: null, maxRssBytes: null };
}

function byteLength(payload: string | Uint8Array | ArrayBuffer): number {
  return typeof payload === 'string' ? Buffer.byteLength(payload) : payload.byteLength;
}

function rawByteLength(data: RawData): number {
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (Array.isArray(data)) return data.reduce((total, part) => total + rawByteLength(part), 0);
  return data.byteLength;
}

function emptyCounts(): Record<string, number> {
  return {};
}

function incrementCount(counts: Record<string, number>, type: string): void {
  counts[type] = (counts[type] ?? 0) + 1;
}

function actionMessage(workload: ProtocolBenchmarkWorkload, index: number): RendererToSimulatorMessage {
  return {
    type: 'action_invoke',
    payload: {
      id: workload.actionId,
      request_id: `benchmark-action-${index}`,
      continuous: workload.actionContinuous,
    },
  };
}

function stateSyncMessage(workload: ProtocolBenchmarkWorkload): RendererToSimulatorMessage {
  return {
    type: 'state_sync',
    payload: {
      request_id: 'benchmark-initial-sync',
      model_id: workload.modelId,
      parameters: [],
      actions: [],
      envs: [],
      charts: [],
      monitors: [],
    },
  };
}

function assertActionResult(message: SimulatorToRendererMessage): void {
  if (message.type !== 'action_result') return;
  const payload = message.payload as { error?: { code: string; message: string } };
  if (payload.error) throw new Error(`Simulator action failed: ${payload.error.code}: ${payload.error.message}`);
}

function assertProtocolCorrectness(
  workload: ProtocolBenchmarkWorkload,
  config: BenchmarkConfig,
  validator: BenchmarkSemanticValidator,
  actionCount: number,
): BenchmarkCorrectness {
  validator.assert(actionCount);
  const stateHash = sha256(validator.snapshot());
  const expectedStateHash = sha256(workload.expectedState(config, actionCount));
  if (stateHash !== expectedStateHash) {
    throw new Error(`State hash mismatch: expected ${expectedStateHash}, received ${stateHash}.`);
  }
  return { valid: true, actionCount, stateHash, expectedStateHash };
}

function emptyMetrics(): Record<string, number[]> {
  return {};
}

function addMetrics(target: Record<string, number[]>, metrics: Readonly<Record<string, number>> | undefined): void {
  if (!metrics) return;
  for (const [name, value] of Object.entries(metrics)) {
    if (!Number.isFinite(value)) throw new Error(`Benchmark metric ${name} must be finite.`);
    (target[name] ??= []).push(value);
  }
}

async function runProtocolNodeReplicate(
  workload: ProtocolBenchmarkWorkload,
  config: BenchmarkConfig,
  encoding: ProtocolEncoding,
  validation: ProtocolValidationLevel,
  warmupActions: number,
  measuredActions: number,
  index: number,
): Promise<BenchmarkReplicate> {
  const processStartedAt = startProcessMeasurement();
  const validator = workload.createSemanticValidator(config);
  const counts = emptyCounts();
  const metrics = emptyMetrics();
  let wireBytes = { ...EMPTY_BYTES };
  const outgoing = createProtocolCodec({ validation: { level: validation, direction: 'renderer-to-simulator' } });
  const incoming = createProtocolCodec({ validation: { level: validation, direction: 'simulator-to-renderer' } });
  const simulatorOutgoing = createProtocolCodec({ validation: { level: validation, direction: 'simulator-to-renderer' } });
  const simulatorIncoming = createProtocolCodec({ validation: { level: validation, direction: 'renderer-to-simulator' } });
  const session = workload.createSession(config);

  session.attach(async (message) => {
    const encoded = simulatorOutgoing.encode(message as AnyProtocolMessage, encoding);
    wireBytes = { ...wireBytes, simulatorToRenderer: wireBytes.simulatorToRenderer + byteLength(encoded) };
    const decoded = incoming.decode(encoded) as SimulatorToRendererMessage;
    incrementCount(counts, decoded.type);
    validator.observe(decoded);
    assertActionResult(decoded);
  }, `benchmark-node-${index}`);

  const send = async (message: RendererToSimulatorMessage): Promise<void> => {
    const encoded = outgoing.encode(message as AnyProtocolMessage, encoding);
    wireBytes = { ...wireBytes, rendererToSimulator: wireBytes.rendererToSimulator + byteLength(encoded) };
    await session.dispatch(simulatorIncoming.decode(encoded) as RendererToSimulatorMessage);
  };

  try {
    await session.open(`benchmark-node-${index}`);
    await send(stateSyncMessage(workload));
    const timingsMs: number[] = [];
    const totalActions = warmupActions + measuredActions;
    for (let actionIndex = 0; actionIndex < totalActions; actionIndex += 1) {
      const started = nowMs();
      await send(actionMessage(workload, actionIndex));
      if (actionIndex >= warmupActions) timingsMs.push(nowMs() - started);
    }
    return {
      index,
      block: index,
      timingsMs,
      metrics,
      messageCounts: counts,
      wireBytes,
      correctness: assertProtocolCorrectness(workload, config, validator, totalActions),
      process: processMeasurement(processStartedAt),
    };
  } finally {
    await session.close();
  }
}

async function runLocalNodeReplicate(
  workload: NodeBenchmarkWorkload,
  config: BenchmarkConfig,
  warmupActions: number,
  measuredActions: number,
  index: number,
): Promise<BenchmarkReplicate> {
  const processStartedAt = startProcessMeasurement();
  const benchmark = workload.createNodeCase(config);
  const timingsMs: number[] = [];
  const metrics = emptyMetrics();
  const totalActions = warmupActions + measuredActions;
  for (let actionIndex = 0; actionIndex < totalActions; actionIndex += 1) {
    const started = nowMs();
    const result = await benchmark.run(actionIndex);
    const elapsed = nowMs() - started;
    if (actionIndex >= warmupActions) {
      timingsMs.push(elapsed);
      addMetrics(metrics, result.metrics);
    }
  }
  const stateHash = sha256(benchmark.snapshot());
  const expectedStateHash = sha256(benchmark.expectedState(totalActions));
  if (stateHash !== expectedStateHash) throw new Error(`State hash mismatch: expected ${expectedStateHash}, received ${stateHash}.`);
  return {
    index,
    block: index,
    timingsMs,
    metrics,
    messageCounts: {},
    wireBytes: { ...EMPTY_BYTES },
    correctness: { valid: true, actionCount: totalActions, stateHash, expectedStateHash },
    process: processMeasurement(processStartedAt),
  };
}

async function runNodeReplicate(
  workload: BenchmarkWorkload,
  config: BenchmarkConfig,
  encoding: ProtocolEncoding,
  validation: ProtocolValidationLevel,
  warmupActions: number,
  measuredActions: number,
  index: number,
): Promise<BenchmarkReplicate> {
  if (workload.kind === 'protocol') {
    return runProtocolNodeReplicate(workload, config, encoding, validation, warmupActions, measuredActions, index);
  }
  if (workload.kind === 'node') return runLocalNodeReplicate(workload, config, warmupActions, measuredActions, index);
  throw new Error(`${workload.id} is browser-only and cannot run in the node suite.`);
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

interface BrowserServer {
  pageUrl: string;
  close(): Promise<void>;
}

let browserBundleConfig: string | undefined;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 30_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Returns a currently available loopback port for one external-browser replicate. */
export async function allocateLoopbackPort(): Promise<number> {
  const server = createServer();
  server.unref();
  return new Promise<number>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a numeric loopback port.'));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePromise(address.port);
      });
    });
  });
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  const closed = new Promise<void>((resolvePromise) => socket.once('close', () => resolvePromise()));
  socket.close();
  await withTimeout(closed, 'WebSocket close', 5_000).catch(() => socket.terminate());
}

async function startBrowserServer(repositoryRoot: string): Promise<BrowserServer> {
  const configFile = path.join(repositoryRoot, 'packages/benchmark/vite.config.ts');
  const { preview } = await import('vite');
  // Calling Vite's programmatic build API from TSX fails to resolve Vite's own
  // modulepreload entry under Rolldown. The CLI is the production build path
  // used by CI as well, so invoke it once and then serve its immutable output.
  if (browserBundleConfig !== configFile) {
    const viteEntry = path.resolve(path.dirname(benchmarkRequire.resolve('vite')), '..', '..', 'bin', 'vite.js');
    await executeCommand({ executable: process.execPath, args: [viteEntry, 'build', '--config', configFile, '--logLevel', 'error'], cwd: path.dirname(configFile), timeoutMs: 120_000 });
    browserBundleConfig = configFile;
  }
  const server = await preview({
    configFile,
    preview: { host: '127.0.0.1', port: 0, open: false },
    logLevel: 'error',
  });
  if (server.httpServer && !server.httpServer.listening) await once(server.httpServer, 'listening');
  const pageUrl = server.resolvedUrls?.local[0];
  if (!pageUrl) {
    await server.close();
    throw new Error('Vite preview did not expose a local browser benchmark URL.');
  }
  return { pageUrl, close: () => server.close() };
}

async function runWsReplicate(
  workload: ProtocolBenchmarkWorkload,
  config: BenchmarkConfig,
  encoding: ProtocolEncoding,
  validation: ProtocolValidationLevel,
  warmupActions: number,
  measuredActions: number,
  index: number,
): Promise<BenchmarkReplicate> {
  const processStartedAt = startProcessMeasurement();
  const validator = workload.createSemanticValidator(config);
  const counts = emptyCounts();
  const metrics = emptyMetrics();
  let wireBytes = { ...EMPTY_BYTES };
  const host = createWebSocketTransportHost({
    sessionFactory: () => workload.createSession(config),
    encoding,
    rendererMessageValidation: validation,
    simulatorMessageValidation: validation,
  });
  if (!host.url) await once(host.server, 'listening');
  const url = host.url;
  if (!url) throw new Error('WebSocket benchmark host did not expose an address.');

  const outgoing = createProtocolCodec({ validation: { level: validation, direction: 'renderer-to-simulator' } });
  const incoming = createProtocolCodec({ validation: { level: validation, direction: 'simulator-to-renderer' } });
  const synchronised = deferred<void>();
  const actionResults = new Map<string, Deferred<void>>();
  let socket: WebSocket | undefined;

  try {
    socket = new WebSocket(url);
    socket.on('message', (data, isBinary) => {
      try {
        wireBytes = { ...wireBytes, simulatorToRenderer: wireBytes.simulatorToRenderer + rawByteLength(data) };
        const normalized = normalizeWebSocketRawData(data, isBinary);
        const message = incoming.decode(normalized) as SimulatorToRendererMessage;
        incrementCount(counts, message.type);
        validator.observe(message);
        assertActionResult(message);
        if (message.type === 'simulator_info') {
          const payload = outgoing.encode(stateSyncMessage(workload) as AnyProtocolMessage, encoding);
          wireBytes = { ...wireBytes, rendererToSimulator: wireBytes.rendererToSimulator + byteLength(payload) };
          socket!.send(typeof payload === 'string' ? payload : Buffer.from(payload));
        } else if (message.type === 'state_sync_end') {
          synchronised.resolve();
        } else if (message.type === 'action_result') {
          const payload = message.payload as { request_id: string };
          actionResults.get(payload.request_id)?.resolve();
        }
      } catch (error) {
        synchronised.reject(error);
        for (const pending of actionResults.values()) pending.reject(error);
      }
    });
    socket.on('error', (error) => {
      synchronised.reject(error);
      for (const pending of actionResults.values()) pending.reject(error);
    });
    await withTimeout(new Promise<void>((resolvePromise, reject) => {
      socket!.once('open', resolvePromise);
      socket!.once('error', reject);
    }), `WebSocket connection to ${url}`);
    await withTimeout(synchronised.promise, 'Initial state sync');

    const timingsMs: number[] = [];
    const totalActions = warmupActions + measuredActions;
    for (let actionIndex = 0; actionIndex < totalActions; actionIndex += 1) {
      const message = actionMessage(workload, actionIndex);
      const requestId = (message.payload as { request_id: string }).request_id;
      const done = deferred<void>();
      actionResults.set(requestId, done);
      const encoded = outgoing.encode(message as AnyProtocolMessage, encoding);
      wireBytes = { ...wireBytes, rendererToSimulator: wireBytes.rendererToSimulator + byteLength(encoded) };
      const started = nowMs();
      socket.send(typeof encoded === 'string' ? encoded : Buffer.from(encoded));
      await withTimeout(done.promise, `Action ${requestId}`);
      actionResults.delete(requestId);
      if (actionIndex >= warmupActions) timingsMs.push(nowMs() - started);
    }
    return {
      index,
      block: index,
      timingsMs,
      metrics,
      messageCounts: counts,
      wireBytes,
      correctness: assertProtocolCorrectness(workload, config, validator, totalActions),
      process: processMeasurement(processStartedAt),
    };
  } finally {
    if (socket) await closeSocket(socket);
    await host.close();
  }
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function bootstrapMedianCi(values: readonly number[]): [number, number] {
  if (values.length < 2) return [median(values), median(values)];
  const random = seededRandom(0x20260718);
  const medians: number[] = [];
  for (let iteration = 0; iteration < 2_000; iteration += 1) {
    const sample = Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)]!);
    medians.push(median(sample));
  }
  medians.sort((left, right) => left - right);
  return [percentile(medians, 0.025), percentile(medians, 0.975)];
}

function summarize(values: readonly number[], independentReplicates: readonly number[] = values): DistributionSummary {
  const sorted = [...values].sort((left, right) => left - right);
  const center = median(sorted);
  return {
    count: sorted.length,
    meanMs: sorted.length === 0 ? 0 : sorted.reduce((total, value) => total + value, 0) / sorted.length,
    medianMs: center,
    p95Ms: percentile(sorted, 0.95),
    madMs: median(sorted.map((value) => Math.abs(value - center))),
    bootstrapMedianCi95Ms: bootstrapMedianCi(independentReplicates),
  };
}

function sumCounts(samples: readonly BenchmarkReplicate[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const sample of samples) {
    for (const [type, count] of Object.entries(sample.messageCounts)) totals[type] = (totals[type] ?? 0) + count;
  }
  return totals;
}

function summarizeMetrics(samples: readonly BenchmarkReplicate[]): Record<string, DistributionSummary> {
  const values: Record<string, number[]> = {};
  const replicateMedians: Record<string, number[]> = {};
  for (const sample of samples) {
    for (const [name, series] of Object.entries(sample.metrics)) {
      (values[name] ??= []).push(...series);
      (replicateMedians[name] ??= []).push(median(series));
    }
  }
  return Object.fromEntries(Object.entries(values).map(([name, series]) => [name, summarize(series, replicateMedians[name] ?? [])]));
}

function summarizeStages(samples: readonly BenchmarkReplicate[]): Record<string, DistributionSummary> {
  const values: Record<string, number[]> = {};
  const replicateMedians: Record<string, number[]> = {};
  for (const sample of samples) for (const [name, series] of Object.entries(sample.stagesMs ?? {})) {
    (values[name] ??= []).push(...series);
    (replicateMedians[name] ??= []).push(median(series));
  }
  return Object.fromEntries(Object.entries(values).map(([name, series]) => [name, summarize(series, replicateMedians[name] ?? [])]));
}

function summarizeRun(samples: readonly BenchmarkReplicate[]): BenchmarkRunSummary {
  const timings = samples.flatMap((sample) => sample.timingsMs);
  const replicateMedians = samples.map((sample) => median(sample.timingsMs));
  return {
    cycle: summarize(timings, replicateMedians),
    replicateMediansMs: replicateMedians,
    metrics: summarizeMetrics(samples),
    stages: summarizeStages(samples),
    wireBytes: samples.reduce<BenchmarkWireBytes>((total, sample) => ({
      rendererToSimulator: total.rendererToSimulator + sample.wireBytes.rendererToSimulator,
      simulatorToRenderer: total.simulatorToRenderer + sample.wireBytes.simulatorToRenderer,
    }), { ...EMPTY_BYTES }),
    messageCounts: sumCounts(samples),
  };
}

function runMetricSummary(run: BenchmarkRun, metric = run.execution.primaryMetric ?? 'cycle'): DistributionSummary {
  if (metric === 'cycle') return run.summary.cycle;
  const summary = run.summary.metrics[metric] ?? run.summary.stages[metric];
  if (!summary) throw new Error(`${run.id} does not contain primary metric ${metric}.`);
  return summary;
}

function sampleMetricMedian(sample: BenchmarkReplicate, metric: string): number {
  const values = metric === 'cycle' ? sample.timingsMs : sample.metrics[metric] ?? sample.stagesMs?.[metric];
  if (!values || values.length === 0) throw new Error(`Replicate ${sample.block} does not contain metric ${metric}.`);
  return median(values);
}

async function runProtocolBrowserReplicate(
  browserServer: BrowserServer,
  workload: ProtocolBenchmarkWorkload,
  config: BenchmarkConfig,
  encoding: ProtocolEncoding,
  validation: ProtocolValidationLevel,
  warmupActions: number,
  measuredActions: number,
  index: number,
  browserOptions: ResolvedBrowserBenchmarkRunOptions,
): Promise<{ sample: BenchmarkReplicate; browserVersion: string }> {
  const processStartedAt = startProcessMeasurement();
  const validator = workload.createSemanticValidator(config);
  const counts = emptyCounts();
  const simulatorErrors: unknown[] = [];
  let observerError: unknown;
  let wireBytes = { ...EMPTY_BYTES };
  const host = createWebSocketTransportHost({
    sessionFactory: () => workload.createSession(config),
    encoding,
    rendererMessageValidation: validation,
    simulatorMessageValidation: validation,
    onSimulatorMessage: (message, bytes) => {
      incrementCount(counts, message.type);
      wireBytes = { ...wireBytes, simulatorToRenderer: wireBytes.simulatorToRenderer + bytes };
      try {
        validator.observe(message);
        assertActionResult(message);
        if (message.type === 'error') simulatorErrors.push(message.payload);
      } catch (error) {
        observerError = error;
      }
    },
    onRendererMessage: (_message, bytes) => {
      wireBytes = { ...wireBytes, rendererToSimulator: wireBytes.rendererToSimulator + bytes };
    },
  });
  if (!host.url) await once(host.server, 'listening');
  const endpoint = host.url;
  if (!endpoint) throw new Error('WebSocket browser benchmark host did not expose an address.');

  try {
    const { chromium } = await import('playwright');
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      throw new Error(`Chromium is unavailable. Run \"pnpm bench:browser:install\" first. ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const diagnostics: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`);
      });
      page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
      await page.addInitScript((request) => { window.__TENSNAP_BENCHMARK_REQUEST__ = request; }, {
        workloadId: workload.id,
        config,
        endpoint,
        encoding,
        validation,
        warmupActions,
        measuredActions,
        browserOptions,
      });
      await gotoWhenReady(page, new URL('browser-runner.html', browserServer.pageUrl).href, '#benchmark-root', 30_000);
      try {
        await page.waitForFunction(
          () => window.__TENSNAP_BENCHMARK_RESULT__ !== undefined,
          undefined,
          { timeout: Math.max(30_000, (warmupActions + measuredActions) * 1_000) },
        );
      } catch (error) {
        const detail = diagnostics.length === 0 ? 'no page diagnostics' : diagnostics.join('\n');
        const pageState = await page.evaluate(() => ({
          title: document.title,
          rootText: document.getElementById('benchmark-root')?.textContent?.slice(0, 500) ?? '',
          result: window.__TENSNAP_BENCHMARK_RESULT__ ?? null,
        })).catch(() => null);
        throw new Error(`Browser benchmark page did not return a result: ${error instanceof Error ? error.message : String(error)}\n${detail}\nserver messages: ${JSON.stringify(counts)}\nserver errors: ${JSON.stringify(simulatorErrors)}\npage: ${JSON.stringify(pageState)}`);
      }
      const result = await page.evaluate(() => window.__TENSNAP_BENCHMARK_RESULT__) as {
        ok: boolean;
        error?: string;
        stats?: { timings: number[]; mutationTimings?: number[]; stageTimings?: Record<string, number[]>; completedFrames: number; measuredFrames: number; stopReason: string };
      };
      if (!result.ok || !result.stats) throw new Error(result.error ?? 'Browser benchmark did not return stats.');
      if (observerError) throw observerError;
      const actionCount = warmupActions + measuredActions;
      const correctness = assertProtocolCorrectness(workload, config, validator, actionCount);
      if (result.stats.completedFrames !== actionCount || result.stats.measuredFrames !== measuredActions) {
        throw new Error(`Browser completed ${result.stats.completedFrames}/${actionCount} cycles (${result.stats.stopReason}).`);
      }
      await context.close();
      return {
        browserVersion: browser.version(),
        sample: {
          index,
          block: index,
          timingsMs: result.stats.timings,
          metrics: result.stats.mutationTimings ? { browserMutationMs: result.stats.mutationTimings } : {},
          messageCounts: counts,
          wireBytes,
          correctness,
          process: processMeasurement(processStartedAt, true),
          ...(result.stats.stageTimings ? { stagesMs: result.stats.stageTimings } : {}),
        },
      };
    } finally {
      await browser.close();
    }
  } finally {
    await host.close();
  }
}

async function runBrowserWorkloadReplicate(
  browserServer: BrowserServer,
  workload: BrowserBenchmarkWorkload,
  config: BenchmarkConfig,
  warmupActions: number,
  measuredActions: number,
  index: number,
  browserOptions: ResolvedBrowserBenchmarkRunOptions,
): Promise<{ sample: BenchmarkReplicate; browserVersion: string }> {
  const processStartedAt = startProcessMeasurement();
  const { chromium } = await import('playwright');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(`Chromium is unavailable. Run "pnpm bench:browser:install" first. ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const diagnostics: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`); });
    page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
    await page.addInitScript((request) => { window.__TENSNAP_BENCHMARK_REQUEST__ = request; }, {
      workloadId: workload.id,
      config,
      warmupActions,
      measuredActions,
      browserOptions,
    });
    await gotoWhenReady(page, new URL('browser-runner.html', browserServer.pageUrl).href, '#benchmark-root', 30_000);
    try {
      await page.waitForFunction(
        () => window.__TENSNAP_BENCHMARK_RESULT__ !== undefined,
        undefined,
        { timeout: Math.max(30_000, (warmupActions + measuredActions) * 1_000) },
      );
    } catch (error) {
      throw new Error(`Browser workload ${workload.id} did not return a result: ${error instanceof Error ? error.message : String(error)}\n${diagnostics.join('\n')}`);
    }
    const result = await page.evaluate(() => window.__TENSNAP_BENCHMARK_RESULT__) as {
      ok: boolean;
      error?: string;
      snapshot?: unknown;
      expectedState?: unknown;
      stats?: { timings: number[]; mutationTimings?: number[]; stageTimings?: Record<string, number[]>; completedFrames: number; measuredFrames: number; stopReason: string };
    };
    if (!result.ok || !result.stats) throw new Error(result.error ?? `Browser workload ${workload.id} failed.`);
    const actionCount = warmupActions + measuredActions;
    const stateHash = sha256(result.snapshot);
    const expectedStateHash = sha256(result.expectedState);
    if (stateHash !== expectedStateHash) {
      throw new Error(`${workload.id} state hash mismatch: expected ${expectedStateHash}, received ${stateHash}.`);
    }
    if (result.stats.completedFrames !== actionCount || result.stats.measuredFrames !== measuredActions) {
      throw new Error(`Browser completed ${result.stats.completedFrames}/${actionCount} cycles (${result.stats.stopReason}).`);
    }
    await context.close();
    return {
      browserVersion: browser.version(),
      sample: {
        index,
        block: index,
        timingsMs: result.stats.timings,
        metrics: result.stats.mutationTimings ? { browserMutationMs: result.stats.mutationTimings } : {},
        messageCounts: {},
        wireBytes: { ...EMPTY_BYTES },
        correctness: { valid: true, actionCount, stateHash, expectedStateHash },
        process: processMeasurement(processStartedAt, true),
        ...(result.stats.stageTimings ? { stagesMs: result.stats.stageTimings } : {}),
      },
    };
  } finally {
    await browser.close();
  }
}

function flattenExternalSeries(value: number | readonly number[]): number[] {
  return typeof value === 'number' ? [value] : [...value];
}

function externalVisualSample(
  visual: ExternalBenchmarkResult['visual'],
): BenchmarkReplicate['visual'] | undefined {
  if (!visual) return undefined;
  const checkpoints = { ...visual.checkpoints };
  const inlinePngBase64 = visual.inlinePngBase64
    ? { ...visual.inlinePngBase64 }
    : undefined;
  for (const [name, expectedHash] of Object.entries(checkpoints)) {
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
      throw new Error(`External visual checkpoint ${name} must declare a SHA-256 hash.`);
    }
    const encoded = inlinePngBase64?.[name];
    if (!encoded) continue;
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.byteLength > 16 * 1024 * 1024) {
      throw new Error(`External visual checkpoint ${name} exceeds 16 MiB.`);
    }
    const pngMagic = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.byteLength < pngMagic.length || pngMagic.some((value, index) => bytes[index] !== value)) {
      throw new Error(`External visual checkpoint ${name} is not a PNG.`);
    }
    const actualHash = sha256Bytes(bytes);
    if (actualHash !== expectedHash) {
      throw new Error(`External visual checkpoint ${name} hash mismatch: expected ${expectedHash}, received ${actualHash}.`);
    }
  }
  for (const name of Object.keys(inlinePngBase64 ?? {})) {
    if (!(name in checkpoints)) {
      throw new Error(`External visual checkpoint ${name} has bytes but no declared hash.`);
    }
  }
  return {
    checkpoints,
    ...(inlinePngBase64 ? { inlinePngBase64 } : {}),
  };
}

export function externalResultSample(
  result: ExternalBenchmarkResult,
  index: number,
  process: BenchmarkReplicate['process'],
): BenchmarkReplicate {
  if (result.schemaVersion !== 1 || !Array.isArray(result.timingsMs) || result.timingsMs.some((value) => !Number.isFinite(value))) {
    throw new Error('External benchmark result must be schema-v1 JSON with finite timingsMs.');
  }
  const state = result.correctness?.state ?? result.state ?? null;
  const expectedState = result.correctness?.expectedState ?? result.expectedState ?? state;
  const stateHash = sha256(state);
  const expectedStateHash = sha256(expectedState);
  const valid = result.correctness?.valid ?? stateHash === expectedStateHash;
  if (!valid || stateHash !== expectedStateHash) throw new Error('External benchmark reported a semantic mismatch.');
  const metrics: Record<string, number[]> = {};
  for (const [name, value] of Object.entries(result.metrics ?? {})) metrics[name] = flattenExternalSeries(value);
  const stages: Record<string, number[]> = {};
  for (const [name, value] of Object.entries(result.stagesMs ?? {})) stages[name] = flattenExternalSeries(value);
  const visual = externalVisualSample(result.visual);
  return {
    index,
    block: index,
    timingsMs: [...result.timingsMs],
    metrics,
    messageCounts: {},
    wireBytes: { ...EMPTY_BYTES },
    correctness: {
      valid: true,
      actionCount: result.correctness?.actionCount ?? result.timingsMs.length,
      stateHash,
      expectedStateHash,
    },
    process,
    ...(Object.keys(stages).length > 0 ? { stagesMs: stages } : {}),
    ...(visual ? { visual } : {}),
    ...(result.runtime ? { runtime: result.runtime } : {}),
  };
}

interface CommandOutput {
  stdout: string;
  stderr: string;
  process: BenchmarkReplicate['process'];
}

async function executeCommand(command: ExternalCommand, measureChild = false): Promise<CommandOutput> {
  const startedAt = startProcessMeasurement();
  let measurementDirectory: string | undefined;
  let measurementFile: string | undefined;
  let executable = command.executable;
  let args = [...command.args];
  if (measureChild && platform() !== 'win32') {
    measurementDirectory = await mkdtemp(path.join(tmpdir(), 'tensnap-benchmark-time-'));
    measurementFile = path.join(measurementDirectory, 'time.txt');
    executable = '/usr/bin/time';
    args = ['-p', '-o', measurementFile, command.executable, ...command.args];
  }
  const child = spawn(executable, args, {
    cwd: command.cwd,
    env: { ...process.env, ...command.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (data: string) => { stdout += data; });
  child.stderr.on('data', (data: string) => { stderr += data; });
  const timeoutMs = command.timeoutMs ?? 120_000;
  const status = await withTimeout(new Promise<number | null>((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', resolvePromise);
  }), `${command.executable} external benchmark`, timeoutMs).catch(async (error) => {
    child.kill('SIGTERM');
    throw error;
  });
  try {
    if (status !== 0) {
      throw new Error(`External benchmark ${command.executable} exited ${status}.\n${stderr.slice(-4_000)}`);
    }
    let measuredProcess = measureChild ? externalWallMeasurement(startedAt) : processMeasurement(startedAt);
    if (measurementFile) {
      const values = Object.fromEntries((await readFile(measurementFile, 'utf8')).split(/\r?\n/).flatMap((line) => {
        const match = /^(real|user|sys)\s+([0-9.]+)$/.exec(line.trim());
        return match ? [[match[1]!, Number(match[2]) * 1_000]] : [];
      }));
      measuredProcess = {
        isolated: true,
        wallMs: typeof values.real === 'number' ? values.real : measuredProcess.wallMs,
        userCpuMs: typeof values.user === 'number' ? values.user : null,
        systemCpuMs: typeof values.sys === 'number' ? values.sys : null,
        maxRssBytes: null,
      };
    }
    return { stdout, stderr, process: measuredProcess };
  } finally {
    if (measurementDirectory) await rm(measurementDirectory, { recursive: true, force: true });
  }
}

function parseExternalResult(stdout: string): ExternalBenchmarkResult {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as ExternalBenchmarkResult;
      if (parsed.schemaVersion === 1) return parsed;
    } catch {
      // Other framework output is allowed; only the final schema-v1 JSON line matters.
    }
  }
  throw new Error(`External benchmark did not emit a schema-v1 JSON result.\n${stdout.slice(-4_000)}`);
}

async function runExternalProcessReplicate(
  repositoryRoot: string,
  workload: ExternalProcessBenchmarkWorkload,
  config: BenchmarkConfig,
  warmupActions: number,
  measuredActions: number,
  index: number,
): Promise<BenchmarkReplicate> {
  const command = workload.createExternalCommand(config, { repositoryRoot, replicate: index, warmupActions, measuredActions });
  const output = await executeCommand(command, true);
  const result = parseExternalResult(output.stdout);
  workload.validateExternalResult?.(config, result, { repositoryRoot, replicate: index, warmupActions, measuredActions });
  return externalResultSample(result, index, output.process);
}

interface StartedExternalServer {
  readonly process: ReturnType<typeof spawn>;
  readonly stderr: () => string;
  stop(): Promise<void>;
}

/**
 * Signal a detached POSIX process group when possible. Some launchers move
 * themselves to a group that the parent cannot signal; in that case, fall
 * back to the directly spawned child instead of failing a completed replicate.
 * The return value reports whether group-level liveness can still be tracked.
 */
export function signalExternalProcessTree(child: ReturnType<typeof spawn>, grouped: boolean, signal: NodeJS.Signals): boolean {
  if (child.pid === undefined) return false;
  if (grouped) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'ESRCH') throw error;
    }
  }
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill(signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  return false;
}

function externalProcessTreeRunning(child: ReturnType<typeof spawn>, grouped: boolean): boolean {
  if (child.pid === undefined) return false;
  if (!grouped) return child.exitCode === null && child.signalCode === null;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      return child.exitCode === null && child.signalCode === null;
    }
    throw error;
  }
}

async function waitForExternalProcessTree(child: ReturnType<typeof spawn>, grouped: boolean): Promise<void> {
  while (externalProcessTreeRunning(child, grouped)) {
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 25));
  }
}

function startExternalServer(command: ExternalCommand): StartedExternalServer {
  let stderr = '';
  // A detached POSIX child becomes a process-group leader. Stopping the whole
  // group also terminates wrappers such as `go run` and the server they spawn.
  const grouped = platform() !== 'win32';
  const child = spawn(command.executable, [...command.args], {
    cwd: command.cwd,
    env: { ...process.env, ...command.env },
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: grouped,
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (data: string) => { stderr += data; });
  return {
    process: child,
    stderr: () => stderr,
    async stop() {
      let trackGroup = signalExternalProcessTree(child, grouped, 'SIGTERM');
      try {
        await withTimeout(waitForExternalProcessTree(child, trackGroup), `External server ${command.executable} shutdown`, 10_000);
      } catch {
        trackGroup = signalExternalProcessTree(child, trackGroup, 'SIGKILL');
        await withTimeout(waitForExternalProcessTree(child, trackGroup), `External server ${command.executable} forced shutdown`, 2_000);
      }
    },
  };
}

function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Capture a browser checkpoint only after the complete page has stopped
 * changing.  Native UI servers often expose their controls before a remote
 * canvas, plot, or hydration pass has finished; a single screenshot at that
 * point can preserve a loading spinner even though the action selector exists.
 * This runs outside the measured interval and requires three consecutive,
 * byte-identical PNGs before accepting the checkpoint.
 */
export async function captureStableExternalBrowserScreenshot(
  page: Pick<import('playwright').Page, 'screenshot' | 'waitForTimeout'>,
  timeoutMs = 15_000,
  intervalMs = 100,
): Promise<Uint8Array> {
  const deadline = nowMs() + timeoutMs;
  let previousHash: string | undefined;
  let consecutiveMatches = 0;
  while (nowMs() < deadline) {
    const bytes = await page.screenshot({ type: 'png' });
    const hash = sha256Bytes(bytes);
    if (hash === previousHash) consecutiveMatches += 1;
    else consecutiveMatches = 1;
    if (consecutiveMatches >= 3) return bytes;
    previousHash = hash;
    await page.waitForTimeout(Math.min(intervalMs, Math.max(1, deadline - nowMs())));
  }
  throw new Error(`External browser did not reach a visually stable frame within ${timeoutMs} ms.`);
}

function assertExternalServerRunning(server: StartedExternalServer): void {
  if (server.process.exitCode !== null) {
    throw new Error(`External server exited ${server.process.exitCode} before becoming ready.\n${server.stderr().slice(-4_000)}`);
  }
}

async function waitForWebSocketEndpoint(endpoint: string, timeoutMs: number, server: StartedExternalServer): Promise<void> {
  const deadline = nowMs() + timeoutMs;
  let lastError = 'not attempted';
  while (nowMs() < deadline) {
    assertExternalServerRunning(server);
    try {
      const socket = new WebSocket(endpoint);
      await withTimeout(new Promise<void>((resolvePromise, reject) => {
        socket.once('open', resolvePromise);
        socket.once('error', reject);
      }), `External simulator ${endpoint} readiness`, Math.min(2_000, Math.max(250, deadline - nowMs())));
      await closeSocket(socket);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 150));
    }
  }
  throw new Error(`External simulator ${endpoint} did not become ready: ${lastError}`);
}

async function gotoWhenReady(page: import('playwright').Page, url: string, selector: string, timeoutMs: number, server?: StartedExternalServer): Promise<void> {
  const deadline = nowMs() + timeoutMs;
  let lastError = 'not attempted';
  while (nowMs() < deadline) {
    if (server) assertExternalServerRunning(server);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(10_000, Math.max(500, deadline - nowMs())) });
      await page.waitForSelector(selector, { timeout: Math.min(10_000, Math.max(500, deadline - nowMs())) });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 150));
    }
  }
  throw new Error(`External browser page ${url} did not become ready: ${lastError}`);
}

async function readExternalBrowserSignal(
  page: import('playwright').Page,
  signal: { selector: string; attribute?: string },
): Promise<string> {
  return page.locator(signal.selector).evaluate((element, attribute) => {
    const value = attribute ? element.getAttribute(attribute) : element.textContent;
    if (value === null) throw new Error(`Benchmark signal ${attribute ?? 'textContent'} is missing.`);
    return value;
  }, signal.attribute);
}

function parseExternalRevision(value: string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error(`External browser revision must be a non-negative safe integer, received ${JSON.stringify(value)}.`);
  return revision;
}

function parseExternalState(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`External browser state signal is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function measureExternalBrowserAction(
  page: import('playwright').Page,
  spec: ExternalBrowserSpec,
  expectedRevision: number,
): Promise<number> {
  if (!spec.stateOracle) throw new Error('External browser workload requires a stateOracle revision/state signal.');
  const actionMarker = 'data-tensnap-benchmark-action';
  const action = page.locator(spec.action.selector).first();
  await action.waitFor({ state: 'visible', timeout: spec.action.timeoutMs ?? 30_000 });
  await action.evaluate((element, marker) => element.setAttribute(marker, 'true'), actionMarker);
  const result = await page.evaluate(async ({ action, revision, expected, timeoutMs }) => {
    const actionElement = document.querySelector<HTMLElement>(action);
    if (!actionElement) throw new Error(`Action element ${action} was not found.`);
    return new Promise<{ elapsedMs: number; revision: number }>((resolvePromise, reject) => {
      let settled = false;
      const startedAt = performance.now();
      const observer = new MutationObserver(() => {
        if (settled) return;
        const revisionElement = document.querySelector<HTMLElement>(revision.selector);
        const raw = revisionElement
          ? (revision.attribute ? revisionElement.getAttribute(revision.attribute) : revisionElement.textContent)
          : null;
        const current = Number(raw);
        if (!Number.isSafeInteger(current)) {
          settled = true;
          observer.disconnect();
          clearTimeout(timer);
          reject(new Error(`Revision signal is not an integer: ${String(current)}`));
          return;
        }
        if (current > expected) {
          settled = true;
          observer.disconnect();
          clearTimeout(timer);
          reject(new Error(`Revision skipped expected value ${expected}: received ${current}.`));
          return;
        }
        if (current !== expected) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        // Mutation observers run before paint. The following frame callback is
        // the shared action-to-render-complete boundary for external UIs.
        requestAnimationFrame(() => resolvePromise({ elapsedMs: performance.now() - startedAt, revision: current }));
      });
      // Frameworks may replace the signal element instead of mutating its text.
      // Observe the document and re-query the selector so both update styles use
      // the same action-to-next-paint completion boundary.
      observer.observe(document.documentElement, { attributes: true, childList: true, characterData: true, subtree: true });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        reject(new Error(`Revision ${expected} timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
      actionElement.click();
    });
  }, {
    // Playwright selectors such as :has-text() are valid in profiles but not
    // in document.querySelector. Mark the resolved element before timing and
    // use a plain CSS selector inside the page measurement closure.
    action: `[${actionMarker}="true"]`,
    revision: spec.stateOracle.revision,
    expected: expectedRevision,
    timeoutMs: spec.action.timeoutMs ?? 30_000,
  });
  if (result.revision !== expectedRevision || !Number.isFinite(result.elapsedMs)) {
    throw new Error(`External browser action did not complete revision ${expectedRevision}.`);
  }
  return result.elapsedMs;
}

async function runExternalBrowserReplicate(
  repositoryRoot: string,
  workload: ExternalBrowserBenchmarkWorkload,
  config: BenchmarkConfig,
  warmupActions: number,
  measuredActions: number,
  index: number,
  browserOptions: ResolvedBrowserBenchmarkRunOptions,
): Promise<{ sample: BenchmarkReplicate; browserVersion: string }> {
  const startedAt = startProcessMeasurement();
  const port = await allocateLoopbackPort();
  const spec: ExternalBrowserSpec = workload.createExternalBrowserSpec(config, {
    repositoryRoot,
    replicate: index,
    warmupActions,
    measuredActions,
    port,
  });
  for (const [relativePath, expectedHash] of Object.entries(spec.environmentLocks ?? {})) {
    const contents = await readFile(path.resolve(repositoryRoot, relativePath));
    const actualHash = createHash('sha256').update(contents).digest('hex');
    if (actualHash !== expectedHash) throw new Error(`External browser environment lock ${relativePath} does not match its declared SHA-256.`);
  }
  const server = startExternalServer(spec.server);
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      if (spec.tensnapHarness) {
        await waitForWebSocketEndpoint(spec.tensnapHarness.endpoint, spec.server.timeoutMs ?? 120_000, server);
        const browserServer = await startBrowserServer(repositoryRoot);
        try {
          await page.addInitScript((request) => { window.__TENSNAP_BENCHMARK_REQUEST__ = request; }, {
            workloadId: spec.tensnapHarness.workloadId,
            config: spec.tensnapHarness.config,
            endpoint: spec.tensnapHarness.endpoint,
            encoding: spec.tensnapHarness.encoding,
            validation: spec.tensnapHarness.validation,
            warmupActions,
            measuredActions,
            browserOptions,
          });
          await page.goto(new URL('browser-runner.html', browserServer.pageUrl).href, { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => window.__TENSNAP_BENCHMARK_RESULT__ !== undefined, undefined, {
            timeout: spec.server.timeoutMs ?? 120_000,
          });
          const result = await page.evaluate(() => window.__TENSNAP_BENCHMARK_RESULT__) as {
            ok: boolean;
            error?: string;
            snapshot?: unknown;
            stats?: { timings: number[]; mutationTimings?: number[]; stageTimings?: Record<string, number[]>; completedFrames: number; measuredFrames: number; stopReason: string; snapshot?: unknown };
          };
          if (!result.ok || !result.stats) throw new Error(result.error ?? 'External TenSnap browser workload failed.');
          const actionCount = warmupActions + measuredActions;
          if (result.stats.completedFrames !== actionCount || result.stats.measuredFrames !== measuredActions) {
            throw new Error(`External TenSnap browser completed ${result.stats.completedFrames}/${actionCount} actions.`);
          }
          const observation: ExternalBrowserObservation = {
            initialRevision: 0,
            finalRevision: actionCount,
            initialState: null,
            finalState: result.snapshot ?? result.stats.snapshot,
          };
          const correctness = workload.validateExternalBrowserObservation?.(
            config,
            observation,
            { repositoryRoot, replicate: index, warmupActions, measuredActions },
          );
          if (!correctness) throw new Error(`${workload.id} must validate the TenSnap renderer snapshot with validateExternalBrowserObservation.`);
          const completionMetric = browserOptions.renderTriggerMode === 'requestAnimationFrame'
            ? 'actionToRenderCompleteMs'
            : 'actionToRunCompletionMs';
          const sample = externalResultSample({
            schemaVersion: 1,
            timingsMs: result.stats.timings,
            metrics: { ...(result.stats.mutationTimings ? { browserMutationMs: result.stats.mutationTimings } : {}), [completionMetric]: result.stats.timings },
            stagesMs: result.stats.stageTimings ?? { [completionMetric]: result.stats.timings },
            correctness: { valid: true, actionCount, ...correctness },
          }, index, externalWallMeasurement(startedAt));
          return { browserVersion: browser.version(), sample };
        } finally {
          await browserServer.close();
        }
      }
      await gotoWhenReady(page, spec.url, spec.readySelector, spec.server.timeoutMs ?? 120_000, server);
      if (!spec.stateOracle) throw new Error(`${workload.id} must declare a stateOracle for comparable UI timing.`);
      const checkpoints: Record<string, string> = {};
      const inlinePngBase64: Record<string, string> = {};
      const checkpoint = async (name: string) => {
        const bytes = await captureStableExternalBrowserScreenshot(
          page,
          Math.min(spec.server.timeoutMs ?? 120_000, spec.action.timeoutMs ?? 30_000),
        );
        const hash = sha256Bytes(bytes);
        checkpoints[name] = hash;
        inlinePngBase64[name] = Buffer.from(bytes).toString('base64');
        const expected = spec.visualOracle?.referenceSha256?.[name];
        if (expected && expected !== hash) throw new Error(`Visual oracle mismatch for ${name}: expected ${expected}, received ${hash}.`);
      };
      const initialRevision = parseExternalRevision(await readExternalBrowserSignal(page, spec.stateOracle.revision));
      const initialState = parseExternalState(await readExternalBrowserSignal(page, spec.stateOracle.state));
      if (spec.visualOracle?.checkpointActions.includes(0)) await checkpoint('initial');
      const timings: number[] = [];
      const totalActions = warmupActions + measuredActions;
      for (let action = 0; action < totalActions; action += 1) {
        const elapsed = await measureExternalBrowserAction(page, spec, initialRevision + action + 1);
        if (action >= warmupActions) timings.push(elapsed);
        // Screenshots are deliberately outside the measured interval.
        if (spec.visualOracle?.checkpointActions.includes(action + 1)) await checkpoint(`after-${action + 1}`);
      }
      const finalRevision = parseExternalRevision(await readExternalBrowserSignal(page, spec.stateOracle.revision));
      const finalState = parseExternalState(await readExternalBrowserSignal(page, spec.stateOracle.state));
      const observation: ExternalBrowserObservation = { initialRevision, finalRevision, initialState, finalState };
      const correctness = workload.validateExternalBrowserObservation?.(
        config,
        observation,
        { repositoryRoot, replicate: index, warmupActions, measuredActions },
      );
      if (!correctness) throw new Error(`${workload.id} must validate its canonical UI state with validateExternalBrowserObservation.`);
      await context.close();
      const sample = externalResultSample({
        schemaVersion: 1,
        timingsMs: timings,
        metrics: { actionToRenderCompleteMs: timings },
        stagesMs: { actionToRenderCompleteMs: timings },
        correctness: { valid: true, actionCount: totalActions, ...correctness },
      }, index, externalWallMeasurement(startedAt));
      return { browserVersion: browser.version(), sample: { ...sample, visual: { checkpoints, inlinePngBase64 } } };
    } finally {
      await browser.close();
    }
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nExternal server stderr:\n${server.stderr().slice(-4_000)}`);
  } finally {
    await server.stop();
  }
}

export interface ReplicateRequest {
  readonly repositoryRoot: string;
  readonly modulePath: string;
  readonly config: BenchmarkConfig;
  readonly suite: BenchmarkSuite;
  readonly encoding?: ProtocolEncoding;
  readonly validation?: ProtocolValidationLevel;
  readonly warmupActions: number;
  readonly measuredActions: number;
  readonly index: number;
  readonly browserOptions: ResolvedBrowserBenchmarkRunOptions;
}

/** Runs one replicate. Exported for the clean child-process entry point. */
export async function runReplicateInCurrentProcess(request: ReplicateRequest): Promise<{ sample: BenchmarkReplicate; browserVersion?: string }> {
  const imported = await import(pathToFileURL(request.modulePath).href);
  const workload = (imported.default ?? imported.workload) as BenchmarkWorkload;
  if (!workload || workload.schemaVersion !== 2) throw new Error(`${request.modulePath} is not a benchmark workload.`);
  if (request.suite === 'node') {
    if (workload.kind === 'external-process') {
      return { sample: await runExternalProcessReplicate(request.repositoryRoot, workload, request.config, request.warmupActions, request.measuredActions, request.index) };
    }
    if (workload.kind === 'browser' || workload.kind === 'external-browser') throw new Error(`${workload.id} is browser-only.`);
    return { sample: await runNodeReplicate(workload, request.config, request.encoding ?? 'json', request.validation ?? 'error', request.warmupActions, request.measuredActions, request.index) };
  }
  if (request.suite === 'ws') {
    if (workload.kind !== 'protocol' || !request.encoding || !request.validation) throw new Error(`${workload.id} has no WebSocket protocol path.`);
    return { sample: await runWsReplicate(workload, request.config, request.encoding, request.validation, request.warmupActions, request.measuredActions, request.index) };
  }
  if (workload.kind === 'external-browser') {
    return runExternalBrowserReplicate(
      request.repositoryRoot,
      workload,
      request.config,
      request.warmupActions,
      request.measuredActions,
      request.index,
      request.browserOptions,
    );
  }
  if (workload.kind === 'node' || workload.kind === 'external-process') throw new Error(`${workload.id} is node-only.`);
  const browserServer = await startBrowserServer(request.repositoryRoot);
  try {
    return workload.kind === 'protocol'
      ? await runProtocolBrowserReplicate(
        browserServer,
        workload,
        request.config,
        request.encoding ?? 'json',
        request.validation ?? 'error',
        request.warmupActions,
        request.measuredActions,
        request.index,
        request.browserOptions,
      )
      : await runBrowserWorkloadReplicate(
        browserServer,
        workload,
        request.config,
        request.warmupActions,
        request.measuredActions,
        request.index,
        request.browserOptions,
      );
  } finally {
    await browserServer.close();
  }
}

async function runIsolatedReplicate(request: ReplicateRequest): Promise<{ sample: BenchmarkReplicate; browserVersion?: string }> {
  const childEntry = path.join(request.repositoryRoot, 'packages/benchmark/src/node/replicate-child.ts');
  const tsxLoader = benchmarkRequire.resolve('tsx');
  // The loader path avoids tsx CLI's IPC control socket, which is unnecessary
  // for one-shot replicate children and unavailable in some locked-down hosts.
  const child = spawn(process.execPath, ['--import', tsxLoader, childEntry], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (data: string) => { stdout += data; });
  child.stderr.on('data', (data: string) => { stderr += data; });
  child.stdin.end(`${JSON.stringify(request)}\n`);
  const status = await withTimeout(new Promise<number | null>((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', resolvePromise);
  }), `isolated benchmark replicate ${request.modulePath}`, 10 * 60_000).catch(async (error) => {
    child.kill('SIGTERM');
    throw error;
  });
  if (status !== 0) throw new Error(`Isolated replicate exited ${status}.\n${stderr.slice(-4_000)}`);
  const payload = JSON.parse(stdout.trim()) as { sample: BenchmarkReplicate; browserVersion?: string };
  return { ...payload, sample: { ...payload.sample, process: { ...payload.sample.process, isolated: true } } };
}

interface RunTarget {
  readonly id: string;
  readonly resolved: ResolvedProfileWorkload;
  readonly suite: BenchmarkSuite;
  readonly encoding?: ProtocolEncoding;
  readonly validation?: ProtocolValidationLevel;
  readonly samples: BenchmarkReplicate[];
  browserVersion?: string;
}

function targetId(resolved: ResolvedProfileWorkload, suite: BenchmarkSuite, encoding?: ProtocolEncoding, validation?: ProtocolValidationLevel): string {
  return [resolved.id, suite, encoding ?? '-', validation ?? '-'].join('|');
}

function createTargets(options: RunProfileOptions): RunTarget[] {
  const targets: RunTarget[] = [];
  for (const resolved of options.workloads) for (const suite of options.suites) {
    if (!resolved.workload.supportedSuites.includes(suite)) continue;
    if (resolved.workload.kind === 'protocol') {
      for (const encoding of options.profile.encodings) for (const validation of options.profile.validation) {
        targets.push({ id: targetId(resolved, suite, encoding, validation), resolved, suite, encoding, validation, samples: [] });
      }
    } else {
      targets.push({ id: targetId(resolved, suite), resolved, suite, samples: [] });
    }
  }
  return targets;
}

function validateBlocks(profile: BenchmarkProfile, blocks: readonly number[] | undefined): number[] {
  const selected = blocks === undefined ? Array.from({ length: profile.repetitions }, (_, index) => index) : [...blocks];
  if (selected.some((block) => !Number.isInteger(block) || block < 0 || block >= profile.repetitions)) {
    throw new Error(`Blocks must be integers from 0 through ${profile.repetitions - 1}.`);
  }
  if (new Set(selected).size !== selected.length) throw new Error('Blocks must not contain duplicates.');
  return selected.sort((left, right) => left - right);
}

export async function createBenchmarkJournalHeader(options: RunProfileOptions): Promise<BenchmarkJournalHeader> {
  const targets = createTargets(options);
  if (targets.length === 0) throw new Error(`Profile ${options.profile.id} did not resolve any runnable workload/suite pairs.`);
  const artifactContext = options.artifactContext ?? await collectArtifactContext(options.repositoryRoot);
  if (options.profile.requireCleanGit && artifactContext.implementation.dirty !== false) {
    throw new Error(`Submission profile ${options.profile.id} requires a clean git worktree.`);
  }
  return {
    type: 'header',
    schemaVersion: 1,
    profile: options.profile,
    profileSha256: sha256(options.profile),
    suites: [...options.suites],
    implementationGitSha: artifactContext.implementation.gitSha,
    artifactContext,
    expectedRunIds: targets.map((target) => target.id).sort(),
  };
}

function journalSampleKey(sample: Pick<BenchmarkJournalSample, 'runId' | 'block'>): string {
  return `${sample.runId}\u0000${sample.block}`;
}

export async function readBenchmarkJournal(file: string): Promise<BenchmarkJournal> {
  const raw = await readFile(file, 'utf8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error(`Benchmark journal ${file} is empty.`);
  const header = JSON.parse(lines[0]!) as BenchmarkJournalHeader;
  if (header.type !== 'header' || header.schemaVersion !== 1 || sha256(header.profile) !== header.profileSha256) {
    throw new Error(`Benchmark journal ${file} has an invalid header.`);
  }
  const samples = lines.slice(1).map((line, index) => {
    const record = JSON.parse(line) as BenchmarkJournalSample;
    if (record.type !== 'sample' || !record.runId || !Number.isInteger(record.block) || !record.sample) {
      throw new Error(`Benchmark journal ${file} has an invalid sample on line ${index + 2}.`);
    }
    return record;
  });
  const keys = samples.map(journalSampleKey);
  if (new Set(keys).size !== keys.length) throw new Error(`Benchmark journal ${file} contains duplicate run/block samples.`);
  return { header, samples };
}

export function assertJournalCompatible(expected: BenchmarkJournalHeader, actual: BenchmarkJournalHeader): void {
  if (actual.profileSha256 !== expected.profileSha256) throw new Error('Benchmark journal profile does not match the requested profile.');
  if (stableJson([...actual.suites].sort()) !== stableJson([...expected.suites].sort())) throw new Error('Benchmark journal suite plan does not match.');
  if (stableJson([...actual.expectedRunIds].sort()) !== stableJson([...expected.expectedRunIds].sort())) throw new Error('Benchmark journal run matrix does not match.');
  if (actual.implementationGitSha !== expected.implementationGitSha) throw new Error('Benchmark journal was produced from a different implementation commit.');
  if (stableJson(actual.artifactContext) !== stableJson(expected.artifactContext)) throw new Error('Benchmark journal execution environment does not match.');
}

export async function initializeBenchmarkJournal(file: string, header: BenchmarkJournalHeader): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await writeFile(file, `${JSON.stringify(header)}\n`, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Benchmark journal already exists: ${file}. Pass --resume to validate and continue it, or choose a new --out/--journal path.`);
    }
    throw error;
  }
}

export async function appendBenchmarkJournalSample(file: string, sample: BenchmarkJournalSample): Promise<void> {
  // One append call owns one complete JSONL record. A truncated final line is
  // therefore detectable rather than silently accepted during resume.
  await appendFile(file, `${JSON.stringify(sample)}\n`, { encoding: 'utf8' });
}

export function mergeBenchmarkJournalSamples(journals: readonly BenchmarkJournal[]): BenchmarkJournalSample[] {
  if (journals.length === 0) throw new Error('merge requires at least one benchmark journal.');
  const expected = journals[0]!.header;
  const merged = new Map<string, BenchmarkJournalSample>();
  for (const journal of journals) {
    assertJournalCompatible(expected, journal.header);
    for (const sample of journal.samples) {
      const key = journalSampleKey(sample);
      if (merged.has(key)) throw new Error(`Duplicate benchmark sample for ${sample.runId} block ${sample.block}.`);
      merged.set(key, sample);
    }
  }
  return [...merged.values()];
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const replacement = Math.floor(random() * (index + 1));
    [result[index], result[replacement]] = [result[replacement]!, result[index]!];
  }
  return result;
}

function git(repositoryRoot: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export async function collectEnvironment(): Promise<BenchmarkEnvironment> {
  return {
    os: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus().map((cpu) => ({ model: cpu.model, speedMHz: cpu.speed })),
    memoryBytes: totalmem(),
    node: process.version,
    v8: process.versions.v8,
    pnpmUserAgent: process.env.npm_config_user_agent ?? null,
  };
}

async function collectArtifactContext(repositoryRoot: string): Promise<BenchmarkArtifactContext> {
  const lockfilePath = path.join(repositoryRoot, 'pnpm-lock.yaml');
  const lockfileSha256 = await readFile(lockfilePath).then((contents) => contentSha256(contents)).catch(() => null);
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'packages/benchmark/package.json'), 'utf8')) as { version: string };
  const status = git(repositoryRoot, ['status', '--porcelain']);
  const gitSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
  return {
    harness: { package: '@tensnap/benchmark', version: packageJson.version, gitSha },
    implementation: { gitSha, dirty: status === null ? null : status.length > 0, lockfileSha256 },
    environment: await collectEnvironment(),
  };
}

function buildRun(repositoryRoot: string, target: RunTarget, profile: BenchmarkProfile, processIsolated: boolean): BenchmarkRun {
  const { resolved } = target;
  return {
    id: target.id,
    profileWorkloadId: resolved.id,
    system: resolved.system,
    suite: target.suite,
    workload: {
      id: resolved.workload.id,
      version: resolved.workload.version,
      kind: resolved.workload.kind,
      category: resolved.workload.category,
      ...(resolved.workload.kind === 'protocol' ? { protocolVersion: resolved.workload.protocolVersion } : {}),
      module: path.relative(repositoryRoot, resolved.modulePath),
      config: resolved.config,
      configHash: sha256(resolved.config),
    },
    execution: {
      ...(resolved.workload.kind === 'protocol' && target.encoding && target.validation ? { encoding: target.encoding, validation: target.validation } : {}),
      warmupActions: resolved.warmupActions,
      measuredActions: resolved.measuredActions,
      repetitions: profile.repetitions,
      processIsolated,
      primaryMetric: resolved.primaryMetric,
      ...(resolved.featureLevel ? { featureLevel: resolved.featureLevel } : {}),
      ...(resolved.dimensions ? { dimensions: resolved.dimensions } : {}),
      ...(resolved.stateEquivalenceGroup ? { stateEquivalenceGroup: resolved.stateEquivalenceGroup } : {}),
      ...(target.browserVersion ? {
        browser: {
          name: 'chromium' as const,
          version: target.browserVersion,
          viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
          headless: true as const,
          runOptions: resolved.browserOptions,
        },
      } : {}),
    },
    samples: target.samples,
    summary: summarizeRun(target.samples),
  };
}

function comparisonSeed(value: string): number {
  let result = 0x9e3779b9;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 0x85ebca6b);
  return result >>> 0;
}

function pairedBootstrapMedianCi(values: readonly number[], seed: number): [number, number] {
  if (values.length < 2) return [median(values), median(values)];
  const random = seededRandom(seed);
  const medians: number[] = [];
  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    medians.push(median(Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)]!)));
  }
  medians.sort((left, right) => left - right);
  return [percentile(medians, 0.025), percentile(medians, 0.975)];
}

function pairedComparisons(profile: BenchmarkProfile, runs: readonly BenchmarkRun[]): PairedComparisonSummary[] {
  const summaries: PairedComparisonSummary[] = [];
  for (const comparison of profile.comparisons ?? []) for (const treatment of comparison.treatments) {
    const baselineRuns = runs.filter((run) => run.id.startsWith(`${comparison.baseline}|`));
    const treatmentRuns = runs.filter((run) => run.id.startsWith(`${treatment}|`));
    for (const baseline of baselineRuns) {
      const suffix = baseline.id.slice(comparison.baseline.length);
      const matched = treatmentRuns.find((run) => run.id.slice(treatment.length) === suffix);
      if (!matched) continue;
      if (baseline.execution.featureLevel !== matched.execution.featureLevel) {
        throw new Error(`Comparison ${comparison.id} mixes feature levels: ${baseline.execution.featureLevel ?? '-'} != ${matched.execution.featureLevel ?? '-'}.`);
      }
      if (stableJson(baseline.execution.dimensions ?? {}) !== stableJson(matched.execution.dimensions ?? {})) {
        throw new Error(`Comparison ${comparison.id} mixes workload dimensions for ${baseline.id} and ${matched.id}.`);
      }
      const metric = comparison.metric ?? baseline.execution.primaryMetric;
      if (!comparison.metric && matched.execution.primaryMetric !== metric) {
        throw new Error(`Comparison ${comparison.id} requires an explicit metric because ${baseline.id} and ${matched.id} have different primary metrics.`);
      }
      // Resolve eagerly so a misspelled profile metric fails even when there
      // are no overlapping blocks.
      runMetricSummary(baseline, metric);
      runMetricSummary(matched, metric);
      const baselineByBlock = new Map(baseline.samples.map((sample) => [sample.block, sampleMetricMedian(sample, metric)]));
      const pairs = matched.samples.flatMap((sample) => {
        const baselineValue = baselineByBlock.get(sample.block);
        const treatmentValue = sampleMetricMedian(sample, metric);
        return baselineValue === undefined || baselineValue <= 0 ? [] : [[baselineValue, treatmentValue] as const];
      });
      if (pairs.length === 0) continue;
      const ratios = pairs.map(([base, value]) => value / base);
      const differences = pairs.map(([base, value]) => value - base);
      const id = `${comparison.id}:${metric}:${baseline.suite}:${baseline.execution.encoding ?? '-'}:${baseline.execution.validation ?? '-'}`;
      summaries.push({
        id,
        metric,
        suite: baseline.suite,
        baseline: comparison.baseline,
        treatment,
        pairs: pairs.length,
        medianRatio: median(ratios),
        bootstrapMedianRatioCi95: pairedBootstrapMedianCi(ratios, comparisonSeed(`${id}:${treatment}:ratio`)),
        medianDifferenceMs: median(differences),
        bootstrapMedianDifferenceCi95Ms: pairedBootstrapMedianCi(differences, comparisonSeed(`${id}:${treatment}:difference`)),
      });
    }
  }
  return summaries;
}

export async function runProfile(options: RunProfileOptions): Promise<BenchmarkArtifact> {
  const artifactContext = options.artifactContext ?? await collectArtifactContext(options.repositoryRoot);
  if (options.profile.requireCleanGit && artifactContext.implementation.dirty !== false) {
    throw new Error(`Submission profile ${options.profile.id} requires a clean git worktree.`);
  }
  const targets = createTargets(options);
  if (targets.length === 0) throw new Error(`Profile ${options.profile.id} did not resolve any runnable workload/suite pairs.`);
  const targetById = new Map(targets.map((target) => [target.id, target]));
  for (const record of options.existingReplicates ?? []) {
    const target = targetById.get(record.runId);
    if (!target) throw new Error(`Journal sample refers to unknown run ${record.runId}.`);
    if (record.block < 0 || record.block >= options.profile.repetitions || record.sample.block !== record.block) {
      throw new Error(`Journal sample ${record.runId} has invalid block ${record.block}.`);
    }
    if (target.samples.some((sample) => sample.block === record.block)) throw new Error(`Duplicate sample for ${record.runId} block ${record.block}.`);
    target.samples.push(record.sample);
    target.browserVersion ??= record.browserVersion;
  }
  const processIsolated = options.profile.processIsolation !== 'off';
  const blocks = validateBlocks(options.profile, options.blocks);
  const plannedReplicates = blocks.length * targets.length;
  const alreadyCompleted = targets.reduce((total, target) => total + target.samples.filter((sample) => blocks.includes(sample.block)).length, 0);
  let completedReplicates = alreadyCompleted;
  options.onProgress?.(`${options.profile.id}: ${blocks.length} selected block(s), ${targets.length} target(s), ${plannedReplicates - alreadyCompleted} pending replicate(s).`);
  for (const block of blocks) {
    const random = seededRandom(comparisonSeed(`${options.profile.id}:${sha256(options.profile)}:${block}`));
    const order = options.profile.randomizedBlocks === false ? [...targets] : shuffled(targets, random);
    for (const [targetIndex, target] of order.entries()) {
      if (target.samples.some((sample) => sample.block === block)) {
        options.onProgress?.(`${options.profile.id}: block ${block + 1}/${options.profile.repetitions}, target ${targetIndex + 1}/${order.length}: resume skip ${target.resolved.system} (${target.suite}).`);
        continue;
      }
      completedReplicates += 1;
      options.onProgress?.(`${options.profile.id}: block ${block + 1}/${options.profile.repetitions}, target ${targetIndex + 1}/${order.length}, selected replicate ${completedReplicates}/${plannedReplicates}: ${target.resolved.system} (${target.suite}).`);
      const request: ReplicateRequest = {
        repositoryRoot: options.repositoryRoot,
        modulePath: target.resolved.modulePath,
        config: target.resolved.config,
        suite: target.suite,
        ...(target.encoding ? { encoding: target.encoding } : {}),
        ...(target.validation ? { validation: target.validation } : {}),
        warmupActions: target.resolved.warmupActions,
        measuredActions: target.resolved.measuredActions,
        index: block,
        browserOptions: target.resolved.browserOptions,
      };
      // Browser replicates already create a fresh Chromium process, WebSocket host,
      // and Vite preview server. Vite's programmatic preview intentionally ends a
      // TSX child before it can flush stdout, so nesting it in another child would
      // turn a valid browser run into an empty result. Node/WS still use a fresh
      // harness process; browser isolation is the fresh browser/server pair.
      const isolatedByBrowser = target.suite === 'browser';
      const result = processIsolated && !isolatedByBrowser
        ? await runIsolatedReplicate(request)
        : await runReplicateInCurrentProcess(request);
      const sample: BenchmarkReplicate = { ...result.sample, index: block, block, process: { ...result.sample.process, isolated: processIsolated || result.sample.process.isolated || isolatedByBrowser } };
      const record: BenchmarkJournalSample = {
        type: 'sample',
        runId: target.id,
        block,
        sample,
        ...(result.browserVersion ? { browserVersion: result.browserVersion } : {}),
      };
      await options.onReplicate?.(record);
      target.samples.push(sample);
      target.browserVersion ??= result.browserVersion;
    }
  }
  options.onProgress?.(`${options.profile.id}: selected plan now has ${completedReplicates}/${plannedReplicates} replicate(s).`);
  const runs = targets.map((target) => buildRun(options.repositoryRoot, target, options.profile, processIsolated));
  const complete = targets.every((target) => target.samples.length === options.profile.repetitions);
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    profile: options.profile,
    ...artifactContext,
    runs,
    comparisons: complete ? pairedComparisons(options.profile, runs) : [],
    integrity: {
      profileSha256: sha256(options.profile),
      expectedRunIds: targets.map((target) => target.id).sort(),
      samplesSha256: null,
    },
  };
}

export function isArtifactComplete(artifact: BenchmarkArtifact): boolean {
  return artifact.runs.length === artifact.integrity.expectedRunIds.length
    && artifact.runs.every((run) => run.samples.length === run.execution.repetitions
      && new Set(run.samples.map((sample) => sample.block)).size === run.execution.repetitions);
}

function markdownNumber(value: number): string {
  return value.toFixed(3);
}

export function renderReport(artifact: BenchmarkArtifact): string {
  const rows = artifact.runs.map((run) => {
    const primaryMetric = run.execution.primaryMetric ?? 'cycle';
    const primary = runMetricSummary(run, primaryMetric);
    const [lower, upper] = primary.bootstrapMedianCi95Ms;
    const metrics = [
      ...Object.entries(run.summary.metrics).filter(([name]) => name !== primaryMetric).map(([name, summary]) => `${name}: ${markdownNumber(summary.medianMs)}`),
      ...Object.entries(run.summary.stages).filter(([name]) => name !== primaryMetric).map(([name, summary]) => `${name}: ${markdownNumber(summary.medianMs)}`),
    ].join('<br>') || '-';
    const dimensions = Object.entries(run.execution.dimensions ?? {}).map(([name, value]) => `${name}=${String(value)}`).join(', ') || '-';
    return `| ${run.suite} | ${run.workload.category} | ${run.system ?? run.profileWorkloadId ?? run.workload.id} | ${run.execution.featureLevel ?? '-'} | ${dimensions} | ${primaryMetric} | ${run.execution.encoding ?? '-'} | ${run.execution.validation ?? '-'} | ${primary.count} | ${markdownNumber(primary.medianMs)} | ${markdownNumber(primary.p95Ms)} | ${markdownNumber(lower)}–${markdownNumber(upper)} | ${metrics} | ${run.summary.wireBytes.rendererToSimulator} / ${run.summary.wireBytes.simulatorToRenderer} |`;
  }).join('\n');
  const mainTable = `| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |\n|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|\n${rows}`;
  const comparisons = artifact.comparisons.length === 0 ? '' : `## Paired comparisons\n\nRatios are treatment / baseline; values below 1 favour the treatment. Confidence intervals resample paired independent replicates, never individual steps.\n\n| Comparison | Metric | Suite | Baseline | Treatment | Pairs | Median ratio (95% CI) | Median difference ms (95% CI) |\n|---|---|---|---|---|---:|---:|---:|\n${artifact.comparisons.map((comparison) => `| ${comparison.id} | ${comparison.metric} | ${comparison.suite} | ${comparison.baseline} | ${comparison.treatment} | ${comparison.pairs} | ${markdownNumber(comparison.medianRatio)} (${markdownNumber(comparison.bootstrapMedianRatioCi95[0])}–${markdownNumber(comparison.bootstrapMedianRatioCi95[1])}) | ${markdownNumber(comparison.medianDifferenceMs)} (${markdownNumber(comparison.bootstrapMedianDifferenceCi95Ms[0])}–${markdownNumber(comparison.bootstrapMedianDifferenceCi95Ms[1])}) |`).join('\n')}\n\n`;
  return `# TenSnap reproducible benchmark\n\nGenerated: ${artifact.generatedAt}\n\n- Commit: ${artifact.implementation.gitSha ?? 'unavailable'}${artifact.implementation.dirty ? ' (dirty)' : ''}\n- Node: ${artifact.environment.node}; V8: ${artifact.environment.v8}\n- OS: ${artifact.environment.os} ${artifact.environment.release} (${artifact.environment.arch})\n- CPU: ${artifact.environment.cpu[0]?.model ?? 'unavailable'}\n- Replicates: ${artifact.runs.every((run) => run.execution.processIsolated) ? 'fresh process per replicate' : 'in-process (not suitable for submission)'}\n\n${mainTable}\n\n${comparisons}Raw measurements are in \`samples.jsonl\`; derived publication data and the SVG figure are in \`analysis/\`; \`manifest.json\` is the machine-readable experiment record.\n`;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function renderAnalysisRunsCsv(artifact: BenchmarkArtifact): string {
  const header = ['run_id', 'suite', 'system', 'feature_level', 'dimensions_json', 'primary_metric', 'encoding', 'validation', 'samples', 'median_ms', 'p95_ms', 'ci95_low_ms', 'ci95_high_ms'];
  const rows = artifact.runs.map((run) => {
    const metric = run.execution.primaryMetric ?? 'cycle';
    const summary = runMetricSummary(run, metric);
    return [run.id, run.suite, run.system ?? run.profileWorkloadId ?? run.workload.id, run.execution.featureLevel ?? '', stableJson(run.execution.dimensions ?? {}), metric, run.execution.encoding ?? '', run.execution.validation ?? '', summary.count, summary.medianMs, summary.p95Ms, summary.bootstrapMedianCi95Ms[0], summary.bootstrapMedianCi95Ms[1]].map(csvCell).join(',');
  });
  return `${header.join(',')}\n${rows.join('\n')}\n`;
}

export function renderAnalysisComparisonsCsv(artifact: BenchmarkArtifact): string {
  const header = ['comparison_id', 'metric', 'suite', 'baseline', 'treatment', 'pairs', 'median_ratio', 'ratio_ci95_low', 'ratio_ci95_high', 'median_difference_ms', 'difference_ci95_low_ms', 'difference_ci95_high_ms'];
  const rows = artifact.comparisons.map((comparison) => [comparison.id, comparison.metric, comparison.suite, comparison.baseline, comparison.treatment, comparison.pairs, comparison.medianRatio, comparison.bootstrapMedianRatioCi95[0], comparison.bootstrapMedianRatioCi95[1], comparison.medianDifferenceMs, comparison.bootstrapMedianDifferenceCi95Ms[0], comparison.bootstrapMedianDifferenceCi95Ms[1]].map(csvCell).join(','));
  return `${header.join(',')}\n${rows.join('\n')}${rows.length > 0 ? '\n' : ''}`;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderPrimaryMetricSvg(artifact: BenchmarkArtifact): string {
  const width = 1100;
  const rowHeight = 34;
  const top = 64;
  const left = 360;
  const plotWidth = width - left - 40;
  const rows = artifact.runs.map((run) => ({ run, summary: runMetricSummary(run) }));
  const maximum = Math.max(1, ...rows.map(({ summary }) => summary.bootstrapMedianCi95Ms[1],));
  const height = top + rows.length * rowHeight + 48;
  const elements = rows.map(({ run, summary }, index) => {
    const y = top + index * rowHeight;
    const scale = (value: number) => left + value / maximum * plotWidth;
    const label = `${run.system ?? run.profileWorkloadId ?? run.workload.id} [${run.execution.primaryMetric ?? 'cycle'}]`;
    const low = scale(summary.bootstrapMedianCi95Ms[0]);
    const high = scale(summary.bootstrapMedianCi95Ms[1]);
    const medianX = scale(summary.medianMs);
    return `<text x="12" y="${y + 5}" font-size="13">${xmlEscape(label)}</text><line x1="${low.toFixed(2)}" y1="${y}" x2="${high.toFixed(2)}" y2="${y}" stroke="#334155" stroke-width="2"/><circle cx="${medianX.toFixed(2)}" cy="${y}" r="5" fill="#2563eb"/><text x="${Math.min(width - 80, medianX + 9).toFixed(2)}" y="${y + 5}" font-size="12">${summary.medianMs.toFixed(3)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">Primary benchmark metrics</title><desc id="desc">Median primary latency and independent-replicate bootstrap 95 percent confidence intervals in milliseconds.</desc><rect width="100%" height="100%" fill="white"/><text x="12" y="28" font-size="20" font-weight="600">${xmlEscape(artifact.profile.id)} primary metrics</text><text x="12" y="48" font-size="12" fill="#475569">Median and independent-replicate bootstrap 95% CI (ms)</text>${elements}<line x1="${left}" y1="${top - 18}" x2="${left + plotWidth}" y2="${top - 18}" stroke="#94a3b8"/><text x="${left}" y="${top - 24}" font-size="11">0</text><text x="${left + plotWidth - 45}" y="${top - 24}" font-size="11">${maximum.toFixed(3)} ms</text></svg>\n`;
}

export function analysisFiles(artifact: BenchmarkArtifact): Readonly<Record<string, string>> {
  const figureData = artifact.runs.map((run) => ({
    runId: run.id,
    system: run.system ?? run.profileWorkloadId ?? run.workload.id,
    featureLevel: run.execution.featureLevel ?? null,
    dimensions: run.execution.dimensions ?? {},
    primaryMetric: run.execution.primaryMetric ?? 'cycle',
    summary: runMetricSummary(run),
  }));
  return {
    'analysis/runs.csv': renderAnalysisRunsCsv(artifact),
    'analysis/comparisons.csv': renderAnalysisComparisonsCsv(artifact),
    'analysis/figure-data.json': `${JSON.stringify(figureData, null, 2)}\n`,
    'analysis/primary-metrics.svg': renderPrimaryMetricSvg(artifact),
  };
}

export async function writeAnalysisFiles(directory: string, artifact: BenchmarkArtifact): Promise<void> {
  verifyArtifact(artifact);
  for (const [relativePath, contents] of Object.entries(analysisFiles(artifact))) {
    const destination = path.join(directory, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
}

export function verifyArtifact(artifact: BenchmarkArtifact): void {
  if (artifact.schemaVersion !== 2) throw new Error('Unsupported artifact schema version.');
  if (artifact.runs.length === 0) throw new Error('Artifact contains no benchmark runs.');
  if (sha256(artifact.profile) !== artifact.integrity.profileSha256) throw new Error('Artifact profile hash does not match its manifest.');
  const actualRunIds = artifact.runs.map((run) => run.id).sort();
  const expectedRunIds = [...artifact.integrity.expectedRunIds].sort();
  if (stableJson(actualRunIds) !== stableJson(expectedRunIds)) throw new Error('Artifact run matrix does not match the manifest plan.');
  const equivalentStates = new Map<string, { hash: string; runId: string }>();
  for (const run of artifact.runs) {
    if (run.workload.kind === 'protocol' && run.workload.protocolVersion !== '0.3') throw new Error(`${run.workload.id} is not a v0.3 protocol workload.`);
    if (run.samples.length !== run.execution.repetitions) throw new Error(`${run.workload.id}/${run.suite} has an incomplete repetition set.`);
    const blocks = new Set(run.samples.map((sample) => sample.block));
    if (blocks.size !== run.execution.repetitions) throw new Error(`${run.workload.id}/${run.suite} has duplicate or missing replicate blocks.`);
    for (const sample of run.samples) {
      if (!sample.correctness.valid || sample.correctness.stateHash !== sample.correctness.expectedStateHash) {
        throw new Error(`${run.workload.id}/${run.suite} failed semantic verification.`);
      }
      if (sample.timingsMs.length !== run.execution.measuredActions) {
        throw new Error(`${run.workload.id}/${run.suite} has an incomplete timing series.`);
      }
      if (run.execution.processIsolated && !sample.process.isolated) throw new Error(`${run.workload.id}/${run.suite} was not process isolated.`);
      if ((sample.process.userCpuMs !== null && sample.process.userCpuMs < 0)
        || (sample.process.systemCpuMs !== null && sample.process.systemCpuMs < 0)) {
        throw new Error(`${run.workload.id}/${run.suite} has an invalid CPU delta.`);
      }
      if (run.execution.stateEquivalenceGroup) {
        const key = `${run.execution.stateEquivalenceGroup}\u0000${sample.block}`;
        const previous = equivalentStates.get(key);
        if (previous && previous.hash !== sample.correctness.stateHash) {
          throw new Error(`Canonical state mismatch in equivalence group ${run.execution.stateEquivalenceGroup}, block ${sample.block}: ${previous.runId} != ${run.id}.`);
        }
        equivalentStates.set(key, { hash: sample.correctness.stateHash, runId: run.id });
      }
    }
    if (stableJson(run.summary) !== stableJson(summarizeRun(run.samples))) throw new Error(`${run.id} summary was not regenerated from raw samples.`);
    runMetricSummary(run);
  }
  const regeneratedComparisons = pairedComparisons(artifact.profile, artifact.runs);
  if (stableJson(artifact.comparisons) !== stableJson(regeneratedComparisons)) throw new Error('Paired comparisons do not match raw replicate blocks.');
}

function serialiseSamples(artifact: BenchmarkArtifact): string {
  return `${artifact.runs.flatMap((run) => run.samples.map((sample) => JSON.stringify({
    runId: run.id,
    suite: run.suite,
    workload: run.workload,
    execution: run.execution,
    sample,
  }))).join('\n')}\n`;
}

function contentSha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Verify the immutable experiment inputs without requiring generated report or
 * analysis files to exist. This is the trust boundary used by `bench analyze`:
 * derived files may be rebuilt, but never from unchecked manifest/sample data.
 */
export async function verifyArtifactSourceFiles(input: string, artifact?: BenchmarkArtifact): Promise<void> {
  const manifestPath = input.endsWith('.json') ? input : path.join(input, 'manifest.json');
  const directory = path.dirname(manifestPath);
  const loaded = artifact ?? JSON.parse(await readFile(manifestPath, 'utf8')) as BenchmarkArtifact;
  verifyArtifact(loaded);
  if (!loaded.integrity.samplesSha256) throw new Error('Artifact manifest does not contain a samples.jsonl checksum.');
  const samples = await readFile(path.join(directory, 'samples.jsonl'));
  if (contentSha256(samples) !== loaded.integrity.samplesSha256) throw new Error('samples.jsonl checksum mismatch.');
  if (samples.toString('utf8') !== serialiseSamples(loaded)) throw new Error('samples.jsonl rows do not exactly match manifest runs.');
  for (const run of loaded.runs) for (const sample of run.samples) {
    for (const [checkpoint, relativePath] of Object.entries(sample.visual?.files ?? {})) {
      const bytes = await readFile(path.join(directory, relativePath));
      const expected = sample.visual?.checkpoints[checkpoint];
      if (!expected || sha256Bytes(bytes) !== expected) throw new Error(`Visual checkpoint ${checkpoint} does not match ${relativePath}.`);
    }
  }
}

export async function verifyArtifactFiles(input: string, artifact?: BenchmarkArtifact): Promise<void> {
  const manifestPath = input.endsWith('.json') ? input : path.join(input, 'manifest.json');
  const directory = path.dirname(manifestPath);
  const loaded = artifact ?? JSON.parse(await readFile(manifestPath, 'utf8')) as BenchmarkArtifact;
  await verifyArtifactSourceFiles(input, loaded);
  const expectedDerived = { 'report.md': renderReport(loaded), ...analysisFiles(loaded) };
  const declaredDerived = loaded.integrity.filesSha256;
  if (!declaredDerived || stableJson(Object.keys(declaredDerived).sort()) !== stableJson(Object.keys(expectedDerived).sort())) {
    throw new Error('Artifact manifest does not declare the complete derived-file set.');
  }
  for (const [relativePath, expectedContents] of Object.entries(expectedDerived)) {
    const contents = await readFile(path.join(directory, relativePath), 'utf8');
    if (contents !== expectedContents) throw new Error(`${relativePath} was not regenerated from manifest/raw samples.`);
    if (contentSha256(contents) !== declaredDerived[relativePath]) throw new Error(`${relativePath} checksum mismatch.`);
  }
}

async function writeArtifactDirectory(outputDirectory: string, artifact: BenchmarkArtifact): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  const runs = await Promise.all(artifact.runs.map(async (run) => ({
    ...run,
    samples: await Promise.all(run.samples.map(async (sample) => {
      const inline = sample.visual?.inlinePngBase64;
      if (!inline || Object.keys(inline).length === 0) return sample;
      const visualDirectory = path.join(outputDirectory, 'screenshots');
      await mkdir(visualDirectory, { recursive: true });
      const files: Record<string, string> = {};
      for (const [checkpoint, encoded] of Object.entries(inline)) {
        const filename = `${sha256({ run: run.id, block: sample.block, checkpoint }).slice(0, 20)}.png`;
        const relativePath = path.join('screenshots', filename);
        await writeFile(path.join(outputDirectory, relativePath), Buffer.from(encoded, 'base64'));
        files[checkpoint] = relativePath;
      }
      return {
        ...sample,
        visual: { checkpoints: sample.visual?.checkpoints ?? {}, ...(Object.keys(files).length > 0 ? { files } : {}) },
      };
    })),
  })));
  const sanitized: BenchmarkArtifact = { ...artifact, runs };
  const samples = serialiseSamples(sanitized);
  const checksummed: BenchmarkArtifact = {
    ...sanitized,
    integrity: { ...sanitized.integrity, samplesSha256: contentSha256(samples) },
  };
  const derived = { 'report.md': renderReport(checksummed), ...analysisFiles(checksummed) };
  const persisted: BenchmarkArtifact = {
    ...checksummed,
    integrity: {
      ...checksummed.integrity,
      filesSha256: Object.fromEntries(Object.entries(derived).map(([relativePath, contents]) => [relativePath, contentSha256(contents)])),
    },
  };
  verifyArtifact(persisted);
  await writeFile(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(persisted, null, 2)}\n`);
  await writeFile(path.join(outputDirectory, 'samples.jsonl'), samples);
  for (const [relativePath, contents] of Object.entries(derived)) {
    const destination = path.join(outputDirectory, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  await verifyArtifactFiles(outputDirectory, persisted);
}

export async function assertArtifactOutputAvailable(outputDirectory: string): Promise<void> {
  try {
    await stat(outputDirectory);
    throw new Error(`Output path already exists: ${outputDirectory}. Published artifacts are immutable; verify the existing artifact or choose a new --out path.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function writeArtifact(outputDirectory: string, artifact: BenchmarkArtifact): Promise<void> {
  if (!isArtifactComplete(artifact)) throw new Error('Cannot publish an incomplete benchmark artifact; resume or merge all blocks first.');
  await assertArtifactOutputAvailable(outputDirectory);
  const parent = path.dirname(outputDirectory);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(path.join(parent, `.${path.basename(outputDirectory)}.tmp-`));
  try {
    await writeArtifactDirectory(staging, artifact);
    await rename(staging, outputDirectory);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
