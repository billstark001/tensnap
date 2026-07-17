import { describe, expect, it } from 'vitest';
import { Scenario } from '../scenario';
import { SnapshotRecorder } from './SnapshotRecorder';
import { SNAPSHOT_PLAYBACK_ACTIONS, SnapshotPlaybackSource } from './ProjectSource';

describe('SnapshotPlaybackSource', () => {
  it('replays only snapshot frames through the built-in playback controls', () => {
    const scenario = new Scenario();
    const recorder = new SnapshotRecorder(scenario);
    recorder.start();
    const update = { type: 'metadata_update' as const, payload: { time: 4 } };
    scenario.apply(update);
    recorder.recordMessage(update);
    recorder.recordMessage({ type: 'action_result', payload: { id: 'step', request_id: 'step-1' } });
    const source = new SnapshotPlaybackSource(recorder.stop()!);

    expect(SNAPSHOT_PLAYBACK_ACTIONS).toEqual(['start', 'step', 'stop', 'reset']);
    expect(source.playbackState).toBe('paused');
    source.start();
    source.step();
    expect(source.scenario.metadata.time).toBe(4);
    source.reset();
    expect(source.playbackState).toBe('paused');
    expect(source.scenario.metadata.time).toBeUndefined();
  });

  it('exposes the forward delta for renderer playback without materializing a new scenario', () => {
    const scenario = new Scenario();
    const recorder = new SnapshotRecorder(scenario);
    recorder.start();
    const update = { type: 'metadata_update' as const, payload: { time: 7 } };
    scenario.apply(update);
    recorder.recordMessage(update);
    recorder.recordMessage({ type: 'action_result', payload: { id: 'step', request_id: 'step-7' } });
    const source = new SnapshotPlaybackSource(recorder.stop()!);
    const scenarioRef = source.scenario;

    const frame = source.stepFrame();

    expect(frame?.messages).toContainEqual(update);
    expect(source.scenario).toBe(scenarioRef);
    expect(source.scenario.metadata.time).toBe(7);
    expect(source.stepFrame()).toBeNull();
  });

  it('continues correctly after an explicit backwards seek', () => {
    const scenario = new Scenario();
    const recorder = new SnapshotRecorder(scenario);
    recorder.start();
    for (let time = 1; time <= 3; time += 1) {
      const update = { type: 'metadata_update' as const, payload: { time } };
      scenario.apply(update);
      recorder.recordMessage(update);
      recorder.recordMessage({ type: 'action_result', payload: { id: 'step', request_id: `step-${time}` } });
    }
    const source = new SnapshotPlaybackSource(recorder.stop()!);

    source.stepFrame();
    source.stepFrame();
    source.seek(source.snapshot.initial.frame);

    expect(source.stepFrame()?.index).toBe(1);
    expect(source.scenario.metadata.time).toBe(1);
  });
});
