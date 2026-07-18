import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem, arch } from 'node:os';
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
  ExternalBrowserSpec,
  ExternalCommand,
  ExternalProcessBenchmarkWorkload,
  NodeBenchmarkWorkload,
  PairedComparisonSummary,
  ProtocolBenchmarkWorkload,
} from '../harness/types';

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
}

export interface RunProfileOptions {
  repositoryRoot: string;
  profile: BenchmarkProfile;
  workloads: readonly ResolvedProfileWorkload[];
  suites: readonly BenchmarkSuite[];
  /** Optional CLI-facing progress reporter; omitted for programmatic callers. */
  onProgress?: (message: string) => void;
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
  }
  if (profile.processIsolation !== undefined && profile.processIsolation !== 'required' && profile.processIsolation !== 'off') {
    throw new Error('processIsolation must be required or off.');
  }
  const ids = profile.workloads.map((workload) => workload.id).filter((id): id is string => Boolean(id));
  if (new Set(ids).size !== ids.length) throw new Error('Benchmark workload ids must be unique.');
  if (profile.comparisons !== undefined) {
    if (!Array.isArray(profile.comparisons)) throw new Error('comparisons must be an array.');
    const declared = new Set(ids);
    for (const comparison of profile.comparisons) {
      if (!comparison?.id || !comparison.baseline || !Array.isArray(comparison.treatments) || comparison.treatments.length === 0) {
        throw new Error('Each comparison requires id, baseline, and treatments.');
      }
      if (!declared.has(comparison.baseline) || comparison.treatments.some((id: string) => !declared.has(id))) {
        throw new Error(`Comparison ${comparison.id} refers to an undeclared workload id.`);
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
    };
  }));
}

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function processMeasurement(startedAt: number, isolated = false): BenchmarkReplicate['process'] {
  const usage = process.resourceUsage();
  // Node reports maxRSS in bytes on macOS and KiB on Linux/Windows.
  const maxRssBytes = platform() === 'darwin' ? usage.maxRSS : usage.maxRSS * 1024;
  return {
    isolated,
    wallMs: nowMs() - startedAt,
    userCpuMs: usage.userCPUTime / 1_000,
    systemCpuMs: usage.systemCPUTime / 1_000,
    maxRssBytes,
  };
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
  const processStartedAt = nowMs();
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
  const processStartedAt = nowMs();
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
  const processStartedAt = nowMs();
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

async function runProtocolBrowserReplicate(
  browserServer: BrowserServer,
  workload: ProtocolBenchmarkWorkload,
  config: BenchmarkConfig,
  encoding: ProtocolEncoding,
  validation: ProtocolValidationLevel,
  warmupActions: number,
  measuredActions: number,
  index: number,
): Promise<{ sample: BenchmarkReplicate; browserVersion: string }> {
  const processStartedAt = nowMs();
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
): Promise<{ sample: BenchmarkReplicate; browserVersion: string }> {
  const processStartedAt = nowMs();
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

function externalResultSample(
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
    ...(result.runtime ? { runtime: result.runtime } : {}),
  };
}

interface CommandOutput {
  stdout: string;
  stderr: string;
  process: BenchmarkReplicate['process'];
}

async function executeCommand(command: ExternalCommand): Promise<CommandOutput> {
  const startedAt = nowMs();
  const child = spawn(command.executable, [...command.args], {
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
  if (status !== 0) {
    throw new Error(`External benchmark ${command.executable} exited ${status}.\n${stderr.slice(-4_000)}`);
  }
  return { stdout, stderr, process: processMeasurement(startedAt, true) };
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
  const output = await executeCommand(command);
  const result = parseExternalResult(output.stdout);
  workload.validateExternalResult?.(config, result, { repositoryRoot, replicate: index, warmupActions, measuredActions });
  return externalResultSample(result, index, output.process);
}

interface StartedExternalServer {
  readonly process: ReturnType<typeof spawn>;
  readonly stderr: () => string;
  stop(): Promise<void>;
}

function startExternalServer(command: ExternalCommand): StartedExternalServer {
  let stderr = '';
  const child = spawn(command.executable, [...command.args], {
    cwd: command.cwd,
    env: { ...process.env, ...command.env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (data: string) => { stderr += data; });
  return {
    process: child,
    stderr: () => stderr,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await withTimeout(once(child, 'close').then(() => undefined), `External server ${command.executable} shutdown`, 10_000)
        .catch(() => child.kill('SIGKILL'));
    },
  };
}

function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

async function waitForWebSocketEndpoint(endpoint: string, timeoutMs: number): Promise<void> {
  const deadline = nowMs() + timeoutMs;
  let lastError = 'not attempted';
  while (nowMs() < deadline) {
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

async function gotoWhenReady(page: import('playwright').Page, url: string, selector: string, timeoutMs: number): Promise<void> {
  const deadline = nowMs() + timeoutMs;
  let lastError = 'not attempted';
  while (nowMs() < deadline) {
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

async function runExternalBrowserReplicate(
  repositoryRoot: string,
  workload: ExternalBrowserBenchmarkWorkload,
  config: BenchmarkConfig,
  warmupActions: number,
  measuredActions: number,
  index: number,
): Promise<{ sample: BenchmarkReplicate; browserVersion: string }> {
  const startedAt = nowMs();
  const spec: ExternalBrowserSpec = workload.createExternalBrowserSpec(config, { repositoryRoot, replicate: index, warmupActions, measuredActions });
  const server = startExternalServer(spec.server);
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      if (spec.tensnapHarness) {
        await waitForWebSocketEndpoint(spec.tensnapHarness.endpoint, spec.server.timeoutMs ?? 120_000);
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
          });
          await page.goto(new URL('browser-runner.html', browserServer.pageUrl).href, { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => window.__TENSNAP_BENCHMARK_RESULT__ !== undefined, undefined, {
            timeout: spec.server.timeoutMs ?? 120_000,
          });
          const result = await page.evaluate(() => window.__TENSNAP_BENCHMARK_RESULT__) as {
            ok: boolean;
            error?: string;
            stats?: { timings: number[]; mutationTimings?: number[]; stageTimings?: Record<string, number[]>; completedFrames: number; measuredFrames: number; stopReason: string };
          };
          if (!result.ok || !result.stats) throw new Error(result.error ?? 'External TenSnap browser workload failed.');
          const actionCount = warmupActions + measuredActions;
          if (result.stats.completedFrames !== actionCount || result.stats.measuredFrames !== measuredActions) {
            throw new Error(`External TenSnap browser completed ${result.stats.completedFrames}/${actionCount} actions.`);
          }
          const sample = externalResultSample({
            schemaVersion: 1,
            timingsMs: result.stats.timings,
            metrics: { ...(result.stats.mutationTimings ? { browserMutationMs: result.stats.mutationTimings } : {}), actionToRunCompletionMs: result.stats.timings },
            stagesMs: result.stats.stageTimings ?? { actionToRunCompletionMs: result.stats.timings },
            correctness: { valid: true, actionCount, state: { actions: actionCount }, expectedState: { actions: actionCount } },
          }, index, processMeasurement(startedAt, true));
          return { browserVersion: browser.version(), sample };
        } finally {
          await browserServer.close();
        }
      }
      await gotoWhenReady(page, spec.url, spec.readySelector, spec.server.timeoutMs ?? 120_000);
      const checkpoints: Record<string, string> = {};
      const inlinePngBase64: Record<string, string> = {};
      const checkpoint = async (name: string) => {
        const bytes = await page.screenshot({ type: 'png' });
        const hash = sha256Bytes(bytes);
        checkpoints[name] = hash;
        inlinePngBase64[name] = Buffer.from(bytes).toString('base64');
        const expected = spec.visualOracle?.referenceSha256?.[name];
        if (expected && expected !== hash) throw new Error(`Visual oracle mismatch for ${name}: expected ${expected}, received ${hash}.`);
      };
      if (spec.visualOracle?.checkpointActions.includes(0)) await checkpoint('initial');
      const timings: number[] = [];
      const totalActions = warmupActions + measuredActions;
      for (let action = 0; action < totalActions; action += 1) {
        const before = sha256Bytes(await page.screenshot({ type: 'png' }));
        const actionStarted = nowMs();
        await page.locator(spec.action.selector).click();
        const deadline = nowMs() + (spec.action.timeoutMs ?? 30_000);
        let changed = false;
        while (nowMs() < deadline) {
          await page.evaluate(() => new Promise<void>((resolvePromise) => requestAnimationFrame(() => resolvePromise())));
          if (sha256Bytes(await page.screenshot({ type: 'png' })) !== before) { changed = true; break; }
        }
        if (!changed) throw new Error(`External browser action ${action} did not reach a visual frame checkpoint.`);
        if (action >= warmupActions) timings.push(nowMs() - actionStarted);
        if (spec.visualOracle?.checkpointActions.includes(action + 1)) await checkpoint(`after-${action + 1}`);
      }
      await context.close();
      const sample = externalResultSample({
        schemaVersion: 1,
        timingsMs: timings,
        metrics: { actionToFrameMs: timings },
        stagesMs: { actionToFrameMs: timings },
        correctness: { valid: true, actionCount: totalActions, state: checkpoints, expectedState: checkpoints },
      }, index, processMeasurement(startedAt, true));
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
    return runExternalBrowserReplicate(request.repositoryRoot, workload, request.config, request.warmupActions, request.measuredActions, request.index);
  }
  if (workload.kind === 'node' || workload.kind === 'external-process') throw new Error(`${workload.id} is node-only.`);
  const browserServer = await startBrowserServer(request.repositoryRoot);
  try {
    return workload.kind === 'protocol'
      ? await runProtocolBrowserReplicate(browserServer, workload, request.config, request.encoding ?? 'json', request.validation ?? 'error', request.warmupActions, request.measuredActions, request.index)
      : await runBrowserWorkloadReplicate(browserServer, workload, request.config, request.warmupActions, request.measuredActions, request.index);
  } finally {
    await browserServer.close();
  }
}

async function runIsolatedReplicate(request: ReplicateRequest): Promise<{ sample: BenchmarkReplicate; browserVersion?: string }> {
  const childEntry = path.join(request.repositoryRoot, 'packages/benchmark/src/node/replicate-child.ts');
  const tsxCli = benchmarkRequire.resolve('tsx/cli');
  const child = spawn(process.execPath, [tsxCli, childEntry], { stdio: ['pipe', 'pipe', 'pipe'] });
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
      ...(target.browserVersion ? { browser: { name: 'chromium' as const, version: target.browserVersion, viewport: { width: 1280, height: 800, deviceScaleFactor: 1 }, headless: true as const } } : {}),
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
      const baselineByBlock = new Map(baseline.samples.map((sample) => [sample.block, median(sample.timingsMs)]));
      const pairs = matched.samples.flatMap((sample) => {
        const baselineValue = baselineByBlock.get(sample.block);
        const treatmentValue = median(sample.timingsMs);
        return baselineValue === undefined || baselineValue <= 0 ? [] : [[baselineValue, treatmentValue] as const];
      });
      if (pairs.length === 0) continue;
      const ratios = pairs.map(([base, value]) => value / base);
      const differences = pairs.map(([base, value]) => value - base);
      const id = `${comparison.id}:${baseline.suite}:${baseline.execution.encoding ?? '-'}:${baseline.execution.validation ?? '-'}`;
      summaries.push({
        id,
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
  const lockfilePath = path.join(options.repositoryRoot, 'pnpm-lock.yaml');
  const lockfileSha256 = await readFile(lockfilePath).then((contents) => createHash('sha256').update(contents).digest('hex')).catch(() => null);
  const packageJson = JSON.parse(await readFile(path.join(options.repositoryRoot, 'packages/benchmark/package.json'), 'utf8')) as { version: string };
  const status = git(options.repositoryRoot, ['status', '--porcelain']);
  if (options.profile.requireCleanGit && status !== '') {
    throw new Error(`Submission profile ${options.profile.id} requires a clean git worktree.`);
  }
  const targets = createTargets(options);
  if (targets.length === 0) throw new Error(`Profile ${options.profile.id} did not resolve any runnable workload/suite pairs.`);
  const processIsolated = options.profile.processIsolation !== 'off';
  const random = seededRandom(comparisonSeed(`${options.profile.id}:${sha256(options.profile)}`));
  const totalReplicates = options.profile.repetitions * targets.length;
  let completedReplicates = 0;
  options.onProgress?.(`${options.profile.id}: ${options.profile.repetitions} block(s), ${targets.length} target(s), ${totalReplicates} replicate(s).`);
  for (let block = 0; block < options.profile.repetitions; block += 1) {
    const order = options.profile.randomizedBlocks === false ? [...targets] : shuffled(targets, random);
    for (const [targetIndex, target] of order.entries()) {
      completedReplicates += 1;
      options.onProgress?.(`${options.profile.id}: block ${block + 1}/${options.profile.repetitions}, target ${targetIndex + 1}/${order.length}, replicate ${completedReplicates}/${totalReplicates}: ${target.resolved.system} (${target.suite}).`);
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
      target.samples.push({ ...result.sample, index: block, block, process: { ...result.sample.process, isolated: processIsolated || result.sample.process.isolated || isolatedByBrowser } });
      target.browserVersion ??= result.browserVersion;
    }
  }
  options.onProgress?.(`${options.profile.id}: completed ${completedReplicates}/${totalReplicates} replicate(s).`);
  const runs = targets.map((target) => buildRun(options.repositoryRoot, target, options.profile, processIsolated));
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    profile: options.profile,
    harness: { package: '@tensnap/benchmark', version: packageJson.version, gitSha: git(options.repositoryRoot, ['rev-parse', 'HEAD']) },
    implementation: { gitSha: git(options.repositoryRoot, ['rev-parse', 'HEAD']), dirty: status === null ? null : status.length > 0, lockfileSha256 },
    environment: await collectEnvironment(),
    runs,
    comparisons: pairedComparisons(options.profile, runs),
    integrity: {
      profileSha256: sha256(options.profile),
      expectedRunIds: targets.map((target) => target.id).sort(),
      samplesSha256: null,
    },
  };
}

function markdownNumber(value: number): string {
  return value.toFixed(3);
}

export function renderReport(artifact: BenchmarkArtifact): string {
  const rows = artifact.runs.map((run) => {
    const { cycle } = run.summary;
    const [lower, upper] = cycle.bootstrapMedianCi95Ms;
    const metrics = [
      ...Object.entries(run.summary.metrics).map(([name, summary]) => `${name}: ${markdownNumber(summary.medianMs)}`),
      ...Object.entries(run.summary.stages).map(([name, summary]) => `${name}: ${markdownNumber(summary.medianMs)}`),
    ].join('<br>') || '-';
    return `| ${run.suite} | ${run.workload.category} | ${run.system ?? run.profileWorkloadId ?? run.workload.id} | ${run.execution.encoding ?? '-'} | ${run.execution.validation ?? '-'} | ${cycle.count} | ${markdownNumber(cycle.medianMs)} | ${markdownNumber(cycle.p95Ms)} | ${markdownNumber(lower)}–${markdownNumber(upper)} | ${metrics} | ${run.summary.wireBytes.rendererToSimulator} / ${run.summary.wireBytes.simulatorToRenderer} |`;
  }).join('\n');
  const mainTable = `| Suite | Category | Workload | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |\n|---|---|---|---|---|---:|---:|---:|---:|---|---:|\n${rows}`;
  const comparisons = artifact.comparisons.length === 0 ? '' : `## Paired comparisons\n\nRatios are treatment / baseline; values below 1 favour the treatment. Confidence intervals resample paired independent replicates, never individual steps.\n\n| Comparison | Suite | Baseline | Treatment | Pairs | Median ratio (95% CI) | Median difference ms (95% CI) |\n|---|---|---|---|---:|---:|---:|\n${artifact.comparisons.map((comparison) => `| ${comparison.id} | ${comparison.suite} | ${comparison.baseline} | ${comparison.treatment} | ${comparison.pairs} | ${markdownNumber(comparison.medianRatio)} (${markdownNumber(comparison.bootstrapMedianRatioCi95[0])}–${markdownNumber(comparison.bootstrapMedianRatioCi95[1])}) | ${markdownNumber(comparison.medianDifferenceMs)} (${markdownNumber(comparison.bootstrapMedianDifferenceCi95Ms[0])}–${markdownNumber(comparison.bootstrapMedianDifferenceCi95Ms[1])}) |`).join('\n')}\n\n`;
  return `# TenSnap reproducible benchmark\n\nGenerated: ${artifact.generatedAt}\n\n- Commit: ${artifact.implementation.gitSha ?? 'unavailable'}${artifact.implementation.dirty ? ' (dirty)' : ''}\n- Node: ${artifact.environment.node}; V8: ${artifact.environment.v8}\n- OS: ${artifact.environment.os} ${artifact.environment.release} (${artifact.environment.arch})\n- CPU: ${artifact.environment.cpu[0]?.model ?? 'unavailable'}\n- Replicates: ${artifact.runs.every((run) => run.execution.processIsolated) ? 'fresh process per replicate' : 'in-process (not suitable for submission)'}\n\n${mainTable}\n\n${comparisons}Raw measurements are in \`samples.jsonl\`; \`manifest.json\` is the machine-readable experiment record.\n`;
}

export function verifyArtifact(artifact: BenchmarkArtifact): void {
  if (artifact.schemaVersion !== 2) throw new Error('Unsupported artifact schema version.');
  if (artifact.runs.length === 0) throw new Error('Artifact contains no benchmark runs.');
  if (sha256(artifact.profile) !== artifact.integrity.profileSha256) throw new Error('Artifact profile hash does not match its manifest.');
  const actualRunIds = artifact.runs.map((run) => run.id).sort();
  const expectedRunIds = [...artifact.integrity.expectedRunIds].sort();
  if (stableJson(actualRunIds) !== stableJson(expectedRunIds)) throw new Error('Artifact run matrix does not match the manifest plan.');
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
    }
  }
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

export async function verifyArtifactFiles(input: string, artifact?: BenchmarkArtifact): Promise<void> {
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

export async function writeArtifact(outputDirectory: string, artifact: BenchmarkArtifact): Promise<void> {
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
  const persisted: BenchmarkArtifact = {
    ...sanitized,
    integrity: { ...sanitized.integrity, samplesSha256: contentSha256(samples) },
  };
  verifyArtifact(persisted);
  await writeFile(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(persisted, null, 2)}\n`);
  await writeFile(path.join(outputDirectory, 'samples.jsonl'), samples);
  await writeFile(path.join(outputDirectory, 'report.md'), renderReport(persisted));
}
