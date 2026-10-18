import { describe, expect, it } from 'vitest';
import { Scenario } from '../scenario';
import {
  SnapshotRecorder,
  createSingleSnapshot,
  encodeSnapshotArchive,
  materializeSnapshot,
} from '../snapshot';
import {
  createDefaultRootLayout,
  encodeProjectFile,
  decodeProjectFile,
  extractSnapshotAssets,
  hydrateSnapshotAssets,
} from './index';
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
  it('detaches hydrated resource bytes from the input table without recopying every reference', () => {
    const original = fixture();
    original.initial.scenario.assets.push({
      meta: { id: 'image', hash: 'hash', mime: 'image/png', size: 2 },
      data: Uint8Array.of(1, 2),
    });
    original.frames[0].messages.push({
      type: 'asset_data',
      payload: { id: 'image', hash: 'hash', mime: 'image/png', data: Uint8Array.of(1, 2) },
    });
    const table: Record<string, { mime: string; data: string | Uint8Array }> = {};
    const stripped = extractSnapshotAssets(original, table);
    expect(original.initial.scenario.assets[0].data).toBeDefined();
    expect(stripped.initial.scenario.assets[0].data).toBeUndefined();
    const hydrated = hydrateSnapshotAssets(stripped, table);
    const bytes = hydrated.initial.scenario.assets[0].data as Uint8Array;
    (table.hash.data as Uint8Array)[0] = 99;
    expect(Array.from(bytes)).toEqual([1, 2]);
    const message = hydrated.frames[0].messages.find((message) => message.type === 'asset_data')!;
    expect((message.payload as { data: Uint8Array }).data).toBe(bytes);
    bytes[1] = 3;
    expect(Array.from(original.initial.scenario.assets[0].data as Uint8Array)).toEqual([1, 2]);
  });

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

  it('hydrates frame asset messages and preserves control/sync frames, chart state and checkpoints', () => {
    const snapshot = fixture();
    snapshot.initial.scenario.charts = [
      { id: 'series', label: 'Series', metadataDict: {}, data: [{ time: 8, value: 2 }] },
    ];
    snapshot.metadata.model_identity = { model_id: 'fixture', state_schema_version: '1' };
    snapshot.metadata.checkpoint = {
      model_id: 'fixture',
      state_schema_version: '1',
      encoding: 'raw',
      data: Uint8Array.of(1, 2),
    };
    snapshot.frames.push({
      index: 4,
      timestamp: 4,
      kind: 'control',
      controls: [{ type: 'param_change', payload: { id: 'value', value: 2 } }],
      messages: [
        {
          type: 'asset_metadata',
          payload: { assets: [{ id: 'image', hash: 'image-hash', mime: 'image/png', size: 3 }] },
        },
        {
          type: 'asset_data',
          payload: {
            id: 'image',
            hash: 'image-hash',
            mime: 'image/png',
            data: Uint8Array.of(1, 2, 3),
          },
        },
      ],
    });
    snapshot.frames.push({
      index: 5,
      timestamp: 5,
      kind: 'sync',
      controls: [
        {
          type: 'state_sync',
          payload: {
            request_id: 'sync',
            model_id: 'fixture',
            parameters: [],
            actions: [],
            envs: [],
            charts: [],
            monitors: [],
          },
        },
      ],
      messages: [
        {
          type: 'state_sync_begin',
          payload: {
            request_id: 'sync',
            model_id: 'fixture',
            instance_id: 'fixture',
            mode: 'replace',
          },
        },
        { type: 'state_sync_end', payload: { request_id: 'sync', state_revision: '1' } },
      ],
    });
    for (const format of ['json', 'msgpack'] as const) {
      const document = decodeRecordingFile(encodeRecordingFile(snapshot, { format }));
      expect(document.snapshot.frames[3].controls).toEqual(snapshot.frames[3].controls);
      expect(document.snapshot.frames[4].kind).toBe('sync');
      expect(document.snapshot.initial.scenario.charts).toEqual(snapshot.initial.scenario.charts);
      expect(document.snapshot.metadata.checkpoint?.encoding).toBe('raw');
      expect(document.report.resourcesComplete).toBe(true);
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

  it('reports missing frame resources and ignores derived background URLs and model data links', () => {
    const snapshot = fixture();
    snapshot.initial.scenario.environments = [
      {
        id: 'world',
        type: '2d',
        layers: [
          {
            id: 'background',
            layerType: 'background',
            metadata: { background: { asset_id: 'image' } },
            dependencyLayerIds: {},
            storageSnapshot: { kind: 'image', url: 'blob:derived' },
          },
          {
            id: 'agents',
            layerType: 'agent',
            metadata: {},
            dependencyLayerIds: {},
            storageSnapshot: {
              agents: [{ id: 'agent', data: { url: 'https://example.org/model-information' } }],
            },
          },
        ],
      },
    ];
    snapshot.initial.scenario.assets.push({
      meta: { id: 'image', hash: 'hash', mime: 'image/png', size: 1 },
      data: Uint8Array.of(1),
    });
    const file = createRecordingFile(snapshot);
    expect(parseRecordingFile(file).report.resourcesComplete).toBe(true);
    file.assetTable = {};
    const missing = parseRecordingFile(file);
    expect(missing.report.missingAssets).toEqual(['hash']);
    expect(() => createRecordingFile(missing.snapshot, { allowIncomplete: true })).not.toThrow();
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

  it('matches replay time across keyframes, inherited time and metadata-only updates', () => {
    const snapshot = fixture();
    snapshot.frames[2].messages.unshift({ type: 'metadata_update', payload: { label: 'final' } });
    snapshot.frames.push({
      index: 4,
      timestamp: 4,
      kind: 'control',
      controls: [],
      messages: [{ type: 'metadata_update', payload: { label: 'inherited time' } }],
    });
    for (const time of [3, 7, 8, 9, 12, 20]) {
      const entries = [snapshot.initial.frame, ...snapshot.frames.map((frame) => frame.index)].map(
        (frame) => ({
          frame,
          modelTime: materializeSnapshot(snapshot, frame).metadata.time as number,
        }),
      );
      for (const match of ['first', 'last', 'before', 'after'] as const) {
        let candidates = entries.filter((entry) =>
          match === 'before'
            ? entry.modelTime <= time
            : match === 'after'
              ? entry.modelTime >= time
              : entry.modelTime === time,
        );
        if (match === 'before' || match === 'after') {
          const nearest = (match === 'before' ? Math.max : Math.min)(
            ...candidates.map((entry) => entry.modelTime),
          );
          candidates = candidates.filter((entry) => entry.modelTime === nearest);
        }
        const expected =
          match === 'first' || match === 'after'
            ? candidates[0]
            : candidates[candidates.length - 1];
        if (expected) expect(selectRecordingFrame(snapshot, { time, match })).toEqual(expected);
        else expect(() => selectRecordingFrame(snapshot, { time, match })).toThrow(/No retained/);
      }
    }
  });

  it('selects time in large recordings without replaying scene data or spreading matches', () => {
    const snapshot = createSingleSnapshot(new Scenario().dump());
    snapshot.initial.scenario.metadata.time = 8;
    let reads = 0;
    const count = 150_000;
    snapshot.frames = Array.from({ length: count }, (_, index) => ({
      index: index + 1,
      timestamp: index,
      kind: 'action',
      controls: [],
      get messages() {
        if (++reads > count) throw new Error('Repeated history traversal');
        return [];
      },
    }));
    expect(selectRecordingFrame(snapshot, { time: 9, match: 'before' })).toEqual({
      frame: count,
      modelTime: 8,
    });
    expect(reads).toBe(count);
  });
});
