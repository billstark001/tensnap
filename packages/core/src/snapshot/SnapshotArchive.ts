import { decodeBinaryString, decodeMessagePack, encodeBytesAsDataUrl, encodeMessagePack } from '@tensnap/protocol';
import type {
  Keyframe,
  Snapshot,
  SnapshotArchive,
  SnapshotFrame,
  SnapshotSegment,
} from './types';

type SegmentPayload = {
  base: Keyframe;
  frames: SnapshotFrame[];
};

const RLE_ESCAPE = 0xff;

/**
 * A tiny, deterministic byte codec that works in browsers, workers, and Node
 * without platform-specific streams. It is deliberately used only after
 * MessagePack, where repeated protocol keys and small numeric runs compress
 * well. Raw bytes are retained when RLE would be larger.
 */
function compressRle(input: Uint8Array): Uint8Array {
  const output: number[] = [];
  for (let index = 0; index < input.length;) {
    const value = input[index]!;
    let run = 1;
    while (index + run < input.length && input[index + run] === value && run < 255) run += 1;
    if (run >= 4) {
      output.push(RLE_ESCAPE, run, value);
      index += run;
      continue;
    }
    for (let count = 0; count < run; count += 1) {
      const literal = input[index + count]!;
      if (literal === RLE_ESCAPE) output.push(RLE_ESCAPE, 0, literal);
      else output.push(literal);
    }
    index += run;
  }
  return Uint8Array.from(output);
}

function decompressRle(input: Uint8Array): Uint8Array {
  const output: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index]!;
    if (value !== RLE_ESCAPE) {
      output.push(value);
      continue;
    }
    const count = input[++index];
    const repeated = input[++index];
    if (count === undefined || repeated === undefined) throw new Error('Invalid RLE snapshot segment.');
    if (count === 0) output.push(repeated);
    else for (let repeat = 0; repeat < count; repeat += 1) output.push(repeated);
  }
  return Uint8Array.from(output);
}

function asBytes(value: Uint8Array | string): Uint8Array {
  return typeof value === 'string' ? decodeBinaryString(value).bytes : value;
}

function encodeSegment(payload: SegmentPayload): Pick<SnapshotSegment, 'encoding' | 'compression' | 'data' | 'byteLength'> {
  const raw = encodeMessagePack(payload);
  const compressed = compressRle(raw);
  const useCompressed = compressed.byteLength < raw.byteLength;
  const data = useCompressed ? compressed : raw;
  return {
    encoding: 'msgpack',
    compression: useCompressed ? 'rle' : 'none',
    data,
    byteLength: data.byteLength,
  };
}

function decodeSegment(segment: SnapshotSegment): SegmentPayload {
  if (segment.encoding !== 'msgpack') throw new Error(`Unsupported snapshot segment encoding: ${segment.encoding}.`);
  const data = asBytes(segment.data);
  const bytes = segment.compression === 'rle' ? decompressRle(data) : data;
  return decodeMessagePack<SegmentPayload>(bytes);
}

/** Actual MessagePack-plus-compression byte cost used by retention accounting. */
export function snapshotEncodedByteLength(value: unknown): number {
  return encodeSegment({
    base: { frame: 0, timestamp: 0, scenario: value as Keyframe['scenario'] },
    frames: [],
  }).byteLength;
}

/**
 * Convert a live recording into independently decodable, compressed segments.
 * `segmentFrames` is a persistence choice only; replay semantics remain the
 * same as the in-memory Snapshot and existing layer codecs remain intact.
 */
export function encodeSnapshotArchive(snapshot: Snapshot, segmentFrames = 120): SnapshotArchive {
  if (!Number.isInteger(segmentFrames) || segmentFrames < 1) {
    throw new Error('segmentFrames must be a positive integer.');
  }
  const keyframes = [snapshot.initial, ...snapshot.keyframes].sort((a, b) => a.frame - b.frame);
  const segments: SnapshotSegment[] = [];
  let keyframeIndex = 0;
  let frameOffset = 0;

  while (frameOffset < snapshot.frames.length || segments.length === 0) {
    const first = snapshot.frames[frameOffset];
    const firstFrame = first?.index ?? snapshot.initial.frame;
    while (keyframeIndex + 1 < keyframes.length && keyframes[keyframeIndex + 1]!.frame <= firstFrame) {
      keyframeIndex += 1;
    }
    const base = keyframes[keyframeIndex]!;
    let end = Math.min(snapshot.frames.length, frameOffset + segmentFrames);
    const nextKeyframe = keyframes[keyframeIndex + 1];
    if (nextKeyframe) {
      const boundary = snapshot.frames.findIndex((frame, index) => index >= frameOffset && frame.index >= nextKeyframe.frame);
      if (boundary >= frameOffset && boundary < end) end = boundary;
    }
    // A keyframe on the first frame belongs to its own segment so the following
    // range can start from that independent base.
    if (end === frameOffset && frameOffset < snapshot.frames.length) end += 1;
    const frames = snapshot.frames.slice(frameOffset, end);
    const lastFrame = frames[frames.length - 1]?.index ?? base.frame;
    segments.push({ firstFrame: base.frame, lastFrame, ...encodeSegment({ base, frames }) });
    frameOffset = end;
  }

  const headerBytes = encodeMessagePack({
    version: snapshot.version,
    metadata: snapshot.metadata,
    layerCodecs: snapshot.layerCodecs,
    truncated: snapshot.truncated,
  }).byteLength;
  return {
    version: 1,
    metadata: structuredClone(snapshot.metadata),
    layerCodecs: structuredClone(snapshot.layerCodecs),
    segments,
    byteLength: headerBytes + segments.reduce((total, segment) => total + segment.byteLength, 0),
    truncated: snapshot.truncated,
  };
}

/** Decode a persisted archive back into the public in-memory replay shape. */
export function decodeSnapshotArchive(archive: SnapshotArchive): Snapshot {
  if (archive.version !== 1) throw new Error(`Unsupported snapshot archive version: ${archive.version}.`);
  if (!archive.segments.length) throw new Error('Snapshot archive has no segments.');
  const decoded = archive.segments.map((segment) => ({ segment, payload: decodeSegment(segment) }));
  const initial = structuredClone(decoded[0]!.payload.base);
  const keyframes = decoded
    .slice(1)
    .map(({ payload }) => structuredClone(payload.base))
    .filter((keyframe, index, all) => keyframe.frame !== initial.frame && all.findIndex((other) => other.frame === keyframe.frame) === index)
    .sort((a, b) => a.frame - b.frame);
  const frames = decoded
    .flatMap(({ payload }) => payload.frames)
    .filter((frame, index, all) => all.findIndex((other) => other.index === frame.index) === index)
    .sort((a, b) => a.index - b.index);
  return {
    version: 1,
    metadata: structuredClone(archive.metadata),
    initial,
    keyframes,
    frames,
    layerCodecs: structuredClone(archive.layerCodecs),
    byteLength: archive.byteLength,
    truncated: archive.truncated,
  };
}

/** Convert binary archive fields to JSON-safe data URLs without changing bytes. */
export function snapshotArchiveForJson(archive: SnapshotArchive): SnapshotArchive {
  return {
    ...structuredClone(archive),
    segments: archive.segments.map((segment) => ({
      ...segment,
      data: typeof segment.data === 'string' ? segment.data : encodeBytesAsDataUrl(segment.data, 'application/x-tensnap-snapshot-segment'),
    })),
  };
}

export function isSnapshotArchive(value: unknown): value is SnapshotArchive {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && Array.isArray(record.segments) && !('initial' in record);
}
