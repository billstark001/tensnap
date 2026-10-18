import { LRUCache } from 'lru-cache';
import { gzipSync, gunzipSync } from 'fflate';
import { z } from 'zod';
import { decodeMessagePack, encodeMessagePack } from '@tensnap/protocol';
import type { ScenarioSnapshot } from '../scenario';
import { queryScenario, type ScenarioQuery, type QueryLocation } from '../scenario/query';
import { Scenario } from '../scenario/Scenario';
import type { CapturedFrame, SnapshotFrame, SnapshotModelIdentity } from '../snapshot';
import { ScenarioSnapshotSchema } from './project';
import { omitUndefinedObjectProperties } from './serialization';

/** Host I/O owns atomic root publication and exclusive writer ownership. Immutable writes must not overwrite. */
export interface RecordingStoreBackend {
  read(key: string): Promise<Uint8Array>;
  put(key: string, bytes: Uint8Array): Promise<boolean>;
  publishRoot(expectedGeneration: number, bytes: Uint8Array): Promise<void>;
  list(): AsyncIterable<string>;
  remove(key: string): Promise<void>;
  acquireWriter(): Promise<() => Promise<void>>;
  pin(generation: number): Promise<() => Promise<void>>;
  pinnedGenerations(): Promise<number[]>;
  putIndex(row: StoreIndexRow): Promise<void>;
  findIndex(query: StoreIndexQuery): Promise<StoreIndexRow | undefined>;
  frameIndex(firstFrame: number, lastFrame: number): AsyncIterable<StoreIndexRow>;
  pruneIndex(firstFrame: number): Promise<void>;
  clearIndex(): Promise<void>;
}

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const referenceSchema = z
  .object({
    hash: hashSchema,
    bytes: z.number().int().positive(),
    decodedBytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 * 1024),
    codec: z.literal('msgpack+gzip'),
  })
  .strict();

export type StoreReference = z.infer<typeof referenceSchema>;

export interface StoreIndexRow {
  frame: number;
  time?: number;
  requestId?: string;
  ref: StoreReference;
}

export interface StoreIndexQuery {
  firstFrame: number;
  lastFrame: number;
  by: 'frame' | 'time' | 'request';
  value: number | string;
  match: 'first' | 'last' | 'before' | 'after';
}

const locationSchema = z
  .object({
    kind: z.literal('recording'),
    sourceId: z.string(),
    revision: z.union([z.string(), z.number()]),
    frame: z.number().int().nonnegative(),
    modelTime: z.number().finite().optional(),
    actionRequestId: z.string().optional(),
    generation: z.number().int().optional(),
  })
  .strict();

const rootSchema = z
  .object({
    kind: z.literal('tensnap-recording-store'),
    version: z.literal(1),
    generation: z.number().int().positive(),
    id: z.string().min(1),
    firstFrame: z.number().int().nonnegative(),
    lastFrame: z.number().int().nonnegative(),
    observedFrame: z.number().int().nonnegative(),
    count: z.number().int().positive(),
    indexVersion: z.literal(1),
    lastSegment: referenceSchema,
    streamStart: referenceSchema,
    mode: z.enum(['full-history', 'rolling']),
    maxFrames: z.number().int().positive().optional(),
    truncated: z.boolean(),
    status: z.enum(['open', 'complete', 'failed']),
    error: z.string().optional(),
    summary: referenceSchema.optional(),
    storedBytes: z.number().int().nonnegative(),
    modelIdentity: z
      .object({
        model_id: z.string(),
        state_schema_version: z.string().optional(),
        instance_id: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type RecordingStoreRoot = z.infer<typeof rootSchema>;

interface StoredBoundary {
  kind: 'boundary';
  version: 1;
  location: QueryLocation;
  timestamp: number;
  scene: ScenarioSnapshot;
  /** Stream deltas are stored separately from the current-value scene baseline. */
  stream: StoreReference;
  previous?: StoreReference;
  checkpoint?: CapturedFrame['checkpoint'];
  provenance?: CapturedFrame['source'];
  annotations?: unknown[];
  assets: Array<{ id: string; ref: StoreReference }>;
  frame?: SnapshotFrame;
}

const boundarySchema = z
  .object({
    kind: z.literal('boundary'),
    version: z.literal(1),
    location: locationSchema,
    timestamp: z.number().finite(),
    scene: ScenarioSnapshotSchema,
    stream: referenceSchema,
    previous: referenceSchema.optional(),
    checkpoint: z
      .object({
        model_id: z.string(),
        state_schema_version: z.string().optional(),
        encoding: z.string(),
        data: z.union([z.string(), z.instanceof(Uint8Array)]),
      })
      .strict()
      .optional(),
    assets: z.array(z.object({ id: z.string(), ref: referenceSchema }).strict()),
    provenance: z.unknown().optional(),
    annotations: z.array(z.unknown()).optional(),
    frame: z.unknown().optional(),
  })
  .strict();
const streamTypes = new Set(['chart_create', 'chart_update', 'chart_delete', 'log', 'error']);
const encode = (value: unknown) => encodeMessagePack(omitUndefinedObjectProperties(value));
export async function storeHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Content-addressed, bounded page cache. Returned objects never escape to callers. */
class Objects {
  readonly stats = { bytesRead: 0, objectsRead: 0, cacheBytes: 0, peakCacheBytes: 0 };
  writtenBytes = 0;
  private readonly cache: LRUCache<string, { bytes: number; value: unknown }>;
  constructor(
    readonly backend: RecordingStoreBackend,
    private readonly maxCacheBytes: number,
  ) {
    this.cache = new LRUCache({ maxSize: maxCacheBytes, sizeCalculation: (value) => value.bytes });
  }
  async get<T>(ref: StoreReference): Promise<T> {
    const cached = this.cache.get(ref.hash);
    if (cached) {
      return cached.value as T;
    }
    const bytes = await this.backend.read(`objects/${ref.hash}`);
    this.stats.bytesRead += bytes.length;
    this.stats.objectsRead++;
    if (bytes.length !== ref.bytes || (await storeHash(bytes)) !== ref.hash)
      throw new Error(`Corrupt store object ${ref.hash}.`);
    const raw = gunzipSync(bytes, { out: new Uint8Array(ref.decodedBytes) });
    if (raw.length !== ref.decodedBytes) throw new Error('Invalid decoded object length.');
    const value = decodeMessagePack<T>(raw);
    if (ref.decodedBytes <= this.maxCacheBytes) {
      this.cache.set(ref.hash, { bytes: ref.decodedBytes, value });
      this.stats.cacheBytes = this.cache.calculatedSize;
      this.stats.peakCacheBytes = Math.max(this.stats.peakCacheBytes, this.stats.cacheBytes);
    }
    return value;
  }
  async put(value: unknown): Promise<StoreReference> {
    const raw = encode(value);
    if (raw.length > 64 * 1024 * 1024)
      throw new Error('Store object exceeds the decoded object budget.');
    const bytes = gzipSync(raw, { level: 1 }),
      hash = await storeHash(bytes);
    if (await this.backend.put(`objects/${hash}`, bytes)) this.writtenBytes += bytes.length;
    const ref: StoreReference = {
      hash,
      bytes: bytes.length,
      decodedBytes: raw.length,
      codec: 'msgpack+gzip',
    };
    // Verify host writes before allowing a root to reference the object.
    const stored = await this.backend.read(`objects/${hash}`);
    if (stored.length !== bytes.length || (await storeHash(stored)) !== hash)
      throw new Error(`Incomplete store write ${hash}.`);
    return ref;
  }
}

export interface RecordingStoreOptions {
  id: string;
  mode: 'full-history' | 'rolling';
  maxFrames?: number;
  maxSegmentBytes?: number;
  maxPendingBytes?: number;
  maxPendingSegments?: number;
  maxStoredBytes?: number;
  cacheBytes?: number;
  modelIdentity?: SnapshotModelIdentity;
}

/** Incremental writer. Each append owns its atomic input before any await. */
export class RecordingStoreWriter {
  private rootValue?: RecordingStoreRoot;
  private tail?: StoreReference;
  private readonly objects: Objects;
  private readonly options: RecordingStoreOptions;
  private chain: Promise<void> = Promise.resolve();
  private pendingBytes = 0;
  private pendingSegments = 0;
  private observedFrame = -1;
  private nextGeneration = 1;
  private failure?: Error;
  private closed = false;
  private constructor(
    private readonly backend: RecordingStoreBackend,
    options: RecordingStoreOptions,
    private readonly release: () => Promise<void>,
  ) {
    this.options = structuredClone(options);
    this.objects = new Objects(backend, options.cacheBytes ?? 1024 * 1024);
  }
  static async create(backend: RecordingStoreBackend, options: RecordingStoreOptions) {
    if (
      !options.id ||
      !['full-history', 'rolling'].includes(options.mode) ||
      (options.mode === 'rolling' && options.maxFrames === undefined)
    )
      throw new Error('Store identity/mode and rolling frame budget are required.');
    for (const key of [
      'maxFrames',
      'maxSegmentBytes',
      'maxPendingBytes',
      'maxPendingSegments',
      'maxStoredBytes',
      'cacheBytes',
    ] as const)
      if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key]! < 1))
        throw new Error(`Invalid store ${key}.`);
    const release = await backend.acquireWriter();
    try {
      let exists = false;
      for await (const key of backend.list())
        if (key === 'root') {
          exists = true;
          break;
        }
      if (exists)
        throw new Error('A recording store already exists; interrupted stores are read-only.');
      return new RecordingStoreWriter(backend, options, release);
    } catch (error) {
      await release();
      throw error;
    }
  }
  get status() {
    return {
      root: this.rootValue ? structuredClone(this.rootValue) : undefined,
      observedFrame: this.observedFrame,
      committedFrame: this.rootValue?.lastFrame,
      pendingBytes: this.pendingBytes,
      pendingSegments: this.pendingSegments,
      backpressure: this.pendingSegments > 0,
      error: this.failure?.message,
    };
  }
  append(input: {
    location: QueryLocation;
    timestamp: number;
    scene: ScenarioSnapshot;
    frame?: SnapshotFrame;
    checkpoint?: CapturedFrame['checkpoint'];
    provenance?: CapturedFrame['source'];
    annotations?: unknown[];
  }): Promise<void> {
    if (this.closed || this.failure)
      return Promise.reject(this.failure ?? new Error('Store writer is closed.'));
    if (!Number.isSafeInteger(input.location.frame) || input.location.frame! <= this.observedFrame)
      return Promise.reject(new Error('Store boundaries must increase strictly.'));
    // Encoding transfers ownership now. A caller may mutate/reuse the input after this method returns.
    const first = this.observedFrame < 0;
    const bytes = encode({
      ...input,
      initialStreams: first ? { charts: input.scene.charts, logs: input.scene.logs } : undefined,
      scene: {
        ...input.scene,
        logs: [],
        charts: input.scene.charts.map((c) => ({
          ...c,
          data: c.data.length ? [c.data[c.data.length - 1]] : [],
        })),
      },
    });
    this.observedFrame = input.location.frame!;
    if (
      bytes.length > (this.options.maxSegmentBytes ?? 4 * 1024 * 1024) ||
      bytes.length + this.pendingBytes > (this.options.maxPendingBytes ?? 8 * 1024 * 1024) ||
      this.pendingSegments >= (this.options.maxPendingSegments ?? 2)
    ) {
      this.failure = new Error(
        'Atomic frame or pending recording queue exceeds its configured budget.',
      );
      return Promise.reject(this.failure);
    }
    this.pendingBytes += bytes.length;
    this.pendingSegments++;
    const work = this.chain
      .then(async () => {
        if (this.failure) throw this.failure;
        const owned = decodeMessagePack<
          typeof input & { initialStreams?: Pick<ScenarioSnapshot, 'charts' | 'logs'> }
        >(bytes);
        await this.commit(owned);
      })
      .catch((error) => {
        this.failure ??= error instanceof Error ? error : new Error(String(error));
        throw error;
      })
      .finally(() => {
        this.pendingBytes -= bytes.length;
        this.pendingSegments--;
      });
    this.chain = work.catch(() => {});
    return work;
  }
  private async commit(input: {
    location: QueryLocation;
    timestamp: number;
    scene: ScenarioSnapshot;
    frame?: SnapshotFrame;
    checkpoint?: CapturedFrame['checkpoint'];
    provenance?: CapturedFrame['source'];
    annotations?: unknown[];
    initialStreams?: Pick<ScenarioSnapshot, 'charts' | 'logs'>;
  }) {
    const scene = input.scene;
    const initial = !this.rootValue;
    const stream = await this.objects.put(
      initial
        ? { initial: input.initialStreams }
        : { messages: input.frame?.messages.filter((m) => streamTypes.has(m.type)) ?? [] },
    );
    // Current-value monitors and latest chart samples are independently recoverable.
    const compact = {
      ...scene,
      logs: [],
      charts: scene.charts.map((c) => ({
        ...c,
        data: c.data.length ? [c.data[c.data.length - 1]] : [],
      })),
    };
    const assets: StoredBoundary['assets'] = [];
    for (const asset of compact.assets)
      if (asset.data !== undefined) {
        assets.push({
          id: asset.meta.id,
          ref: await this.objects.put({ kind: 'asset', hash: asset.meta.hash, data: asset.data }),
        });
      }
    compact.assets = compact.assets.map((asset) => ({ meta: asset.meta }));
    const location: QueryLocation = {
      ...input.location,
      kind: 'recording',
      sourceId: this.options.id,
    };
    const boundary: StoredBoundary = {
      kind: 'boundary',
      version: 1,
      location,
      timestamp: input.timestamp,
      scene: compact,
      stream,
      previous: this.tail,
      assets,

      checkpoint: input.checkpoint,
      annotations: input.annotations,
      provenance: input.provenance,
      frame: input.frame ? { ...input.frame, messages: [] } : undefined,
    };
    boundarySchema.parse(boundary);
    const segment = await this.objects.put(boundary);
    const frame = location.frame!;
    await this.backend.put(
      `segments/${String(frame).padStart(16, '0')}`,
      encode({
        frame,
        ref: segment,
        time: location.modelTime,
        requestId: location.actionRequestId,
      }),
    );
    await this.backend.putIndex({
      frame,
      ref: segment,
      time: location.modelTime,
      requestId: location.actionRequestId,
    });
    const generation = this.nextGeneration++;
    let count = (this.rootValue?.count ?? 0) + 1;
    const firstFrame =
      this.options.mode === 'rolling'
        ? Math.max(this.rootValue?.firstFrame ?? frame, frame - this.options.maxFrames!)
        : (this.rootValue?.firstFrame ?? frame);
    if (this.options.mode === 'rolling') {
      count = 0;
      for await (const _row of this.backend.frameIndex(firstFrame, frame)) count++;
    }
    const root: RecordingStoreRoot = {
      kind: 'tensnap-recording-store',
      version: 1,
      generation,
      id: this.options.id,
      firstFrame,
      lastFrame: frame,
      observedFrame: this.observedFrame,
      count,
      indexVersion: 1,
      lastSegment: segment,
      streamStart:
        this.options.mode === 'rolling'
          ? (await this.backend.findIndex({
              firstFrame,
              lastFrame: frame,
              by: 'frame',
              value: firstFrame,
              match: 'after',
            }))!.ref
          : (this.rootValue?.streamStart ?? segment),
      mode: this.options.mode,
      maxFrames: this.options.maxFrames,
      truncated:
        firstFrame > (this.rootValue?.firstFrame ?? frame) || (this.rootValue?.truncated ?? false),
      status: 'open',
      storedBytes: 0,
      modelIdentity: this.options.modelIdentity,
    };
    // Count actual immutable objects, including uncollected COW pages, separately from Snapshot estimates.
    const total = this.objects.writtenBytes;
    root.storedBytes = total;
    if (total > (this.options.maxStoredBytes ?? Infinity))
      throw new Error('Full recording storage budget exhausted.');
    await this.publish(root);
    this.tail = segment;
  }
  private async publish(root: RecordingStoreRoot) {
    const bytes = encode(rootSchema.parse(root));
    await this.backend.put(`roots/${root.generation}`, bytes);
    await this.backend.publishRoot(this.rootValue?.generation ?? 0, bytes);
    this.rootValue = root;
  }
  async collect(): Promise<{ removedBytes: number }> {
    await this.chain;
    if (this.pendingSegments || this.closed)
      throw new Error('Drain the writer before garbage collection.');
    if (!this.rootValue) return { removedBytes: 0 };
    const keepGenerations = new Set([
      this.rootValue.generation,
      ...(await this.backend.pinnedGenerations()),
    ]);
    const reachable = new Set<string>();
    let minimumFrame = this.rootValue.firstFrame;
    const visitBoundary = async (ref: StoreReference): Promise<void> => {
      if (reachable.has(ref.hash)) return;
      reachable.add(ref.hash);
      const boundary = boundarySchema.parse(await this.objects.get(ref)) as StoredBoundary;
      reachable.add(boundary.stream.hash);
      for (const asset of boundary.assets) reachable.add(asset.ref.hash);
    };
    for (const generation of keepGenerations) {
      const root = rootSchema.parse(
        decodeMessagePack(await this.backend.read(`roots/${generation}`)),
      );
      minimumFrame = Math.min(minimumFrame, root.firstFrame);
      if (root.summary) reachable.add(root.summary.hash);
      for await (const row of this.backend.frameIndex(root.firstFrame, root.lastFrame))
        await visitBoundary(row.ref);
    }
    let removedBytes = 0;
    // Delete index entries only after protecting every pinned generation.
    await this.backend.pruneIndex(minimumFrame);
    for await (const key of this.backend.list()) {
      if (key.startsWith('objects/') && !reachable.has(key.slice(8))) {
        removedBytes += (await this.backend.read(key)).length;
        await this.backend.remove(key);
      }
      if (key.startsWith('roots/') && !keepGenerations.has(Number(key.slice(6))))
        await this.backend.remove(key);
      if (key.startsWith('segments/') && Number(key.slice(9)) < minimumFrame)
        await this.backend.remove(key);
    }
    this.objects.writtenBytes -= removedBytes;
    return { removedBytes };
  }

  abort(error: unknown): void {
    this.failure ??= error instanceof Error ? error : new Error(String(error));
  }

  async close(summary?: unknown): Promise<RecordingStoreRoot | undefined> {
    summary = structuredClone(summary);
    if (this.closed) throw new Error('Store writer already closed.');
    this.closed = true;
    try {
      await this.chain;
      if (this.rootValue)
        await this.publish({
          ...this.rootValue,
          generation: this.nextGeneration++,
          observedFrame: this.observedFrame,
          status: this.failure ? 'failed' : 'complete',
          summary: summary === undefined ? undefined : await this.objects.put(summary),
          error: this.failure?.message,
        });
      if (this.failure) throw this.failure;
      return this.rootValue ? structuredClone(this.rootValue) : undefined;
    } finally {
      await this.release();
    }
  }
}

/** Readers pin one generation and share a byte-bounded cache across selections and exports. */
export class RecordingStoreReader {
  private readonly objects: Objects;
  private closed = false;
  private constructor(
    private readonly backend: RecordingStoreBackend,
    private readonly rootValue: RecordingStoreRoot,
    private readonly release: () => Promise<void>,
    cacheBytes: number,
  ) {
    this.objects = new Objects(backend, cacheBytes);
  }
  static async open(
    backend: RecordingStoreBackend,
    options: { cacheBytes?: number } = {},
  ): Promise<RecordingStoreReader> {
    const root = rootSchema.parse(decodeMessagePack(await backend.read('root')));
    const release = await backend.pin(root.generation);
    const latest = rootSchema.parse(decodeMessagePack(await backend.read('root')));
    if (latest.generation !== root.generation) {
      await release();
      return this.open(backend, options);
    }
    return new RecordingStoreReader(backend, root, release, options.cacheBytes ?? 1024 * 1024);
  }
  get root() {
    return structuredClone(this.rootValue);
  }
  get metrics() {
    return { ...this.objects.stats };
  }
  private assertOpen() {
    if (this.closed) throw new Error('Store reader is closed.');
  }
  private async boundary(ref: StoreReference): Promise<StoredBoundary> {
    return boundarySchema.parse(await this.objects.get(ref)) as StoredBoundary;
  }
  async select(
    selection:
      | { frame: number }
      | { time: number; match: 'first' | 'last' | 'before' | 'after' }
      | { requestId: string; match: 'first' | 'last' },
  ): Promise<QueryLocation> {
    this.assertOpen();
    const query: StoreIndexQuery = {
      firstFrame: this.root.firstFrame,
      lastFrame: this.root.lastFrame,
      by: 'frame' in selection ? 'frame' : 'time' in selection ? 'time' : 'request',
      value:
        'frame' in selection
          ? selection.frame
          : 'time' in selection
            ? selection.time
            : selection.requestId,
      match: 'frame' in selection ? 'first' : selection.match,
    };
    if (
      typeof query.value === 'number' &&
      (!Number.isFinite(query.value) ||
        (query.by === 'frame' && !Number.isSafeInteger(query.value)))
    )
      throw new Error('Invalid recording selection.');
    const row = await this.backend.findIndex(query);
    if (!row) throw new Error('No matching retained boundary.');
    const result = await this.boundary(row.ref);
    return { ...result.location, generation: this.root.generation };
  }
  private async get(frame: number): Promise<StoredBoundary> {
    this.assertOpen();
    if (!Number.isSafeInteger(frame)) throw new Error('Invalid frame index.');
    const row = await this.backend.findIndex({
      firstFrame: this.root.firstFrame,
      lastFrame: this.root.lastFrame,
      by: 'frame',
      value: frame,
      match: 'first',
    });
    if (!row) throw new Error('Frame outside retained range or missing from index.');
    const result = await this.boundary(row.ref);
    if (result.location.frame !== frame) throw new Error('Index disagrees with segment boundary.');
    return result;
  }
  async query(frame: number, input: ScenarioQuery) {
    input = structuredClone(input);
    this.assertOpen();
    const boundary = await this.get(frame);
    return queryScenario(boundary.scene, input, {
      ...boundary.location,
      generation: this.root.generation,
    });
  }
  async readFrame(
    frame: number,
    options: { history?: 'full' | 'active'; signal?: AbortSignal } = {},
  ): Promise<CapturedFrame> {
    this.assertOpen();
    options = { ...options };
    if (options.signal?.aborted) throw new Error('Store read cancelled.');
    const boundary = await this.get(frame);
    let scene = structuredClone(boundary.scene);
    if ((options.history ?? 'full') === 'full') {
      const scenario = new Scenario();
      scenario.load({ ...scene, charts: [], logs: [] });
      const first = this.root.mode === 'rolling' ? this.root.firstFrame : 0;
      for await (const entry of this.backend.frameIndex(first, frame)) {
        if (options.signal?.aborted) throw new Error('Store read cancelled.');
        const state = await this.boundary(entry.ref);
        const chunk = await this.objects.get<{
          initial?: Pick<ScenarioSnapshot, 'charts' | 'logs'>;
          messages?: SnapshotFrame['messages'];
        }>(state.stream);
        if (chunk.initial) {
          scenario.load({
            ...scenario.dump(),
            charts: chunk.initial.charts,
            logs: chunk.initial.logs,
          });
        } else {
          // Rolling starts from the independently recoverable stream window baseline.
          if (entry.frame === this.root.firstFrame && this.root.mode === 'rolling')
            scenario.charts.load(state.scene.charts);
          else for (const message of chunk.messages ?? []) scenario.apply(message);
        }
      }
      scene = {
        ...scene,
        charts: scenario.charts.dump(),
        logs: structuredClone([...scenario.logs]),
      };
    }
    for (const asset of boundary.assets) {
      const payload = await this.objects.get<{ data: string | Uint8Array }>(asset.ref);
      const target = scene.assets.find((a) => a.meta.id === asset.id);
      if (target) target.data = structuredClone(payload.data);
    }
    if (options.signal?.aborted) throw new Error('Store read cancelled.');
    return {
      id: `${this.root.id}:${frame}`,
      capturedAt: boundary.timestamp,
      scene,
      modelIdentity: structuredClone(this.root.modelIdentity),
      source: boundary.provenance
        ? structuredClone(boundary.provenance)
        : {
            kind: 'recording',
            recordingId: this.root.id,
            frame,
            actionRequestId: boundary.location.actionRequestId,
            modelTime: boundary.location.modelTime,
            commitRevision:
              typeof boundary.location.revision === 'number'
                ? boundary.location.revision
                : undefined,
          },
      checkpoint: structuredClone(boundary.checkpoint),
      consistency: boundary.checkpoint ? 'aligned' : 'renderer-only',
      checkpointStatus: boundary.checkpoint ? 'captured' : 'unavailable',
    };
  }
  async *range(from: number, to: number, options: { signal?: AbortSignal } = {}) {
    this.assertOpen();
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from > to ||
      from < this.root.firstFrame ||
      to > this.root.lastFrame
    )
      throw new Error('Invalid store range.');
    for await (const entry of this.backend.frameIndex(from, to)) {
      if (options.signal?.aborted) throw new Error('Store range cancelled.');
      yield await this.readFrame(entry.frame, options);
    }
  }
  async nextLocation(frame: number): Promise<QueryLocation | undefined> {
    this.assertOpen();
    const row = await this.backend.findIndex({
      firstFrame: this.root.firstFrame,
      lastFrame: this.root.lastFrame,
      by: 'frame',
      value: frame + 1,
      match: 'after',
    });
    if (!row) return undefined;
    const boundary = await this.boundary(row.ref);
    return structuredClone({ ...boundary.location, generation: this.root.generation });
  }
  async *locations(from = this.root.firstFrame, to = this.root.lastFrame, signal?: AbortSignal) {
    this.assertOpen();
    for await (const row of this.backend.frameIndex(
      Math.max(from, this.root.firstFrame),
      Math.min(to, this.root.lastFrame),
    )) {
      if (signal?.aborted) throw new Error('Store iteration cancelled.');
      const boundary = await this.boundary(row.ref);
      yield structuredClone({ ...boundary.location, generation: this.root.generation });
    }
  }

  /** Range copy streams one independent scene and its stream delta at a time. */
  async exportRange(writer: RecordingStoreWriter, from: number, to: number, signal?: AbortSignal) {
    if (from > to || from < this.root.firstFrame || to > this.root.lastFrame)
      throw new Error('Invalid export range.');
    let first = true;
    for await (const location of this.locations(from, to, signal)) {
      const boundary = await this.get(location.frame!);
      const frame = await this.readFrame(location.frame!, {
        history: first ? 'full' : 'active',
        signal,
      });
      const stream = await this.objects.get<{ messages?: SnapshotFrame['messages'] }>(
        boundary.stream,
      );
      await writer.append({
        location,
        timestamp: frame.capturedAt,
        scene: frame.scene,
        checkpoint: frame.checkpoint,
        provenance: frame.source,
        annotations: boundary.annotations,
        frame: boundary.frame ? { ...boundary.frame, messages: stream.messages ?? [] } : undefined,
      });
      first = false;
    }
  }

  async summary(): Promise<unknown> {
    this.assertOpen();
    return this.root.summary
      ? structuredClone(await this.objects.get(this.root.summary))
      : undefined;
  }
  async *annotations(from: number, to: number) {
    this.assertOpen();
    for await (const row of this.backend.frameIndex(
      Math.max(this.root.firstFrame, from),
      Math.min(to, this.root.lastFrame),
    )) {
      const boundary = await this.boundary(row.ref);
      if (boundary.annotations?.length)
        yield { location: boundary.location, annotations: structuredClone(boundary.annotations) };
    }
  }
  async recover() {
    const errors: Array<{ frame?: number; reason: string }> = [];
    let lastFrame: number | undefined;
    let previous: StoreReference | undefined;
    let count = 0;
    try {
      for await (const entry of this.backend.frameIndex(
        this.root.firstFrame,
        this.root.lastFrame,
      )) {
        try {
          const state = await this.boundary(entry.ref);
          if (
            state.location.frame !== entry.frame ||
            (previous && state.previous?.hash !== previous.hash)
          )
            throw new Error('Committed index/segment chain has a gap.');
          await this.objects.get(state.stream);
          for (const asset of state.assets) await this.objects.get(asset.ref);
          lastFrame = state.location.frame;
          previous = entry.ref;
          count++;
        } catch (error) {
          errors.push({ frame: entry.frame, reason: String(error) });
          break;
        }
      }
    } catch (error) {
      errors.push({ reason: `index: ${String(error)}` });
    }
    if (
      !errors.length &&
      (lastFrame !== this.root.lastFrame ||
        previous?.hash !== this.root.lastSegment.hash ||
        count !== this.root.count)
    )
      errors.push({
        reason: 'Committed index is incomplete; rebuild it from immutable segment descriptors.',
      });
    return {
      generation: this.root.generation,
      status: this.root.status === 'open' ? 'interrupted' : this.root.status,
      committedRange: { from: this.root.firstFrame, to: this.root.lastFrame },
      recoverablePrefix:
        lastFrame === undefined ? undefined : { from: this.root.firstFrame, to: lastFrame },
      uncommittedRange:
        this.root.observedFrame > this.root.lastFrame
          ? { from: this.root.lastFrame + 1, to: this.root.observedFrame }
          : undefined,
      complete: this.root.status === 'complete' && errors.length === 0,
      errors,
    };
  }
  async close() {
    if (!this.closed) {
      this.closed = true;
      await this.release();
    }
  }
}
