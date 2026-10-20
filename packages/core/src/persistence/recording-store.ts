import { LRUCache } from 'lru-cache';
import { gzipSync, gunzipSync } from 'fflate';
import { z } from 'zod';
import {
  decodeMessagePack,
  encodeMessagePack,
  SimulatorToRendererMessageSchema,
  RendererToSimulatorMessageSchema,
  ActionResultPayloadSchema,
  CheckpointSchema,
} from '@tensnap/protocol';
import type { ScenarioSnapshot } from '../scenario';
import { queryScenario } from '../scenario/query';
import { type ScenarioQuery, type QueryLocation } from '../scenario/query-schema';
import { Scenario } from '../scenario/Scenario';
import type { CapturedFrame, SnapshotFrame, SnapshotModelIdentity } from '../snapshot';
import { ScenarioSnapshotSchema } from './project';
import { omitUndefinedObjectProperties } from './serialization';

/** Host I/O owns atomic root publication and exclusive writer ownership. Immutable writes must not overwrite. */
export interface RecordingStoreBackend {
  read(key: string): Promise<Uint8Array>;
  put(key: string, bytes: Uint8Array): Promise<boolean>;
  publishRoot(expectedGeneration: number, bytes: Uint8Array): Promise<void>;
  list(prefix?: string): AsyncIterable<string>;
  remove(key: string): Promise<void>;
  acquireWriter(): Promise<() => Promise<void>>;
  isWriterActive(): Promise<boolean>;
  pin(generation: number): Promise<() => Promise<void>>;
  pinnedGenerations(): Promise<number[]>;
  putIndex(row: StoreIndexRow): Promise<void>;
  findIndex(query: StoreIndexQuery): Promise<StoreIndexRow | undefined>;
  frameIndex(firstFrame: number, lastFrame: number): AsyncIterable<StoreIndexRow>;
  streamIndex(firstFrame: number, lastFrame: number): AsyncIterable<StoreIndexRow>;
  pruneIndex(firstFrame: number): Promise<void>;
  rebuildIndex(rows: AsyncIterable<StoreIndexRow>): Promise<void>;
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
  stream?: boolean;
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
    modelTime: z.number().optional(),
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

const provenanceSchema = z
  .object({
    kind: z.enum(['live', 'recording']),
    recordingId: z.string().optional(),
    frame: z.number().int().nonnegative().optional(),
    actionRequestId: z.string().optional(),
    modelTime: z.number().optional(),
    commitRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
const storedFrameSchema = z
  .object({
    index: z.number().int().nonnegative(),
    timestamp: z.number(),
    kind: z.enum(['action', 'control', 'sync']),
    source: z.enum(['action', 'lifecycle']).optional(),
    messages: z.array(SimulatorToRendererMessageSchema),
    controls: z.array(RendererToSimulatorMessageSchema),
    action: ActionResultPayloadSchema.optional(),
  })
  .strict();
const boundarySchema = z
  .object({
    kind: z.literal('boundary'),
    version: z.literal(1),
    location: locationSchema,
    timestamp: z.number(),
    scene: ScenarioSnapshotSchema,
    stream: referenceSchema,
    previous: referenceSchema.optional(),
    checkpoint: CheckpointSchema.extend({
      model_id: z.string().min(1),
      state_schema_version: z.string().optional(),
    })
      .strict()
      .optional(),
    assets: z.array(z.object({ id: z.string(), ref: referenceSchema }).strict()),
    provenance: provenanceSchema.optional(),
    annotations: z.array(z.unknown()).optional(),
    frame: storedFrameSchema.optional(),
  })
  .strict();
const streamTypes = new Set(['chart_create', 'chart_update', 'chart_delete']);
const encode = (value: unknown) => encodeMessagePack(omitUndefinedObjectProperties(value));
export async function storeHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Content-addressed, bounded page cache. Returned objects never escape to callers. */
class Objects {
  readonly stats = { bytesRead: 0, objectsRead: 0, cacheBytes: 0, peakCacheBytes: 0 };
  writtenBytes = 0;
  private readonly writtenReferences = new LRUCache<string, StoreReference>({ max: 512 });
  private readonly cache: LRUCache<string, { bytes: number; encodedBytes: number; value: unknown }>;
  constructor(
    readonly backend: RecordingStoreBackend,
    private readonly maxCacheBytes: number,
    private readonly availableBytes: () => number = () => Infinity,
  ) {
    this.cache = new LRUCache({ maxSize: maxCacheBytes, sizeCalculation: (value) => value.bytes });
  }
  forget(hash: string) {
    this.cache.delete(hash);
    this.writtenReferences.delete(hash);
  }
  async get<T>(ref: StoreReference): Promise<T> {
    ref = referenceSchema.parse(ref);
    const cached = this.cache.get(ref.hash);
    if (cached) {
      if (cached.bytes !== ref.decodedBytes || cached.encodedBytes !== ref.bytes)
        throw new Error('Conflicting cached object reference.');
      return cached.value as T;
    }
    const bytes = await this.backend.read(`objects/${ref.hash}`);
    this.stats.bytesRead += bytes.length;
    this.stats.objectsRead++;
    if (bytes.length !== ref.bytes || (await storeHash(bytes)) !== ref.hash)
      throw new Error(`Corrupt store object ${ref.hash}.`);
    // Gzip's trailer declares the uncompressed size. Validate it before allocating a decode buffer.
    if (
      bytes.length < 18 ||
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
        bytes.length - 4,
        true,
      ) !== ref.decodedBytes
    )
      throw new Error('Invalid decoded object length.');
    const raw = gunzipSync(bytes, { out: new Uint8Array(ref.decodedBytes) });
    if (raw.length !== ref.decodedBytes) throw new Error('Invalid decoded object length.');
    const decoded = decodeMessagePack<T>(raw);
    const value =
      decoded && typeof decoded === 'object' && 'kind' in decoded && decoded.kind === 'boundary'
        ? (boundarySchema.parse(decoded) as T)
        : decoded;
    if (ref.decodedBytes <= this.maxCacheBytes) {
      this.cache.set(ref.hash, { bytes: ref.decodedBytes, encodedBytes: ref.bytes, value });
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
    const ref: StoreReference = {
      hash,
      bytes: bytes.length,
      decodedBytes: raw.length,
      codec: 'msgpack+gzip',
    };
    const existing = this.writtenReferences.get(hash);
    if (existing) return existing;
    if (bytes.length > this.availableBytes()) {
      // A deduplicated asset/stream consumes no new storage. Check only when admission is tight.
      try {
        const previous = await this.backend.read(`objects/${hash}`);
        if (previous.length !== bytes.length || (await storeHash(previous)) !== hash)
          throw new Error(`Corrupt store object ${hash}.`);
        this.writtenReferences.set(hash, ref);
        return ref;
      } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') throw error;
        throw new Error('Recording storage budget exhausted.');
      }
    }
    if (await this.backend.put(`objects/${hash}`, bytes)) this.writtenBytes += bytes.length;
    // Verify host writes before allowing a root to reference the object.
    const stored = await this.backend.read(`objects/${hash}`);
    if (stored.length !== bytes.length || (await storeHash(stored)) !== hash)
      throw new Error(`Incomplete store write ${hash}.`);
    this.writtenReferences.set(hash, ref);
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
  private streamTail?: StoreReference;
  private readonly objects: Objects;
  private readonly options: RecordingStoreOptions;
  private chain: Promise<void> = Promise.resolve();
  private pendingBytes = 0;
  private pendingSegments = 0;
  private observedFrame = -1;
  private nextGeneration = 1;
  private failure?: Error;
  private closed = false;
  private collecting = false;
  private metadataBytes = 0;
  private rootFileBytes = 0;
  private constructor(
    private readonly backend: RecordingStoreBackend,
    options: RecordingStoreOptions,
    private readonly release: () => Promise<void>,
  ) {
    this.options = structuredClone(options);
    this.objects = new Objects(
      backend,
      options.cacheBytes ?? 1024 * 1024,
      () =>
        (this.options.maxStoredBytes ?? Infinity) -
        this.metadataBytes -
        this.rootFileBytes -
        this.objects.writtenBytes,
    );
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
    options = structuredClone(options);
    const release = await backend.acquireWriter();
    try {
      let exists = false;
      for await (const key of backend.list())
        if (key !== 'writer') {
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
    if (this.collecting) return Promise.reject(new Error('Garbage collection is in progress.'));
    if (this.closed || this.failure)
      return Promise.reject(this.failure ?? new Error('Store writer is closed.'));
    if (
      !Number.isSafeInteger(input.location.frame) ||
      input.location.frame! < 0 ||
      (this.observedFrame >= 0 && input.location.frame !== this.observedFrame + 1)
    )
      return Promise.reject(new Error('Store boundaries must be contiguous nonnegative integers.'));
    // Encoding transfers ownership now. A caller may mutate/reuse the input after this method returns.
    const first = this.observedFrame < 0;
    const bytes = encode({
      ...input,
      initialStreams: first ? { charts: input.scene.charts, logs: input.scene.logs } : undefined,
      scene: {
        ...input.scene,
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
    if (!initial && !input.frame && (scene.charts.length || scene.logs.length))
      throw new Error('Chart/log boundaries require their atomic frame message span.');
    const logCount =
      input.frame?.messages.filter((m) => m.type === 'log' || m.type === 'error').length ?? 0;
    const streamChanged =
      initial || logCount > 0 || !!input.frame?.messages.some((m) => streamTypes.has(m.type));
    const stream = streamChanged
      ? await this.objects.put(
          initial
            ? { initial: input.initialStreams }
            : {
                previous: this.streamTail,
                messages: input.frame?.messages.filter((m) => streamTypes.has(m.type)) ?? [],
                logs: logCount ? scene.logs.slice(-logCount) : [],
              },
        )
      : this.streamTail!;
    // Current-value monitors and latest chart samples are independently recoverable.
    const compact = {
      ...scene,
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
    if (
      boundary.checkpoint &&
      (!this.options.modelIdentity ||
        boundary.checkpoint.model_id !== this.options.modelIdentity.model_id ||
        boundary.checkpoint.state_schema_version !==
          this.options.modelIdentity.state_schema_version)
    )
      throw new Error('Checkpoint identity does not match the recording model/schema.');
    await this.putMetadata(
      `segments/${String(frame).padStart(16, '0')}`,
      encode({
        frame,
        ref: segment,
        time: location.modelTime,
        requestId: location.actionRequestId,
        stream: streamChanged,
      }),
    );
    await this.backend.putIndex({
      frame,
      ref: segment,
      time: location.modelTime,
      requestId: location.actionRequestId,
      stream: streamChanged,
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
    const total = this.objects.writtenBytes + this.metadataBytes + this.rootFileBytes;
    root.storedBytes = total;
    if (total > (this.options.maxStoredBytes ?? Infinity))
      throw new Error('Full recording storage budget exhausted.');
    await this.publish(root);
    this.tail = segment;
    this.streamTail = stream;
  }
  private async putMetadata(key: string, bytes: Uint8Array) {
    if (
      this.objects.writtenBytes + this.metadataBytes + this.rootFileBytes + bytes.length >
      (this.options.maxStoredBytes ?? Infinity)
    )
      throw new Error('Recording storage budget exhausted.');
    if (await this.backend.put(key, bytes)) this.metadataBytes += bytes.length;
  }
  private async removeMetadata(key: string) {
    const bytes = await this.backend.read(key);
    await this.backend.remove(key);
    this.metadataBytes -= bytes.length;
  }
  private async publish(root: RecordingStoreRoot) {
    let bytes = encode(rootSchema.parse(root));
    for (let i = 0; i < 3; i++) {
      root.storedBytes = this.objects.writtenBytes + this.metadataBytes + 2 * bytes.length;
      bytes = encode(rootSchema.parse(root));
    }
    if (root.storedBytes > (this.options.maxStoredBytes ?? Infinity))
      throw new Error('Recording storage budget exhausted.');
    const previous = this.rootValue;
    await this.putMetadata(`roots/${root.generation}`, bytes);
    await this.backend.publishRoot(previous?.generation ?? 0, bytes);
    this.rootFileBytes = bytes.length;
    this.rootValue = root;
    // Retain only a bounded batch of obsolete roots; readers pin generations explicitly.
    if (root.generation % 64 === 0) {
      const pinned = new Set(await this.backend.pinnedGenerations());
      for await (const key of this.backend.list('roots/'))
        if (Number(key.slice(6)) !== root.generation && !pinned.has(Number(key.slice(6))))
          await this.removeMetadata(key);
    }
  }
  async collect(): Promise<{ removedBytes: number }> {
    if (this.collecting) throw new Error('Garbage collection is in progress.');
    this.collecting = true;
    try {
      await this.chain;
      if (this.pendingSegments || this.closed)
        throw new Error('Drain the writer before garbage collection.');
      if (!this.rootValue) return { removedBytes: 0 };
      const keepGenerations = new Set([
        this.rootValue.generation,
        ...(await this.backend.pinnedGenerations()),
      ]);
      if (this.rootValue.mode === 'full-history') {
        for await (const key of this.backend.list('roots/'))
          if (!keepGenerations.has(Number(key.slice(6)))) await this.removeMetadata(key);
        return { removedBytes: 0 };
      }
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
          this.objects.forget(key.slice(8));
        }
        if (key.startsWith('roots/') && !keepGenerations.has(Number(key.slice(6))))
          await this.removeMetadata(key);
        if (key.startsWith('segments/') && Number(key.slice(9)) < minimumFrame)
          await this.removeMetadata(key);
      }
      this.objects.writtenBytes -= removedBytes;
      return { removedBytes };
    } finally {
      this.collecting = false;
    }
  }

  abort(error: unknown): void {
    this.failure ??= error instanceof Error ? error : new Error(String(error));
  }

  async close(summary?: unknown): Promise<RecordingStoreRoot | undefined> {
    summary = structuredClone(summary);
    if (this.collecting) throw new Error('Drain garbage collection before closing the writer.');
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
    options = { ...options };
    if (
      options.cacheBytes !== undefined &&
      (!Number.isSafeInteger(options.cacheBytes) || options.cacheBytes < 1)
    )
      throw new Error('Invalid reader cache budget.');
    const root = rootSchema.parse(decodeMessagePack(await backend.read('root')));
    const release = await backend.pin(root.generation);
    try {
      const latest = rootSchema.parse(decodeMessagePack(await backend.read('root')));
      if (latest.generation === root.generation)
        return new RecordingStoreReader(backend, root, release, options.cacheBytes ?? 1024 * 1024);
    } catch (error) {
      await release();
      throw error;
    }
    await release();
    return this.open(backend, options);
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
    const boundary = await this.objects.get<StoredBoundary>(ref);
    if (boundary.kind !== 'boundary') throw new Error('Expected a recording boundary.');
    return boundary;
  }
  private async indexedBoundary(row: StoreIndexRow): Promise<StoredBoundary> {
    const result = await this.boundary(row.ref);
    if (
      result.location.frame !== row.frame ||
      result.location.sourceId !== this.rootValue.id ||
      result.location.modelTime !== row.time ||
      result.location.actionRequestId !== row.requestId ||
      row.frame < this.rootValue.firstFrame ||
      row.frame > this.rootValue.lastFrame
    )
      throw new Error('Index disagrees with segment boundary.');
    return result;
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
    const result = await this.indexedBoundary(row);
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
    const result = await this.indexedBoundary(row);
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
    return this.readBoundaryFrame(boundary, frame, options);
  }
  private async readBoundaryFrame(
    boundary: StoredBoundary,
    frame: number,
    options: { history?: 'full' | 'active'; signal?: AbortSignal },
  ): Promise<CapturedFrame> {
    this.assertOpen();
    if (options.signal?.aborted) throw new Error('Store read cancelled.');
    let scene = structuredClone(boundary.scene);
    if ((options.history ?? 'full') === 'full') {
      const scenario = new Scenario();
      const first = this.root.firstFrame;
      const baseline = frame === first ? boundary : await this.get(first);
      const initial = await this.objects.get<{
        initial?: Pick<ScenarioSnapshot, 'charts' | 'logs'>;
      }>(baseline.stream);
      scenario.load({
        ...scenario.dump(),
        charts:
          this.root.mode === 'rolling' && this.root.truncated
            ? baseline.scene.charts
            : (initial.initial?.charts ?? baseline.scene.charts),
        logs:
          this.root.mode === 'rolling' && this.root.truncated
            ? baseline.scene.logs
            : (initial.initial?.logs ?? baseline.scene.logs),
      });
      let previousStream = baseline.stream;
      for await (const entry of this.backend.streamIndex(first + 1, frame)) {
        if (options.signal?.aborted) throw new Error('Store read cancelled.');
        const state = await this.indexedBoundary(entry);
        const chunk = await this.objects.get<{
          previous?: StoreReference;
          messages?: SnapshotFrame['messages'];
          logs?: ScenarioSnapshot['logs'];
        }>(state.stream);
        if (chunk.previous?.hash !== previousStream.hash)
          throw new Error('Committed stream index has a gap.');
        for (const message of chunk.messages ?? []) scenario.apply(message);
        for (const log of chunk.logs ?? []) scenario.apply({ type: 'log', payload: log });
        previousStream = state.stream;
      }
      if (previousStream.hash !== boundary.stream.hash)
        throw new Error('Committed stream index is incomplete.');
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
    this.assertOpen();
    if (options.signal?.aborted) throw new Error('Store read cancelled.');
    return {
      id: `${this.root.id}:${frame}`,
      capturedAt: boundary.timestamp,
      scene,
      modelIdentity: structuredClone(this.root.modelIdentity),
      source:
        boundary.provenance?.kind === 'recording'
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
  range(
    from: number,
    to: number,
    options: { history?: 'full' | 'active'; signal?: AbortSignal } = {},
  ) {
    return this.readRange(from, to, { ...options });
  }
  private async *readRange(
    from: number,
    to: number,
    options: { history?: 'full' | 'active'; signal?: AbortSignal },
  ) {
    this.assertOpen();
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from > to ||
      from < this.root.firstFrame ||
      to > this.root.lastFrame
    )
      throw new Error('Invalid store range.');
    options = { ...options };
    const streams = new Scenario();
    let expected = from;
    let previousStreamHash: string | undefined;
    for await (const entry of this.backend.frameIndex(from, to)) {
      if (options.signal?.aborted) throw new Error('Store range cancelled.');
      if (entry.frame !== expected++) throw new Error('Committed range has a gap.');
      this.assertOpen();
      const state = await this.indexedBoundary(entry);
      const captured = await this.readBoundaryFrame(state, entry.frame, {
        history: options.history === 'active' ? 'active' : entry.frame === from ? 'full' : 'active',
        signal: options.signal,
      });
      if (options.history === 'active') {
        yield captured;
        continue;
      }
      if (entry.frame === from)
        streams.load({
          ...captured.scene,
          environments: [],
          assets: [],
          monitors: [],
          parameters: [],
          actions: [],
          metadata: {},
        });
      else if (state.stream.hash !== previousStreamHash) {
        const chunk = await this.objects.get<{
          messages?: SnapshotFrame['messages'];
          logs?: ScenarioSnapshot['logs'];
        }>(state.stream);
        for (const message of chunk.messages ?? []) streams.apply(message);
        for (const log of chunk.logs ?? []) streams.apply({ type: 'log', payload: log });
      }
      if (entry.frame !== from) {
        captured.scene.charts = streams.charts.dump();
        captured.scene.logs = structuredClone([...streams.logs]);
      }
      previousStreamHash = state.stream.hash;
      yield captured;
    }
    if (expected !== to + 1) throw new Error('Committed range is incomplete.');
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
    const boundary = await this.indexedBoundary(row);
    return structuredClone({ ...boundary.location, generation: this.root.generation });
  }
  async *locations(from = this.root.firstFrame, to = this.root.lastFrame, signal?: AbortSignal) {
    this.assertOpen();
    for await (const row of this.backend.frameIndex(
      Math.max(from, this.root.firstFrame),
      Math.min(to, this.root.lastFrame),
    )) {
      if (signal?.aborted) throw new Error('Store iteration cancelled.');
      const boundary = await this.indexedBoundary(row);
      yield structuredClone({ ...boundary.location, generation: this.root.generation });
    }
  }

  /** Range copy streams one independent scene and its stream delta at a time. */
  async exportRange(writer: RecordingStoreWriter, from: number, to: number, signal?: AbortSignal) {
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from > to ||
      from < this.root.firstFrame ||
      to > this.root.lastFrame
    )
      throw new Error('Invalid export range.');
    let first = true;
    let previousStreamHash: string | undefined;
    let expected = from;
    for await (const row of this.backend.frameIndex(from, to)) {
      this.assertOpen();
      if (row.frame !== expected++) throw new Error('Committed export range has a gap.');
      const boundary = await this.indexedBoundary(row);
      const location = { ...boundary.location, generation: this.root.generation };
      const frame = await this.readBoundaryFrame(boundary, row.frame, {
        history: first ? 'full' : 'active',
        signal,
      });
      const stream = await this.objects.get<{
        messages?: SnapshotFrame['messages'];
        logs?: ScenarioSnapshot['logs'];
      }>(boundary.stream);
      const streamChanged = first || boundary.stream.hash !== previousStreamHash;
      await writer.append({
        location,
        timestamp: frame.capturedAt,
        scene: frame.scene,
        checkpoint: frame.checkpoint,
        provenance: frame.source,
        annotations: boundary.annotations,
        frame: boundary.frame
          ? {
              ...boundary.frame,
              messages: [
                ...(streamChanged ? (stream.messages ?? []) : []),
                ...(streamChanged ? (stream.logs ?? []) : []).map((log) => ({
                  type: 'log' as const,
                  payload: log,
                })),
              ],
            }
          : undefined,
      });
      previousStreamHash = boundary.stream.hash;
      first = false;
    }
    if (expected !== to + 1) throw new Error('Committed export range is incomplete.');
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
    this.assertOpen();
    const errors: Array<{ frame?: number; reason: string }> = [];
    let lastFrame: number | undefined;
    let previous: StoreReference | undefined;
    let count = 0;
    const streamRows = this.backend
      .streamIndex(this.root.firstFrame, this.root.lastFrame)
      [Symbol.asyncIterator]();
    let nextStream: IteratorResult<StoreIndexRow> = { done: true, value: undefined };
    let previousStreamHash: string | undefined;
    try {
      nextStream = await streamRows.next();
      let expected = this.root.firstFrame;
      for await (const entry of this.backend.frameIndex(
        this.root.firstFrame,
        this.root.lastFrame,
      )) {
        try {
          const state = await this.indexedBoundary(entry);
          if (
            (count === 0 && entry.ref.hash !== this.rootValue.streamStart.hash) ||
            entry.frame !== expected++ ||
            state.location.frame !== entry.frame ||
            (previous && state.previous?.hash !== previous.hash)
          )
            throw new Error('Committed index/segment chain has a gap.');
          const chunk = await this.objects.get<{ previous?: StoreReference }>(state.stream);
          const changed =
            previousStreamHash !== undefined && previousStreamHash !== state.stream.hash;
          if (changed && chunk.previous?.hash !== previousStreamHash)
            throw new Error('Committed stream chain has a gap.');
          if (!nextStream.done && nextStream.value.frame === entry.frame) {
            if (nextStream.value.ref.hash !== entry.ref.hash || (count > 0 && !changed))
              throw new Error('Derived stream index disagrees with committed history.');
            nextStream = await streamRows.next();
          } else if (changed || (count === 0 && this.root.mode === 'full-history'))
            throw new Error('Derived stream index is incomplete; rebuild the index.');
          previousStreamHash = state.stream.hash;
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
    } finally {
      await streamRows.return?.();
    }
    if (
      !errors.length &&
      (lastFrame !== this.root.lastFrame ||
        previous?.hash !== this.root.lastSegment.hash ||
        count !== this.root.count ||
        !nextStream.done)
    )
      errors.push({
        reason: 'Committed index is incomplete; rebuild it from immutable segment descriptors.',
      });
    const writerActive = await this.backend.isWriterActive();
    const latest = rootSchema.parse(decodeMessagePack(await this.backend.read('root')));
    const superseded = latest.generation !== this.root.generation;
    let observed = this.root.observedFrame;
    for await (const key of this.backend.list('segments/'))
      observed = Math.max(observed, Number(key.slice(9)));
    return {
      generation: this.root.generation,
      status:
        this.root.status === 'open' && !writerActive && !superseded
          ? 'interrupted'
          : this.root.status,
      writerActive,
      superseded,
      tailObservation:
        this.root.status === 'open' ? 'unknown' : observed > this.root.lastFrame ? 'known' : 'none',
      tailReason:
        this.root.status === 'open'
          ? 'This generation has no final root; observations after its last committed boundary may not have reached storage.'
          : undefined,
      committedRange: { from: this.root.firstFrame, to: this.root.lastFrame },
      recoverablePrefix:
        lastFrame === undefined ? undefined : { from: this.root.firstFrame, to: lastFrame },
      uncommittedRange:
        observed > this.root.lastFrame
          ? { from: this.root.lastFrame + 1, to: observed }
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

/** Rebuild only the derived index. Immutable history is verified and never rewritten. */
export async function rebuildRecordingStoreIndex(backend: RecordingStoreBackend): Promise<void> {
  const release = await backend.acquireWriter();
  try {
    const root = rootSchema.parse(decodeMessagePack(await backend.read('root')));
    const objects = new Objects(backend, 1024 * 1024);
    async function* rows(): AsyncGenerator<StoreIndexRow> {
      let expected = root.firstFrame;
      let previous: StoreReference | undefined;
      let previousStreamHash: string | undefined;
      for await (const key of backend.list('segments/')) {
        const frame = Number(key.slice(9));
        if (frame < root.firstFrame || frame > root.lastFrame) continue;
        if (frame !== expected++) throw new Error('Committed segment descriptors have a gap.');
        const row = decodeMessagePack<StoreIndexRow>(await backend.read(key));
        const state = boundarySchema.parse(await objects.get(row.ref)) as StoredBoundary;
        if (
          row.frame !== frame ||
          state.location.frame !== frame ||
          (previous && state.previous?.hash !== previous.hash)
        )
          throw new Error('Committed segment chain is corrupt.');
        const chunk = await objects.get<{ previous?: StoreReference }>(state.stream);
        if (
          previousStreamHash !== undefined &&
          previousStreamHash !== state.stream.hash &&
          chunk.previous?.hash !== previousStreamHash
        )
          throw new Error('Committed stream chain is corrupt.');
        const streamChanged = previousStreamHash !== state.stream.hash;
        previousStreamHash = state.stream.hash;
        for (const asset of state.assets) await objects.get(asset.ref);
        previous = row.ref;
        yield {
          frame,
          time: state.location.modelTime,
          requestId: state.location.actionRequestId,
          stream: streamChanged,
          ref: row.ref,
        };
      }
      if (
        expected !== root.lastFrame + 1 ||
        previous?.hash !== root.lastSegment.hash ||
        expected - root.firstFrame !== root.count
      )
        throw new Error('Committed segment descriptors are incomplete.');
    }
    await backend.rebuildIndex(rows());
  } finally {
    await release();
  }
}
