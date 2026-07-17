import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem, arch } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
  NodeBenchmarkWorkload,
  ProtocolBenchmarkWorkload,
} from '../harness/types';

const EMPTY_BYTES: BenchmarkWireBytes = { rendererToSimulator: 0, simulatorToRenderer: 0 };

export interface ResolvedProfileWorkload {
  modulePath: string;
  workload: BenchmarkWorkload;
  config: BenchmarkConfig;
}

export interface RunProfileOptions {
  repositoryRoot: string;
  profile: BenchmarkProfile;
  workloads: readonly ResolvedProfileWorkload[];
  suites: readonly BenchmarkSuite[];
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
  return profile as BenchmarkProfile;
}

export async function loadProfileWorkloads(profilePath: string, profile: BenchmarkProfile): Promise<ResolvedProfileWorkload[]> {
  return Promise.all(profile.workloads.map(async (entry) => {
    const modulePath = path.resolve(path.dirname(profilePath), entry.module);
    const imported = await import(pathToFileURL(modulePath).href);
    const workload = (imported.default ?? imported.workload) as BenchmarkWorkload | undefined;
    if (!workload || workload.schemaVersion !== 2 || !['protocol', 'node', 'browser'].includes(workload.kind)
      || !Array.isArray(workload.supportedSuites) || typeof workload.resolveConfig !== 'function') {
      throw new Error(`${modulePath} does not export a schema v2 benchmark workload.`);
    }
    const config = workload.resolveConfig(entry.config ?? {});
    return { modulePath, workload, config };
  }));
}

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
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
      timingsMs,
      metrics,
      messageCounts: counts,
      wireBytes,
      correctness: assertProtocolCorrectness(workload, config, validator, totalActions),
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
    timingsMs,
    metrics,
    messageCounts: {},
    wireBytes: { ...EMPTY_BYTES },
    correctness: { valid: true, actionCount: totalActions, stateHash, expectedStateHash },
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
  const { build, preview } = await import('vite');
  await build({ configFile, logLevel: 'error' });
  const server = await preview({
    configFile,
    preview: { host: '127.0.0.1', port: 0, open: false },
    logLevel: 'error',
  });
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
      timingsMs,
      metrics,
      messageCounts: counts,
      wireBytes,
      correctness: assertProtocolCorrectness(workload, config, validator, totalActions),
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

function summarize(values: readonly number[]): DistributionSummary {
  const sorted = [...values].sort((left, right) => left - right);
  const center = median(sorted);
  return {
    count: sorted.length,
    meanMs: sorted.length === 0 ? 0 : sorted.reduce((total, value) => total + value, 0) / sorted.length,
    medianMs: center,
    p95Ms: percentile(sorted, 0.95),
    madMs: median(sorted.map((value) => Math.abs(value - center))),
    bootstrapMedianCi95Ms: bootstrapMedianCi(values),
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
  for (const sample of samples) {
    for (const [name, series] of Object.entries(sample.metrics)) (values[name] ??= []).push(...series);
  }
  return Object.fromEntries(Object.entries(values).map(([name, series]) => [name, summarize(series)]));
}

function summarizeRun(samples: readonly BenchmarkReplicate[]): BenchmarkRunSummary {
  const timings = samples.flatMap((sample) => sample.timingsMs);
  return {
    cycle: summarize(timings),
    replicateMediansMs: samples.map((sample) => median(sample.timingsMs)),
    metrics: summarizeMetrics(samples),
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
      await page.goto(new URL('browser-runner.html', browserServer.pageUrl).href, { waitUntil: 'domcontentloaded' });
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
        stats?: { timings: number[]; mutationTimings?: number[]; completedFrames: number; measuredFrames: number; stopReason: string };
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
          timingsMs: result.stats.timings,
          metrics: result.stats.mutationTimings ? { browserMutationMs: result.stats.mutationTimings } : {},
          messageCounts: counts,
          wireBytes,
          correctness,
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
    await page.goto(new URL('browser-runner.html', browserServer.pageUrl).href, { waitUntil: 'domcontentloaded' });
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
      stats?: { timings: number[]; mutationTimings?: number[]; completedFrames: number; measuredFrames: number; stopReason: string };
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
        timingsMs: result.stats.timings,
        metrics: result.stats.mutationTimings ? { browserMutationMs: result.stats.mutationTimings } : {},
        messageCounts: {},
        wireBytes: { ...EMPTY_BYTES },
        correctness: { valid: true, actionCount, stateHash, expectedStateHash },
      },
    };
  } finally {
    await browser.close();
  }
}

async function runSuite(
  repositoryRoot: string,
  suite: BenchmarkSuite,
  resolved: ResolvedProfileWorkload,
  encoding: ProtocolEncoding | undefined,
  validation: ProtocolValidationLevel | undefined,
  profile: BenchmarkProfile,
): Promise<BenchmarkRun> {
  if (!resolved.workload.supportedSuites.includes(suite)) {
    throw new Error(`${resolved.workload.id} does not support the ${suite} suite.`);
  }
  const samples: BenchmarkReplicate[] = [];
  let browserVersion: string | undefined;
  const browserServer = suite === 'browser' ? await startBrowserServer(repositoryRoot) : undefined;
  try {
    for (let index = 0; index < profile.repetitions; index += 1) {
      if (suite === 'node') {
        if (resolved.workload.kind === 'browser') throw new Error(`${resolved.workload.id} is browser-only.`);
        samples.push(await runNodeReplicate(resolved.workload, resolved.config, encoding ?? 'json', validation ?? 'error', profile.warmupActions, profile.measuredActions, index));
      } else if (suite === 'ws') {
        if (resolved.workload.kind !== 'protocol' || !encoding || !validation) throw new Error(`${resolved.workload.id} has no WebSocket protocol path.`);
        samples.push(await runWsReplicate(resolved.workload, resolved.config, encoding, validation, profile.warmupActions, profile.measuredActions, index));
      } else {
        if (resolved.workload.kind === 'node') throw new Error(`${resolved.workload.id} is node-only.`);
        const result = resolved.workload.kind === 'protocol'
          ? await runProtocolBrowserReplicate(browserServer!, resolved.workload, resolved.config, encoding ?? 'json', validation ?? 'error', profile.warmupActions, profile.measuredActions, index)
          : await runBrowserWorkloadReplicate(browserServer!, resolved.workload, resolved.config, profile.warmupActions, profile.measuredActions, index);
        browserVersion = result.browserVersion;
        samples.push(result.sample);
      }
    }
  } finally {
    await browserServer?.close();
  }
  return {
    suite,
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
      ...(resolved.workload.kind === 'protocol' && encoding && validation ? { encoding, validation } : {}),
      warmupActions: profile.warmupActions,
      measuredActions: profile.measuredActions,
      repetitions: profile.repetitions,
      processIsolated: false,
      ...(browserVersion ? { browser: { name: 'chromium' as const, version: browserVersion, viewport: { width: 1280, height: 800, deviceScaleFactor: 1 }, headless: true as const } } : {}),
    },
    samples,
    summary: summarizeRun(samples),
  };
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

export async function runProfile(options: RunProfileOptions): Promise<BenchmarkArtifact> {
  const lockfilePath = path.join(options.repositoryRoot, 'pnpm-lock.yaml');
  const lockfileSha256 = await readFile(lockfilePath).then((contents) => createHash('sha256').update(contents).digest('hex')).catch(() => null);
  const packageJson = JSON.parse(await readFile(path.join(options.repositoryRoot, 'packages/benchmark/package.json'), 'utf8')) as { version: string };
  const runs: BenchmarkRun[] = [];
  for (const resolved of options.workloads) {
    for (const suite of options.suites) {
      if (!resolved.workload.supportedSuites.includes(suite)) continue;
      if (resolved.workload.kind !== 'protocol') {
        runs.push(await runSuite(options.repositoryRoot, suite, resolved, undefined, undefined, options.profile));
        continue;
      }
      for (const encoding of options.profile.encodings) for (const validation of options.profile.validation) {
        runs.push(await runSuite(options.repositoryRoot, suite, resolved, encoding, validation, options.profile));
      }
    }
  }
  const status = git(options.repositoryRoot, ['status', '--porcelain']);
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    profile: options.profile,
    harness: { package: '@tensnap/benchmark', version: packageJson.version, gitSha: git(options.repositoryRoot, ['rev-parse', 'HEAD']) },
    implementation: { gitSha: git(options.repositoryRoot, ['rev-parse', 'HEAD']), dirty: status === null ? null : status.length > 0, lockfileSha256 },
    environment: await collectEnvironment(),
    runs,
  };
}

function markdownNumber(value: number): string {
  return value.toFixed(3);
}

export function renderReport(artifact: BenchmarkArtifact): string {
  const rows = artifact.runs.map((run) => {
    const { cycle } = run.summary;
    const [lower, upper] = cycle.bootstrapMedianCi95Ms;
    const metrics = Object.entries(run.summary.metrics).map(([name, summary]) => `${name}: ${markdownNumber(summary.medianMs)}`).join('<br>') || '-';
    return `| ${run.suite} | ${run.workload.category} | ${run.workload.id} | ${run.execution.encoding ?? '-'} | ${run.execution.validation ?? '-'} | ${cycle.count} | ${markdownNumber(cycle.medianMs)} | ${markdownNumber(cycle.p95Ms)} | ${markdownNumber(lower)}–${markdownNumber(upper)} | ${metrics} | ${run.summary.wireBytes.rendererToSimulator} / ${run.summary.wireBytes.simulatorToRenderer} |`;
  }).join('\n');
  return `# TenSnap reproducible benchmark\n\nGenerated: ${artifact.generatedAt}\n\n- Commit: ${artifact.implementation.gitSha ?? 'unavailable'}${artifact.implementation.dirty ? ' (dirty)' : ''}\n- Node: ${artifact.environment.node}; V8: ${artifact.environment.v8}\n- OS: ${artifact.environment.os} ${artifact.environment.release} (${artifact.environment.arch})\n- CPU: ${artifact.environment.cpu[0]?.model ?? 'unavailable'}\n\n| Suite | Category | Workload | Encoding | Validation | Samples | Median ms | P95 ms | Run-median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |\n|---|---|---|---|---|---:|---:|---:|---:|---|---:|\n${rows}\n\nRaw measurements are in \`samples.jsonl\`; \`manifest.json\` is the machine-readable experiment record.\n`;
}

export function verifyArtifact(artifact: BenchmarkArtifact): void {
  if (artifact.schemaVersion !== 2) throw new Error('Unsupported artifact schema version.');
  if (artifact.runs.length === 0) throw new Error('Artifact contains no benchmark runs.');
  for (const run of artifact.runs) {
    if (run.workload.kind === 'protocol' && run.workload.protocolVersion !== '0.3') throw new Error(`${run.workload.id} is not a v0.3 protocol workload.`);
    if (run.samples.length !== run.execution.repetitions) throw new Error(`${run.workload.id}/${run.suite} has an incomplete repetition set.`);
    for (const sample of run.samples) {
      if (!sample.correctness.valid || sample.correctness.stateHash !== sample.correctness.expectedStateHash) {
        throw new Error(`${run.workload.id}/${run.suite} failed semantic verification.`);
      }
      if (sample.timingsMs.length !== run.execution.measuredActions) {
        throw new Error(`${run.workload.id}/${run.suite} has an incomplete timing series.`);
      }
    }
  }
}

export async function writeArtifact(outputDirectory: string, artifact: BenchmarkArtifact): Promise<void> {
  verifyArtifact(artifact);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  const samples = artifact.runs.flatMap((run) => run.samples.map((sample) => JSON.stringify({
    suite: run.suite,
    workload: run.workload,
    execution: run.execution,
    sample,
  }))).join('\n');
  await writeFile(path.join(outputDirectory, 'samples.jsonl'), `${samples}\n`);
  await writeFile(path.join(outputDirectory, 'report.md'), renderReport(artifact));
}
