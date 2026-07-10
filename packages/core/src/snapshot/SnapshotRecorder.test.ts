import { describe, expect, it } from 'vitest';
import { Scenario } from '../scenario';
import { SnapshotPlayer, SnapshotRecorder, materializeSnapshot } from './SnapshotRecorder';

describe('SnapshotRecorder', () => {
  it('replays coalesced atomic frames to the exact recorded Scenario state', () => {
    const scenario = new Scenario();
    scenario.apply({ type: 'env_create', payload: { id: 'main', type: '2d' } });
    scenario.apply({ type: 'env_layer_create', payload: { env_id: 'main', layer_id: 'agents', layer_type: 'agent' } });
    const recorder = new SnapshotRecorder(scenario);
    recorder.start({ keyframeEvery: 1 });

    const create = { type: 'item_create' as const, payload: { env_id: 'main', layer_id: 'agents', items: [{ id: 'a', x: 0, y: 0 }] } };
    const update = { type: 'item_update' as const, payload: { env_id: 'main', layer_id: 'agents', items: [{ id: 'a', x: 2, y: 3 }] } };
    scenario.apply(create);
    recorder.recordMessage(create);
    scenario.apply(update);
    recorder.recordMessage(update);
    const actionEnd = { type: 'action_end' as const, payload: { id: 'step', tick_id: 'one' } };
    scenario.apply(actionEnd);
    recorder.recordMessage(actionEnd);

    const snapshot = recorder.stop()!;
    expect(snapshot.frames).toHaveLength(1);
    expect(snapshot.frames[0].messages.filter((message) => message.type === 'item_create')).toEqual([
      { type: 'item_create', payload: { env_id: 'main', layer_id: 'agents', items: [{ id: 'a', x: 2, y: 3 }] } },
    ]);
    expect(materializeSnapshot(snapshot)).toEqual(scenario.dump());
  });

  it('records parameter requests and canonical simulator values in one control frame', () => {
    const scenario = new Scenario();
    scenario.apply({ type: 'param_create', payload: { id: 'density', label: 'Density', type: 'number', value: 1 } });
    const recorder = new SnapshotRecorder(scenario);
    recorder.start();
    recorder.recordControl({ type: 'param_change', payload: { id: 'density', value: 2 } });
    recorder.recordControl({ type: 'param_change', payload: { id: 'density', value: 3 } });
    const sync = { type: 'param_sync' as const, payload: { id: 'density', value: 2.5 } };
    scenario.apply(sync);
    recorder.recordMessage(sync);
    const snapshot = recorder.stop()!;

    expect(snapshot.frames).toHaveLength(1);
    expect(snapshot.frames[0].controls).toEqual([{ type: 'param_change', payload: { id: 'density', value: 3 } }]);
    expect(materializeSnapshot(snapshot).parameters[0].value).toBe(2.5);
  });

  it('uses requested keyframe codecs without retaining redundant item deltas', () => {
    const scenario = new Scenario();
    scenario.apply({ type: 'env_create', payload: { id: 'main', type: '2d' } });
    scenario.apply({ type: 'env_layer_create', payload: { env_id: 'main', layer_id: 'agents', layer_type: 'agent' } });
    const recorder = new SnapshotRecorder(scenario);
    recorder.start({ layerCodecs: { agents: 'keyframe' } });
    const create = { type: 'item_create' as const, payload: { env_id: 'main', layer_id: 'agents', items: [{ id: 'a', x: 1, y: 2 }] } };
    scenario.apply(create);
    recorder.recordMessage(create);
    recorder.recordMessage({ type: 'action_end', payload: { id: 'step' } });

    const snapshot = recorder.stop()!;
    expect(snapshot.frames[0].messages.some((message) => message.type === 'item_create')).toBe(false);
    expect(snapshot.keyframes[snapshot.keyframes.length - 1]?.frame).toBe(1);
    expect(materializeSnapshot(snapshot)).toEqual(scenario.dump());
  });

  it('keeps append-only chart data out of keyframes and restores it on seek', () => {
    const scenario = new Scenario();
    scenario.apply({ type: 'chart_create', payload: { id: 'population', label: 'Population' } });
    const recorder = new SnapshotRecorder(scenario);
    recorder.start({ keyframeEvery: 1 });
    const update = { type: 'chart_update' as const, payload: { updates: [{ id: 'population', time: 1, value: 42 }] } };
    scenario.apply(update);
    recorder.recordMessage(update);
    recorder.recordMessage({ type: 'action_end', payload: { id: 'step' } });

    const snapshot = recorder.stop()!;
    expect(snapshot.keyframes[0]?.scenario.charts).toEqual([]);
    expect(materializeSnapshot(snapshot)).toEqual(scenario.dump());
    expect(new SnapshotPlayer(snapshot).seek(1).charts.getGroup('population')?.data).toEqual([{ time: 1, population: 42 }]);
  });

  it('keeps a seekable suffix when ring-buffer retention is exceeded', () => {
    const scenario = new Scenario();
    const recorder = new SnapshotRecorder(scenario);
    recorder.start({ maxSteps: 2, ringBuffer: true, keyframeEvery: 1000 });
    for (let time = 1; time <= 4; time += 1) {
      const message = { type: 'metadata_update' as const, payload: { time } };
      scenario.apply(message);
      recorder.recordMessage(message);
      recorder.recordMessage({ type: 'action_end', payload: { id: 'step' } });
    }
    const snapshot = recorder.stop()!;
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.frames).toHaveLength(2);
    expect(materializeSnapshot(snapshot).metadata.time).toBe(4);
  });

  it('applies forward playback deltas without rebuilding the Scenario', () => {
    const scenario = new Scenario();
    const recorder = new SnapshotRecorder(scenario);
    recorder.start({ keyframeEvery: 100 });
    for (let time = 1; time <= 3; time += 1) {
      const update = { type: 'metadata_update' as const, payload: { time } };
      scenario.apply(update);
      recorder.recordMessage(update);
      recorder.recordMessage({ type: 'action_end', payload: { id: 'step' } });
    }
    const snapshot = recorder.stop()!;
    const player = new SnapshotPlayer(snapshot);
    const scenarioRef = player.scenario;

    player.seek(1);
    player.seek(2);
    player.seek(3);
    expect(player.scenario).toBe(scenarioRef);
    expect(player.scenario.metadata.time).toBe(3);
    player.seek(1);
    expect(player.scenario.metadata.time).toBe(1);
  });
});
