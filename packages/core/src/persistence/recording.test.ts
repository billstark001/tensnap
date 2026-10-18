import { describe, expect, it } from 'vitest';
import { Scenario } from '../scenario';
import { SnapshotRecorder, createSingleSnapshot, encodeSnapshotArchive } from '../snapshot';
import { createDefaultRootLayout, encodeProjectFile, decodeProjectFile } from './index';
import {
  createRecordingFile,
  decodeRecordingFile,
  encodeRecordingFile,
  parseRecordingFile,
  selectRecordingFrame,
} from './recording';

function fixture() {
  const scenario = new Scenario();
  scenario.apply({ type: 'metadata_update', payload: { time: 8 } });
  scenario.apply({ type: 'monitor_create', payload: { id: 'health', label: 'Health' } });
  scenario.apply({
    type: 'monitor_update',
    payload: { id: 'health', value: { nested: [1, 'ok'] } },
  });
  const recorder = new SnapshotRecorder(scenario);
  recorder.start({ id: 'fixture', keyframeEvery: 2 });
  for (const time of [8, 3, 12]) {
    const message = { type: 'metadata_update' as const, payload: { time } };
    scenario.apply(message);
    recorder.recordMessage(message);
    recorder.recordMessage({
      type: 'action_result',
      payload: { id: 'step', request_id: `step-${time}` },
    });
  }
  return recorder.stop()!;
}

describe('portable persistence', () => {
  it('round trips existing projects as JSON and MessagePack', () => {
    for (const format of ['json', 'msgpack'] as const) {
      const snapshot = fixture();
      const content = {
        version: 3 as const,
        source: { kind: 'snapshot' as const, snapshot_id: snapshot.metadata.id },
        mainView: createDefaultRootLayout(),
        scenario: snapshot.initial.scenario,
        snapshots: [snapshot],
      };
      const restored = decodeProjectFile(encodeProjectFile(content, format), format);
      expect(restored.scenario).toEqual(content.scenario);
      expect(restored.snapshots[0].frames).toEqual(snapshot.frames);
    }
  });

  it('round trips resources, monitors and the complete timeline', () => {
    const snapshot = fixture();
    snapshot.initial.scenario.assets.push({
      meta: { id: 'image', hash: 'image-hash', mime: 'image/png', size: 3 },
      data: Uint8Array.of(1, 2, 3),
    });
    for (const format of ['json', 'msgpack'] as const) {
      const restored = decodeRecordingFile(encodeRecordingFile(snapshot, { format }));
      expect(restored.snapshot.frames).toEqual(snapshot.frames);
      expect(restored.report.resourcesComplete).toBe(true);
      expect(restored.snapshot.initial.scenario.monitors).toEqual(
        snapshot.initial.scenario.monitors,
      );
      expect(restored.snapshot.initial.scenario.assets[0].data).toBeDefined();
    }
  });

  it('rejects future formats, corrupt segments, invalid frame order and missing resources', () => {
    const snapshot = fixture();
    const file = createRecordingFile(snapshot);
    expect(() => parseRecordingFile({ ...file, version: 2 })).toThrow();
    file.recording.segments[0].byteLength++;
    expect(() => parseRecordingFile(file)).toThrow(/byteLength/);
    snapshot.frames.reverse();
    expect(() => createRecordingFile(snapshot)).toThrow(/ordered/);
    const missing = createSingleSnapshot(new Scenario().dump());
    missing.initial.scenario.assets.push({
      meta: { id: 'lost', hash: 'lost', mime: 'image/png', size: 1 },
    });
    expect(() => createRecordingFile(missing)).toThrow(/incomplete/);
    expect(
      parseRecordingFile(createRecordingFile(missing, { allowIncomplete: true })).report
        .missingAssets,
    ).toEqual(['lost']);
  });

  it('requires an explicit legacy path and reports its provenance limitations', () => {
    const archive = encodeSnapshotArchive(fixture());
    expect(() => parseRecordingFile(archive)).toThrow(/legacy/);
    expect(parseRecordingFile(archive, { allowLegacy: true }).report.legacy).toBe(true);
  });

  it('selects actual sparse boundaries and repeated/backward model time explicitly', () => {
    const snapshot = fixture();
    snapshot.frames.forEach((frame, index) => (frame.index = 10 + index * 10));
    snapshot.keyframes = [];
    snapshot.initial.frame = 4;
    expect(selectRecordingFrame(snapshot, { time: 8, match: 'first' }).frame).toBe(4);
    expect(selectRecordingFrame(snapshot, { time: 8, match: 'last' }).frame).toBe(10);
    expect(selectRecordingFrame(snapshot, { time: 7, match: 'before' }).frame).toBe(20);
    expect(selectRecordingFrame(snapshot, { time: 9, match: 'after' }).frame).toBe(30);
    expect(() => selectRecordingFrame(snapshot, { frame: 12 })).toThrow(/retained/);
  });
});
