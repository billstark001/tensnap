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
});
