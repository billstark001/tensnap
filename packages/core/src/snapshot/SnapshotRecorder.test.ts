import { describe, expect, it } from 'vitest';
import { Scenario } from '../scenario';
import { applySnapshotFrame, SnapshotPlayer, SnapshotRecorder, materializeSnapshot } from './SnapshotRecorder';
import { decodeSnapshotArchive, encodeSnapshotArchive, snapshotArchiveForJson } from './SnapshotArchive';

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
    const actionEnd = { type: 'action_result' as const, payload: { id: 'step', request_id: 'one' } };
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

  it('replays an optimistic parameter control when the simulator did not need to correct it', () => {
    const scenario = new Scenario();
    scenario.apply({ type: 'param_create', payload: { id: 'density', label: 'Density', type: 'number', value: 1 } });
    const recorder = new SnapshotRecorder(scenario);
    recorder.start();
    scenario.applyOptimisticParameterChange('density', 3);
    recorder.recordControl({ type: 'param_change', payload: { id: 'density', value: 3 } });
    recorder.recordMessage({ type: 'action_result', payload: { id: 'step', request_id: 'step-1' } });
    const snapshot = recorder.stop()!;

    expect(materializeSnapshot(snapshot).parameters[0].value).toBe(3);
    expect(new SnapshotPlayer(snapshot).seek(1).getParameter('density')?.value).toBe(3);
  });

  it('shares frame ordering with hosts that commit replay messages through their own path', () => {
    const scenario = new Scenario();
    scenario.apply({ type: 'param_create', payload: { id: 'density', label: 'Density', type: 'number', value: 1 } });
    const committed: string[] = [];

    applySnapshotFrame(scenario, {
      index: 1,
      timestamp: 1,
      kind: 'control',
      controls: [{ type: 'param_change', payload: { id: 'density', value: 3 } }],
      messages: [{ type: 'param_sync', payload: { id: 'density', value: 2.5 } }],
    }, {
      applyMessage: (message) => {
        committed.push(message.type);
        scenario.apply(message);
      },
    });

    expect(committed).toEqual(['param_sync']);
    expect(scenario.getParameter('density')?.value).toBe(2.5);
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
    recorder.recordMessage({ type: 'action_result', payload: { id: 'step' } });

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
    recorder.recordMessage({ type: 'action_result', payload: { id: 'step' } });

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
      recorder.recordMessage({ type: 'action_result', payload: { id: 'step' } });
    }
    const snapshot = recorder.stop()!;
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.frames).toHaveLength(2);
    expect(materializeSnapshot(snapshot).metadata.time).toBe(4);
  });

  it('keeps frame ids monotonic and seeks correctly across repeated ring-buffer evictions', () => {
    const scenario = new Scenario();
    const recorder = new SnapshotRecorder(scenario);
    recorder.start({ maxSteps: 2, ringBuffer: true, keyframeEvery: 2 });
    for (let time = 1; time <= 6; time += 1) {
      const message = { type: 'metadata_update' as const, payload: { time } };
      scenario.apply(message);
      recorder.recordMessage(message);
      recorder.recordMessage({ type: 'action_result', payload: { id: 'step' } });
    }

    const snapshot = recorder.stop()!;
    expect(snapshot.initial.frame).toBe(4);
    expect(snapshot.frames.map((frame) => frame.index)).toEqual([5, 6]);
    expect(new Set(snapshot.frames.map((frame) => frame.index)).size).toBe(snapshot.frames.length);
    // The retained keyframe is in a later segment than the newly promoted initial state.
    expect(snapshot.keyframes.map((keyframe) => keyframe.frame)).toEqual([6]);

    const player = new SnapshotPlayer(snapshot);
    for (const [frame, expectedTime] of [[6, 6], [5, 5], [99, 6], [4, 4], [5, 5], [-1, 4]] as const) {
      expect(player.seek(frame).metadata.time).toBe(expectedTime);
      expect(materializeSnapshot(snapshot, frame).metadata.time).toBe(expectedTime);
    }
  });

  it('rejects a byte budget below the initial baseline and never retains an over-budget frame', () => {
    const scenario = new Scenario();
    scenario.apply({ type: 'metadata_update', payload: { description: 'x'.repeat(4_096) } });
    const recorder = new SnapshotRecorder(scenario);

    expect(() => recorder.start({ maxBytes: 1 })).toThrow(/initial snapshot baseline/);
    expect(recorder.active).toBe(false);

    const baseline = recorder.start().byteLength;
    recorder.stop();
    recorder.start({ maxBytes: baseline + 128, ringBuffer: true });
    recorder.recordMessage({ type: 'metadata_update', payload: { description: 'y'.repeat(8_192) } });
    recorder.recordMessage({ type: 'action_result', payload: { id: 'step' } });

    const snapshot = recorder.stop()!;
    expect(snapshot.frames).toEqual([]);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.byteLength).toBeLessThanOrEqual(baseline + 128);
  });

  it('applies forward playback deltas without rebuilding the Scenario', () => {
    const scenario = new Scenario();
    const recorder = new SnapshotRecorder(scenario);
    recorder.start({ keyframeEvery: 100 });
    for (let time = 1; time <= 3; time += 1) {
      const update = { type: 'metadata_update' as const, payload: { time } };
      scenario.apply(update);
      recorder.recordMessage(update);
      recorder.recordMessage({ type: 'action_result', payload: { id: 'step' } });
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

  it('persists independently decodable MessagePack-compressed segments without changing replay', () => {
    const scenario = new Scenario();
    const recorder = new SnapshotRecorder(scenario);
    recorder.start({ keyframeEvery: 1 });
    for (let time = 1; time <= 3; time += 1) {
      const update = { type: 'metadata_update' as const, payload: { time, repeated: 'x'.repeat(64) } };
      scenario.apply(update);
      recorder.recordMessage(update);
      recorder.recordMessage({ type: 'action_result', payload: { id: 'step' } });
    }
    const snapshot = recorder.stop()!;

    const archive = encodeSnapshotArchive(snapshot, 1);
    expect(archive.segments.length).toBeGreaterThan(1);
    expect(archive.segments.every((segment) => segment.encoding === 'msgpack' && segment.byteLength > 0)).toBe(true);
    expect(archive.segments.every((segment) => segment.data instanceof Uint8Array)).toBe(true);
    expect(archive.byteLength).toBeLessThanOrEqual(snapshot.byteLength + 2_048);
    expect(materializeSnapshot(decodeSnapshotArchive(archive))).toEqual(scenario.dump());
  });

  it('rejects corrupt segment lengths, ranges, and duplicate frame ranges', () => {
    const scenario = new Scenario();
    const recorder = new SnapshotRecorder(scenario);
    recorder.start({ keyframeEvery: 1 });
    for (let time = 1; time <= 3; time += 1) {
      const update = { type: 'metadata_update' as const, payload: { time } };
      scenario.apply(update);
      recorder.recordMessage(update);
      recorder.recordMessage({ type: 'action_result', payload: { id: 'step' } });
    }
    const archive = encodeSnapshotArchive(recorder.stop()!, 1);

    const invalidLength = structuredClone(archive);
    invalidLength.segments[0]!.byteLength += 1;
    expect(() => decodeSnapshotArchive(invalidLength)).toThrow(/byteLength mismatch/);

    const invalidRange = structuredClone(archive);
    invalidRange.segments[0]!.firstFrame += 1;
    expect(() => decodeSnapshotArchive(invalidRange)).toThrow(/declared frame range/);

    const overlapping = structuredClone(archive);
    overlapping.segments = [overlapping.segments[0]!, structuredClone(overlapping.segments[0]!)];
    expect(() => decodeSnapshotArchive(overlapping)).toThrow(/duplicated|overlap|out of order/);
  });

  it('keeps identity and binary checkpoint metadata through JSON archive conversion', () => {
    const scenario = new Scenario();
    const recorder = new SnapshotRecorder(scenario);
    recorder.start({
      modelIdentity: { model_id: 'checkpoint-model', state_schema_version: '2', instance_id: 'instance-1' },
      checkpoint: {
        model_id: 'checkpoint-model',
        state_schema_version: '2',
        encoding: 'application/octet-stream',
        data: new Uint8Array([4, 5, 6]),
      },
    });
    const archive = snapshotArchiveForJson(encodeSnapshotArchive(recorder.stop()!));

    expect(typeof archive.metadata.checkpoint?.data).toBe('string');
    expect(decodeSnapshotArchive(archive).metadata).toMatchObject({
      model_identity: { model_id: 'checkpoint-model', state_schema_version: '2', instance_id: 'instance-1' },
      checkpoint: {
        model_id: 'checkpoint-model',
        state_schema_version: '2',
        encoding: 'application/octet-stream',
        data: 'data:application/octet-stream;base64,BAUG',
      },
    });
  });

  it('allows a host to replace a layer delta policy with a real codec implementation', () => {
    const scenario = new Scenario();
    scenario.apply({ type: 'env_create', payload: { id: 'main', type: '2d' } });
    scenario.apply({ type: 'env_layer_create', payload: { env_id: 'main', layer_id: 'agents', layer_type: 'agent' } });
    const recorder = new SnapshotRecorder(scenario);
    recorder.start({
      layerCodecs: { agents: 'delta' },
      layerCodecImplementations: {
        delta: { id: 'delta', forceKeyframe: true, retainItemDelta: () => false },
      },
    });
    const create = { type: 'item_create' as const, payload: { env_id: 'main', layer_id: 'agents', items: [{ id: 'a', x: 1, y: 1 }] } };
    scenario.apply(create);
    recorder.recordMessage(create);
    recorder.recordMessage({ type: 'action_result', payload: { id: 'step' } });

    const snapshot = recorder.stop()!;
    expect(snapshot.frames[0]?.messages.some((message) => message.type === 'item_create')).toBe(false);
    expect(snapshot.keyframes[0]?.frame).toBe(1);
    expect(materializeSnapshot(snapshot)).toEqual(scenario.dump());
  });
});
