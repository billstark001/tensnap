import { expect, it } from 'vitest';
import { Scenario } from '../scenario';
import { createSingleSnapshot, frameFromRecording, snapshotFromFrame } from './index';

it('does not invent checkpoints at later historical positions', () => {
  const scene = new Scenario().dump();
  const snapshot = createSingleSnapshot(scene, {
    modelIdentity: { model_id: 'model' },
    checkpoint: { model_id: 'model', encoding: 'raw', data: Uint8Array.of(1) },
  });
  snapshot.frames.push({
    index: 3,
    timestamp: 2,
    messages: [{ type: 'metadata_update', payload: { time: 99 } }],
    controls: [],
    kind: 'control',
  });
  const initial = frameFromRecording(snapshot, 0);
  expect(initial.checkpoint).toBeDefined();
  const later = frameFromRecording(snapshot, 3);
  expect(later.checkpoint).toBeUndefined();
  expect(later.source).toMatchObject({
    recordingId: snapshot.metadata.id,
    frame: 3,
    modelTime: 99,
  });
  expect(snapshotFromFrame(later).metadata.checkpoint).toBeUndefined();
  expect(() => frameFromRecording(snapshot, 2)).toThrow(/boundary/);
});
