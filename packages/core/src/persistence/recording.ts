import { omitUndefinedObjectProperties } from './serialization';
import { z } from 'zod';
import type { AssetMetadataPayload, AssetDataPayload, EnvLayerCreatePayload, EnvLayerUpdatePayload, ItemCreatePayload, ItemUpdatePayload } from '@tensnap/protocol';
import { decodeMessagePack, encodeMessagePack, encodeBytesAsDataUrl } from '@tensnap/protocol';
import {
  decodeSnapshotArchive,
  encodeSnapshotArchive,
  isSnapshotArchive,
  snapshotArchiveForJson,
  materializeSnapshot,
  type Snapshot,
  type SnapshotArchive,
} from '../snapshot';
import {
  SnapshotSchema,
  SnapshotArchiveSchema,
  ProjectAssetBlobSchema,
  extractSnapshotAssets,
  hydrateSnapshotAssets,
} from './project';

export const RECORDING_FILE_VERSION = 1;
export const RecordingOriginSchema = z
  .object({
    recordingId: z.string().min(1),
    frame: z.number().int().nonnegative(),
    actionRequestId: z.string().optional(),
    modelTime: z.number().optional(),
  })
  .strict();
export type RecordingOrigin = z.infer<typeof RecordingOriginSchema>;
export type AssetTable = Record<string, { mime: string; data: string | Uint8Array }>;
export interface RecordingFileV1 {
  kind: 'tensnap-recording';
  version: 1;
  recording: SnapshotArchive;
  assetTable: AssetTable;
  origin?: RecordingOrigin;
}
const RecordingFileSchema = z
  .object({
    kind: z.literal('tensnap-recording'),
    version: z.literal(RECORDING_FILE_VERSION),
    recording: SnapshotArchiveSchema,
    assetTable: z.record(z.string(), ProjectAssetBlobSchema),
    origin: RecordingOriginSchema.optional(),
  })
  .strict();
export interface RecordingReport {
  firstFrame: number;
  lastFrame: number;
  frameCount: number;
  keyframeCount: number;
  byteLength: number;
  truncated: boolean;
  missingAssets: string[];
  externalUrls: string[];
  resourcesComplete: boolean;
  legacy: boolean;
  retention?: Snapshot['metadata']['retention'];
}
export interface RecordingDocument {
  snapshot: Snapshot;
  origin?: RecordingOrigin;
  report: RecordingReport;
}

/** Validate canonical decoded data, including ordering that a structural schema cannot prove. */
export function validateRecording(snapshot: Snapshot): void {
  SnapshotSchema.parse({
    ...snapshot,
    frames: snapshot.frames.map((frame) => ({
      ...frame,
      messages: frame.messages.map((message) =>
        message.type === 'asset_data' &&
        (message.payload as Partial<AssetDataPayload>).data === undefined
          ? { ...message, payload: { ...message.payload, data: new Uint8Array() } }
          : message,
      ),
    })),
  });
  let previous = snapshot.initial.frame;
  for (const frame of snapshot.frames) {
    if (frame.index <= previous)
      throw new Error('Recording frames must be strictly ordered after initial.frame.');
    previous = frame.index;
  }
  let keyframeIndex = snapshot.initial.frame;
  for (const keyframe of snapshot.keyframes) {
    if (
      keyframe.frame <= keyframeIndex ||
      keyframe.frame > previous ||
      !snapshot.frames.some((frame) => frame.index === keyframe.frame)
    )
      throw new Error('Recording keyframes must be ordered and belong to retained frames.');
    keyframeIndex = keyframe.frame;
  }
  if (snapshot.metadata.origin && snapshot.frames.length)
    throw new Error('Derived frame origin requires a single-frame recording.');
  const checkpoint = snapshot.metadata.checkpoint;
  const identity = snapshot.metadata.model_identity;
  if (
    checkpoint &&
    identity &&
    (checkpoint.model_id !== identity.model_id ||
      checkpoint.state_schema_version !== identity.state_schema_version)
  )
    throw new Error('Recording checkpoint identity does not match its model identity.');
}

function resourceReport(
  snapshot: Snapshot,
): Pick<RecordingReport, 'missingAssets' | 'externalUrls' | 'resourcesComplete'> {
  const available = new Set<string>();
  const referenced = new Set<string>();
  const external = new Set<string>();
  const referencedIds = new Set<string>();
  const announcedIds = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (/^(https?:|blob:|file:)/.test(value)) external.add(value);
      if (value.startsWith('asset:')) referencedIds.add(value.slice(6));
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
      const record = value as Record<string, unknown>;
      if (typeof record.asset_id === 'string') referencedIds.add(record.asset_id);
      // Item data is model-owned information, not a renderer resource reference.
      for (const [key, child] of Object.entries(record)) if (key !== 'data') visit(child);
    }
  };
  for (const keyframe of [snapshot.initial, ...snapshot.keyframes]) {
    for (const asset of keyframe.scenario.assets) {
      referenced.add(asset.meta.hash);
      announcedIds.add(asset.meta.id);
      if (asset.data !== undefined) available.add(asset.meta.hash);
    }
    for (const environment of keyframe.scenario.environments) for (const layer of environment.layers) {
      visit(layer.metadata);
      // Background storage URLs are derived when metadata already owns its source.
      if (layer.layerType !== 'background' || layer.metadata.background === undefined) visit(layer.storageSnapshot);
    }
  }
  for (const frame of snapshot.frames)
    for (const message of frame.messages) {
      if (message.type === 'asset_metadata')
        for (const meta of (message.payload as AssetMetadataPayload).assets) {
          referenced.add(meta.hash); announcedIds.add(meta.id);
        }
      if (message.type === 'asset_data') referenced.add((message.payload as AssetDataPayload).hash);
      if (message.type === 'asset_data' && (message.payload as AssetDataPayload).data !== undefined)
        available.add((message.payload as AssetDataPayload).hash);
      if (message.type === 'env_layer_create' || message.type === 'env_layer_update') visit((message.payload as EnvLayerCreatePayload | EnvLayerUpdatePayload).metadata);
      if (message.type === 'item_create' || message.type === 'item_update') visit((message.payload as ItemCreatePayload | ItemUpdatePayload).items);
    }
  const missingAssets = [...[...referenced].filter((hash) => !available.has(hash)), ...[...referencedIds].filter((id) => !announcedIds.has(id)).map((id) => `asset:${id}`)].sort();
  return {
    missingAssets,
    externalUrls: [...external].sort(),
    resourcesComplete: missingAssets.length === 0 && external.size === 0,
  };
}

export function inspectRecording(snapshot: Snapshot, legacy = false): RecordingReport {
  return {
    firstFrame: snapshot.initial.frame,
    lastFrame: snapshot.frames[snapshot.frames.length - 1]?.index ?? snapshot.initial.frame,
    frameCount: snapshot.frames.length,
    keyframeCount: snapshot.keyframes.length,
    byteLength: snapshot.byteLength,
    truncated: snapshot.truncated,
    legacy,
    ...(snapshot.metadata.retention
      ? { retention: structuredClone(snapshot.metadata.retention) }
      : {}),
    ...resourceReport(snapshot),
  };
}

export function createRecordingFile(
  snapshot: Snapshot,
  options: { origin?: RecordingOrigin; allowIncomplete?: boolean } = {},
): RecordingFileV1 {
  options = { ...options, origin: options.origin ?? snapshot.metadata.origin };
  validateRecording(snapshot);
  if (options.origin) RecordingOriginSchema.parse(options.origin);
  if (options.origin && snapshot.frames.length)
    throw new Error('A single-frame origin cannot describe a multi-frame recording.');
  const report = inspectRecording(snapshot);
  if (!options.allowIncomplete && !report.resourcesComplete)
    throw new Error(
      `Recording resources are incomplete: ${report.missingAssets.join(', ')}${report.externalUrls.length ? '; external URLs: ' + report.externalUrls.join(', ') : ''}`,
    );
  const assetTable: AssetTable = {};
  const stripped = extractSnapshotAssets(snapshot, assetTable);
  stripped.metadata = omitUndefinedObjectProperties(stripped.metadata) as Snapshot['metadata'];
  const recording = encodeSnapshotArchive(stripped);
  return {
    kind: 'tensnap-recording',
    version: 1,
    recording,
    assetTable,
    ...(options.origin ? { origin: structuredClone(options.origin) } : {}),
  };
}

export function parseRecordingFile(
  value: unknown,
  options: { allowLegacy?: boolean } = {},
): RecordingDocument {
  const record = value as Record<string, unknown> | null;
  let snapshot: Snapshot;
  let origin: RecordingOrigin | undefined;
  const legacy = record?.kind !== 'tensnap-recording';
  if (!legacy) {
    const file = RecordingFileSchema.parse(value) as RecordingFileV1;
    const archive = file.recording;
    if (archive.byteLength !== recordingArchiveByteLength(archive))
      throw new Error('Invalid recording archive byteLength.');
    snapshot = hydrateSnapshotAssets(decodeSnapshotArchive(archive), file.assetTable);
    origin = file.origin;
    if (
      origin &&
      snapshot.metadata.origin &&
      JSON.stringify(origin) !== JSON.stringify(snapshot.metadata.origin)
    )
      throw new Error('Recording origin does not match archive provenance.');
    if (origin) snapshot.metadata.origin = structuredClone(origin);
    if (origin && snapshot.frames.length)
      throw new Error('Recording origin requires a single-frame recording.');
  } else {
    if (!options.allowLegacy)
      throw new Error(
        'Expected a tensnap-recording file; legacy import must be enabled explicitly.',
      );
    snapshot = isSnapshotArchive(value)
      ? decodeSnapshotArchive(SnapshotArchiveSchema.parse(value) as SnapshotArchive)
      : (SnapshotSchema.parse(value) as Snapshot);
  }
  validateRecording(snapshot);
  return { snapshot, ...(origin ? { origin } : {}), report: inspectRecording(snapshot, legacy) };
}

export function encodeRecordingFile(
  snapshot: Snapshot,
  options: {
    format?: 'json' | 'msgpack';
    origin?: RecordingOrigin;
    allowIncomplete?: boolean;
  } = {},
): Uint8Array {
  const file = createRecordingFile(snapshot, options);
  if (options.format === 'msgpack') return encodeMessagePack(omitUndefinedObjectProperties(file));
  file.recording = snapshotArchiveForJson(file.recording);
  file.recording.byteLength = recordingArchiveByteLength(file.recording);
  file.assetTable = Object.fromEntries(
    Object.entries(file.assetTable).map(([hash, blob]) => [
      hash,
      {
        ...blob,
        data:
          typeof blob.data === 'string' ? blob.data : encodeBytesAsDataUrl(blob.data, blob.mime),
      },
    ]),
  );
  return new TextEncoder().encode(JSON.stringify(file));
}

export function decodeRecordingFile(
  bytes: Uint8Array,
  options: { allowLegacy?: boolean } = {},
): RecordingDocument {
  return parseRecordingFile(decodePersistenceValue(bytes), options);
}

export function decodePersistenceValue(bytes: Uint8Array): unknown {
  const first = bytes.find((byte) => ![9, 10, 13, 32].includes(byte));
  return first === 123 ? JSON.parse(new TextDecoder().decode(bytes)) : decodeMessagePack(bytes);
}

export type RecordingSelection =
  | { frame: number }
  | { time: number; match: 'first' | 'last' | 'before' | 'after' };
/** Selection always reports a real retained boundary, even for sparse/nonmonotonic time. */
export function selectRecordingFrame(
  snapshot: Snapshot,
  selection: RecordingSelection,
): { frame: number; modelTime?: number } {
  const indexes = [snapshot.initial.frame, ...snapshot.frames.map((frame) => frame.index)];
  if ('frame' in selection) {
    if (!indexes.includes(selection.frame))
      throw new Error(`Frame ${selection.frame} is not a retained boundary.`);
    const time = materializeSnapshot(snapshot, selection.frame).metadata.time;
    return { frame: selection.frame, ...(typeof time === 'number' ? { modelTime: time } : {}) };
  }
  const entries = indexes
    .map((frame) => ({ frame, modelTime: materializeSnapshot(snapshot, frame).metadata.time }))
    .filter(
      (entry): entry is { frame: number; modelTime: number } => typeof entry.modelTime === 'number',
    );
  let matches = entries.filter((entry) =>
    selection.match === 'before'
      ? entry.modelTime <= selection.time
      : selection.match === 'after'
        ? entry.modelTime >= selection.time
        : entry.modelTime === selection.time,
  );
  if (selection.match === 'before' || selection.match === 'after') {
    const nearest = (selection.match === 'before' ? Math.max : Math.min)(
      ...matches.map((entry) => entry.modelTime),
    );
    matches = matches.filter((entry) => entry.modelTime === nearest);
  }
  const result =
    selection.match === 'first' || selection.match === 'after'
      ? matches[0]
      : matches[matches.length - 1];
  if (!result) throw new Error('No retained frame matches the requested model time.');
  return result;
}

function recordingArchiveByteLength(archive: SnapshotArchive): number {
  return (
    encodeMessagePack({
      version: archive.version,
      metadata: archive.metadata,
      layerCodecs: archive.layerCodecs,
      truncated: archive.truncated,
    }).byteLength + archive.segments.reduce((total, segment) => total + segment.byteLength, 0)
  );
}
