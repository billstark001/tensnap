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

it('removes an initial checkpoint when rolling retention advances the initial boundary', async () => {
  const { SnapshotRecorder } = await import('./SnapshotRecorder');
  const scenario = new Scenario();
  const recorder = new SnapshotRecorder(scenario);
  recorder.start({
    maxSteps: 1,
    ringBuffer: true,
    checkpoint: { model_id: 'model', encoding: 'raw', data: Uint8Array.of(1) },
  });
  for (const index of [1, 2]) {
    scenario.apply({ type: 'metadata_update', payload: { time: index } });
    recorder.recordMessage({ type: 'metadata_update', payload: { time: index } });
    recorder.recordMessage({
      type: 'action_result',
      payload: { id: 'step', request_id: `step-${index}` },
    });
  }
  const snapshot = recorder.stop()!;
  expect(snapshot.initial.frame).toBeGreaterThan(0);
  expect(snapshot.metadata.checkpoint).toBeUndefined();
  expect(frameFromRecording(snapshot, snapshot.initial.frame).checkpoint).toBeUndefined();
});
