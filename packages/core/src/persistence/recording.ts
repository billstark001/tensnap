import { omitUndefinedObjectProperties } from './serialization';
import { z } from 'zod';
import { inspectRecording, type RecordingReport } from '../snapshot/recording-report';
export { inspectRecording, type RecordingReport } from '../snapshot/recording-report';
import type { AssetDataPayload, MetadataUpdatePayload } from '@tensnap/protocol';
import { decodeMessagePack, encodeMessagePack, encodeBytesAsDataUrl } from '@tensnap/protocol';
import {
  decodeSnapshotArchive,
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
  encodeSnapshotWithAssets,
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
  let retainedIndex = 0;
  for (const keyframe of snapshot.keyframes) {
    while (
      retainedIndex < snapshot.frames.length &&
      snapshot.frames[retainedIndex].index < keyframe.frame
    )
      retainedIndex++;
    if (
      keyframe.frame <= keyframeIndex ||
      keyframe.frame > previous ||
      snapshot.frames[retainedIndex]?.index !== keyframe.frame
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

export function createRecordingFile(
  snapshot: Snapshot,
  options: { origin?: RecordingOrigin; allowIncomplete?: boolean } = {},
): RecordingFileV1 {
  options = { ...options, origin: options.origin ?? snapshot.metadata.origin };
  validateRecording(snapshot);
  if (options.origin) {
    const origin = RecordingOriginSchema.parse(options.origin);
    if (
      snapshot.metadata.origin &&
      JSON.stringify(origin) !==
        JSON.stringify(RecordingOriginSchema.parse(snapshot.metadata.origin))
    )
      throw new Error('Recording origin conflicts with retained provenance.');
  }
  if (options.origin && snapshot.frames.length)
    throw new Error('A single-frame origin cannot describe a multi-frame recording.');
  const report = inspectRecording(snapshot);
  if (!options.allowIncomplete && !report.resourcesComplete)
    throw new Error(
      `Recording resources are incomplete: ${report.missingAssets.join(', ')}${report.externalUrls.length ? '; external URLs: ' + report.externalUrls.join(', ') : ''}`,
    );
  const assetTable: AssetTable = {};
  const recording = encodeSnapshotWithAssets(snapshot, assetTable);
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
  if ('frame' in selection) {
    if (
      selection.frame !== snapshot.initial.frame &&
      !snapshot.frames.some((frame) => frame.index === selection.frame)
    )
      throw new Error(`Frame ${selection.frame} is not a retained boundary.`);
    const time = materializeSnapshot(snapshot, selection.frame).metadata.time;
    return { frame: selection.frame, ...(typeof time === 'number' ? { modelTime: time } : {}) };
  }
  // Time changes only through metadata updates or a stored keyframe. Inspect those
  // boundaries once, without reconstructing scenes, chart prefixes or asset bytes.
  let modelTime = snapshot.initial.scenario.metadata.time;
  let result: { frame: number; modelTime: number } | undefined;
  const consider = (frame: number): void => {
    if (typeof modelTime !== 'number') return;
    if (selection.match === 'before') {
      if (modelTime <= selection.time && (!result || modelTime >= result.modelTime))
        result = { frame, modelTime };
    } else if (selection.match === 'after') {
      if (modelTime >= selection.time && (!result || modelTime < result.modelTime))
        result = { frame, modelTime };
    } else if (modelTime === selection.time && (!result || selection.match === 'last')) {
      result = { frame, modelTime };
    }
  };
  consider(snapshot.initial.frame);
  let keyframeIndex = 0;
  for (const frame of snapshot.frames) {
    const keyframe = snapshot.keyframes[keyframeIndex];
    if (keyframe?.frame === frame.index) {
      modelTime = keyframe.scenario.metadata.time;
      keyframeIndex++;
    } else {
      for (const message of frame.messages) {
        if (message.type !== 'metadata_update') continue;
        const payload = message.payload as MetadataUpdatePayload;
        if (Object.prototype.hasOwnProperty.call(payload, 'time')) modelTime = payload.time;
      }
    }
    consider(frame.index);
  }
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
