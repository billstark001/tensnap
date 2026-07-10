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
  id?: string;
  label?: string;
  timestamp?: number;
}
