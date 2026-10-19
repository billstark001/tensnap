import { describe, expect, it, vi } from 'vitest';
import { Scenario } from '../scenario';
import { SnapshotRecorder, createSingleSnapshot } from './SnapshotRecorder';
import { SNAPSHOT_PLAYBACK_ACTIONS, SnapshotPlaybackSource } from './ProjectSource';

describe('SnapshotPlaybackSource', () => {
  it('replays only snapshot frames through the built-in playback controls', () => {
    const scenario = new Scenario();
    const recorder = new SnapshotRecorder(scenario);
    recorder.start();
    const update = { type: 'metadata_update' as const, payload: { time: 4 } };
    scenario.apply(update);
    recorder.recordMessage(update);
    recorder.recordMessage({
      type: 'action_result',
      payload: { id: 'step', request_id: 'step-1' },
    });
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
    recorder.recordMessage({
      type: 'action_result',
      payload: { id: 'step', request_id: 'step-7' },
    });
    const source = new SnapshotPlaybackSource(recorder.stop()!);
    const scenarioRef = source.scenario;

    const frame = source.stepFrame();

    expect(frame?.messages).toContainEqual(update);
    expect(source.scenario).toBe(scenarioRef);
    expect(source.scenario.metadata.time).toBe(7);
    source.start();
    expect(source.stepFrame()).toBeNull();
    expect(source.playbackState).toBe('paused');
  });

  it('continues correctly after an explicit backwards seek', () => {
    const scenario = new Scenario();
    const recorder = new SnapshotRecorder(scenario);
    recorder.start();
    for (let time = 1; time <= 3; time += 1) {
      const update = { type: 'metadata_update' as const, payload: { time } };
      scenario.apply(update);
      recorder.recordMessage(update);
      recorder.recordMessage({
        type: 'action_result',
        payload: { id: 'step', request_id: `step-${time}` },
      });
    }
    const source = new SnapshotPlaybackSource(recorder.stop()!);

    source.stepFrame();
    source.stepFrame();
    source.seek(source.snapshot.initial.frame);

    expect(source.stepFrame()?.index).toBe(1);
    expect(source.scenario.metadata.time).toBe(1);
  });
});

it('releases playback image URLs exactly once and forbids reuse after closing', () => {
  const create = vi.fn(() => 'blob:playback');
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const scene = new Scenario().dump();
  scene.assets.push({
    meta: { id: 'sprite', hash: 'one', mime: 'image/png', size: 1 },
    data: Uint8Array.of(1),
  });
  try {
    const playback = new SnapshotPlaybackSource(createSingleSnapshot(scene));
    expect(create).toHaveBeenCalledOnce();
    playback.close();
    playback.close();
    expect(revoke).toHaveBeenCalledOnce();
    expect(playback.scenario.assets.listMeta()).toEqual([]);
    for (const operation of [
      () => playback.start(),
      () => playback.stop(),
      () => playback.step(),
      () => playback.reset(),
      () => playback.seek(0),
      () => playback.player.seek(0),
    ]) {
      expect(operation).toThrow('closed');
    }
  } finally {
    vi.unstubAllGlobals();
  }
});
