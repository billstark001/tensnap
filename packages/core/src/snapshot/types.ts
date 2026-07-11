import type {
  ActionEndPayload,
  RendererToSimulatorMessage,
  SimulatorToRendererMessage,
} from '@tensnap/protocol';
import type { ScenarioSnapshot } from '../scenario';

/** A complete, directly loadable Scenario state at a point in a recording. */
export interface Keyframe {
  /** Frame number represented by this state. Frame zero is the initial state. */
  frame: number;
  timestamp: number;
  scenario: ScenarioSnapshot;
}

/** The storage strategy requested for a layer in a recording. */
export type SnapshotLayerCodec = 'delta' | 'keyframe' | 'adaptive' | 'derived';

/** A compact, atomically observable span of protocol activity. */
export interface SnapshotFrame {
  index: number;
  timestamp: number;
  /** Simulator updates, coalesced without changing their final Scenario state. */
  messages: SimulatorToRendererMessage[];
  /** Renderer control requests issued during this frame. */
  controls: RendererToSimulatorMessage[];
  action?: ActionEndPayload;
  kind: 'action' | 'control' | 'sync';
}

export interface SnapshotMetadata {
  id: string;
  createdAt: number;
  endedAt?: number;
  label?: string;
}

/**
 * A seekable recording. `initial` and `keyframes` are complete states; frames
 * between them are protocol deltas. This deliberately has no relation to the
 * old one-off `ScenarioSnapshot` shape.
 */
export interface Snapshot {
  version: 1;
  metadata: SnapshotMetadata;
  initial: Keyframe;
  keyframes: Keyframe[];
  frames: SnapshotFrame[];
  layerCodecs: Record<string, SnapshotLayerCodec>;
  byteLength: number;
  truncated: boolean;
}

/** Lossless compression applied to an independently decodable segment. */
export type SnapshotCompression = 'none' | 'rle';

/**
 * The persisted unit of a recording. Its payload is MessagePack bytes and it
 * always starts from a complete keyframe, so a later segment can be decoded
 * without decoding the recording prefix.
 */
export interface SnapshotSegment {
  firstFrame: number;
  lastFrame: number;
  encoding: 'msgpack';
  compression: SnapshotCompression;
  data: Uint8Array | string;
  byteLength: number;
}

/** Storage-only representation used in project files and worker hand-off. */
export interface SnapshotArchive {
  version: 1;
  metadata: SnapshotMetadata;
  layerCodecs: Record<string, SnapshotLayerCodec>;
  segments: SnapshotSegment[];
  byteLength: number;
  truncated: boolean;
}

/** Pluggable policy for a layer's recorded deltas. */
export interface SnapshotLayerCodecImplementation {
  id: SnapshotLayerCodec;
  retainItemDelta?: (input: {
    envId: string;
    layerId: string;
    layerType?: string;
    messageType: 'item_create' | 'item_update' | 'item_delete';
  }) => boolean;
  forceKeyframe?: boolean;
}

/** A named collection for project-level recordings. */
export interface SnapshotSeries {
  snapshots: Snapshot[];
}

export interface RecordingOptions {
  /** Maximum retained atomic frames. Omit for no frame-count budget. */
  maxSteps?: number;
  /** Maximum retained duration in milliseconds. Omit for no time budget. */
  maxDurationMs?: number;
  /** Maximum estimated serialized bytes. Omit for no byte budget. */
  maxBytes?: number;
  /** Drop the oldest seekable segment when a budget is exceeded. */
  ringBuffer?: boolean;
  /** Force a full keyframe at this interval; adaptive recording may add more. */
  keyframeEvery?: number;
  /** Per-layer storage preferences, keyed by layer id or layer type. */
  layerCodecs?: Record<string, SnapshotLayerCodec>;
  /** Host/application codecs can replace the built-in item-delta policies. */
  layerCodecImplementations?: Partial<Record<SnapshotLayerCodec, SnapshotLayerCodecImplementation>>;
  id?: string;
  label?: string;
  timestamp?: number;
}
