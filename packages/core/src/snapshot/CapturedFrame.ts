import type { ScenarioSnapshot } from '../scenario';
import { createSingleSnapshot, materializeSnapshot } from './SnapshotRecorder';
import type { Snapshot, SnapshotCheckpoint, SnapshotModelIdentity } from './types';

export interface CapturedFrameSource {
  kind: 'live' | 'recording';
  recordingId?: string;
  frame?: number;
  actionRequestId?: string;
  modelTime?: number;
  commitRevision?: number;
}
/** An owned, fixed capture. Hosts must render this scene rather than reading live state again. */
export interface CapturedFrame {
  id: string;
  capturedAt: number;
  scene: ScenarioSnapshot;
  checkpoint?: SnapshotCheckpoint;
  modelIdentity?: SnapshotModelIdentity;
  source: CapturedFrameSource;
  consistency: 'renderer-only' | 'aligned' | 'unverified';
  checkpointStatus: 'captured' | 'not-requested' | 'unsupported' | 'unavailable' | 'inconsistent';
  checkpointReason?: string;
}

export function frameFromRecording(snapshot: Snapshot, frameIndex: number): CapturedFrame {
  if (
    frameIndex !== snapshot.initial.frame &&
    !snapshot.frames.some((frame) => frame.index === frameIndex)
  )
    throw new Error(`Frame ${frameIndex} is not a retained recording boundary.`);
  const scene = materializeSnapshot(snapshot, frameIndex);
  const frame = snapshot.frames.find((frame) => frame.index === frameIndex);
  const checkpoint =
    frameIndex === snapshot.initial.frame ? snapshot.metadata.checkpoint : undefined;
  return structuredClone({
    id: crypto.randomUUID(),
    capturedAt: Date.now(),
    scene,
    ...(checkpoint ? { checkpoint } : {}),
    ...(snapshot.metadata.model_identity
      ? { modelIdentity: snapshot.metadata.model_identity }
      : {}),
    source: {
      kind: 'recording' as const,
      recordingId: snapshot.metadata.origin?.recordingId ?? snapshot.metadata.id,
      frame: snapshot.metadata.origin?.frame ?? frameIndex,
      ...(snapshot.metadata.origin?.actionRequestId
        ? { actionRequestId: snapshot.metadata.origin.actionRequestId }
        : frame?.action
          ? { actionRequestId: frame.action.request_id }
          : {}),
      ...(typeof scene.metadata.time === 'number' ? { modelTime: scene.metadata.time } : {}),
    },
    consistency: checkpoint ? ('aligned' as const) : ('renderer-only' as const),
    checkpointStatus: checkpoint ? ('captured' as const) : ('unavailable' as const),
    ...(!checkpoint
      ? { checkpointReason: 'No checkpoint was captured at this historical boundary.' }
      : {}),
  });
}

/** Verify checkpoint association without cloning or encoding the projected scene. */
export function assertFrameCheckpoint(frame: CapturedFrame): void {
  if (
    frame.checkpoint &&
    (frame.consistency !== 'aligned' || frame.checkpointStatus !== 'captured')
  )
    throw new Error('An unverified frame cannot export an exact checkpoint.');
  if (
    frame.checkpoint &&
    (!frame.modelIdentity ||
      frame.modelIdentity.model_id !== frame.checkpoint.model_id ||
      frame.modelIdentity.state_schema_version !== frame.checkpoint.state_schema_version)
  )
    throw new Error('Frame checkpoint identity does not match its source.');
}

export function snapshotFromFrame(frame: CapturedFrame): Snapshot {
  assertFrameCheckpoint(frame);
  const snapshot = createSingleSnapshot(frame.scene, {
    id: frame.id,
    timestamp: frame.capturedAt,
    modelIdentity: frame.modelIdentity,
    checkpoint: frame.checkpoint,
  });
  if (frame.source.kind === 'recording')
    snapshot.metadata.origin = {
      recordingId: frame.source.recordingId!,
      frame: frame.source.frame!,
      ...(frame.source.actionRequestId ? { actionRequestId: frame.source.actionRequestId } : {}),
      ...(frame.source.modelTime !== undefined ? { modelTime: frame.source.modelTime } : {}),
    };
  return snapshot;
}
