import { queryScenario, type ScenarioQuery } from '../scenario/query';
import { materializeSnapshot, SnapshotPlayer } from './SnapshotRecorder';
import type { Snapshot } from './types';
import { exactValueEqual } from './diff';

export function queryRecording(snapshot: Snapshot, frame: number, query: ScenarioQuery) {
  if (frame !== snapshot.initial.frame && !snapshot.frames.some((f) => f.index === frame))
    throw new Error('Query frame is not a retained boundary.');
  const scene = materializeSnapshot(snapshot, frame);
  const action = snapshot.frames.find((f) => f.index === frame)?.action;
  return queryScenario(scene, query, {
    kind: 'recording',
    sourceId: snapshot.metadata.id,
    revision: frame,
    frame,
    modelTime: typeof scene.metadata.time === 'number' ? scene.metadata.time : undefined,
    actionRequestId: action?.request_id,
  });
}

/** Historical monitor samples come from recording boundaries, never MonitorStorage history. */
export function monitorHistory(
  snapshot: Snapshot,
  options: {
    monitorId: string;
    from: number;
    to: number;
    sampling: 'boundaries' | 'changes';
    fields?: ScenarioQuery['fields'];
    limit?: number;
    after?: number;
  },
) {
  const { from, to, monitorId, sampling, after } = options;
  const limit = options.limit ?? 100;
  if (
    !monitorId ||
    !Number.isSafeInteger(from) ||
    from < 0 ||
    !Number.isSafeInteger(to) ||
    to < from ||
    !['boundaries', 'changes'].includes(sampling) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000 ||
    (after !== undefined && (!Number.isSafeInteger(after) || after < from || after > to))
  )
    throw new Error('Invalid monitor history range or sampling.');
  const query: ScenarioQuery = {
    selector: { kind: 'monitor', id: monitorId },
    fields: options.fields,
  };
  const boundaries = [snapshot.initial.frame, ...snapshot.frames.map((f) => f.index)];
  const player = new SnapshotPlayer(snapshot);
  const samples: Array<ReturnType<typeof queryScenario>> = [];
  let previous: unknown;
  let hasPrevious = false;
  let continuation: number | undefined;
  for (const frame of boundaries) {
    if (frame > to) break;
    if (frame < from) continue;
    const scenario = player.seek(frame);
    const sample = queryScenario(scenario, query, {
      kind: 'recording',
      sourceId: snapshot.metadata.id,
      revision: frame,
      frame,
      modelTime: scenario.time,
      actionRequestId: snapshot.frames.find((f) => f.index === frame)?.action?.request_id,
    });
    const changed = !hasPrevious || !exactValueEqual(previous, sample.items);
    previous = sample.items;
    hasPrevious = true;
    if (after !== undefined && frame <= after) continue;
    if (sampling === 'changes' && !changed) continue;
    if (samples.length === limit) {
      continuation = samples[samples.length - 1].location.frame;
      break;
    }
    samples.push(sample);
  }
  const first = snapshot.initial.frame;
  const last = boundaries[boundaries.length - 1];
  const gaps: Array<{ from: number; to: number; reason: string }> = [];
  if (from < first) gaps.push({ from, to: Math.min(to, first - 1), reason: 'not-retained' });
  if (to > last) gaps.push({ from: Math.max(from, last + 1), to, reason: 'not-observed' });
  for (let i = 1; i < boundaries.length; i++)
    if (boundaries[i] - boundaries[i - 1] > 1) {
      const gapFrom = Math.max(from, boundaries[i - 1] + 1),
        gapTo = Math.min(to, boundaries[i] - 1);
      if (gapFrom <= gapTo) gaps.push({ from: gapFrom, to: gapTo, reason: 'missing-boundaries' });
    }
  return {
    version: 1 as const,
    sourceId: snapshot.metadata.id,
    requested: { from, to },
    retained: { from: first, to: last },
    sampling,
    samples,
    gaps,
    truncated: continuation !== undefined,
    ...(continuation === undefined ? {} : { continuation }),
  };
}
