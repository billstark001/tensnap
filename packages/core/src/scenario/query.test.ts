import { describe, it, expect, vi } from 'vitest';
import { Scenario } from './Scenario';
import { queryScenario, ScenarioQuerySchema } from './query';
import { queryRecording, monitorHistory } from '../snapshot/query';
import { SnapshotRecorder, createSingleSnapshot } from '../snapshot';
import type { SimulatorToRendererMessage } from '@tensnap/protocol';
const location = { kind: 'live' as const, sourceId: 'test', revision: 1 };
function scene() {
  const scenario = new Scenario();
  scenario.apply({ type: 'env_create', payload: { id: 'e/:', type: '2d' } });
  scenario.apply({
    type: 'env_layer_create',
    payload: { env_id: 'e/:', layer_id: 'a/:', layer_type: 'agent' },
  });
  scenario.apply({
    type: 'item_create',
    payload: {
      env_id: 'e/:',
      layer_id: 'a/:',
      items: [
        { id: 1, x: 0, y: 0, data: { score: 2 } },
        { id: '1', x: 1, y: 0, data: { score: 9 } },
      ],
    },
  });
  return scenario;
}
describe('bounded scene queries', () => {
  it('uses typed refs and returns owned projections without dumping the live scene', () => {
    const scenario = scene();
    const snapshot = scenario.dump();
    const dump = vi.spyOn(scenario, 'dump').mockImplementation(() => {
      throw new Error('full dump');
    });
    for (const agentId of [1, '1']) {
      const spec = {
        selector: {
          kind: 'agent' as const,
          ref: { environmentId: 'e/:', layerId: 'a/:', agentId },
        },
        fields: ['/data/score'],
      };
      const result = queryScenario(scenario, spec, location);
      expect(result).toEqual(queryScenario(snapshot, spec, location));
      result.items[0].fields![0].value = 200;
      expect(queryScenario(scenario, spec, location).items[0].fields![0].value).toBe(
        agentId === 1 ? 2 : 9,
      );
    }
    expect(dump).not.toHaveBeenCalled();
    expect(
      queryScenario(scenario, { selector: { kind: 'monitor', id: 'missing' } }, location).found,
    ).toBe(false);
  });
  it('binds pagination to the source, revision and selector', () => {
    const scenario = scene();
    for (const id of ['a', 'b', 'c'])
      scenario.apply({ type: 'monitor_create', payload: { id, label: id } });
    const query = { selector: { kind: 'monitor' as const }, limit: 1 };
    const first = queryScenario(scenario, query, location);
    expect(first.truncated).toBe(true);
    expect(
      queryScenario(scenario, { ...query, cursor: first.cursor }, location).items[0].ref,
    ).toEqual({ kind: 'monitor', id: 'b' });
    expect(() =>
      queryScenario(scenario, { ...query, cursor: first.cursor }, { ...location, revision: 2 }),
    ).toThrow(/boundary/);
    expect(ScenarioQuerySchema.safeParse({ ...query, fields: ['/constructor/name'] }).success).toBe(
      false,
    );
    expect(ScenarioQuerySchema.safeParse({ ...query, fields: ['/x~2'] }).success).toBe(false);
  });
  it('samples monitor replacement/deletion and repeated/backward time at actual recording boundaries', () => {
    const scenario = scene();
    scenario.apply({ type: 'monitor_create', payload: { id: 'm', label: 'M' } });
    const recorder = new SnapshotRecorder(scenario);
    recorder.start();
    for (const [i, time] of [4, 4, 1].entries()) {
      const updates: SimulatorToRendererMessage[] = [
        { type: 'metadata_update' as const, payload: { time } },
        { type: 'monitor_update' as const, payload: { id: 'm', value: i < 2 ? 1 : 2 } },
      ];
      for (const message of updates) {
        scenario.apply(message);
        recorder.recordMessage(message);
      }
      recorder.recordMessage({
        type: 'action_result',
        payload: { id: 'step', request_id: `r${i}` },
      });
    }
    const deletion = { type: 'monitor_delete' as const, payload: { id: 'm' } };
    scenario.apply(deletion);
    recorder.recordMessage(deletion);
    recorder.recordMessage({ type: 'action_result', payload: { id: 'step' } });
    const snapshot = recorder.stop()!;
    const history = monitorHistory(snapshot, {
      monitorId: 'm',
      from: 0,
      to: 6,
      sampling: 'changes',
    });
    expect(history.samples.map((s) => s.location.frame)).toEqual([0, 1, 3, 4]);
    expect(history.samples.map((s) => s.location.modelTime)).toEqual([undefined, 4, 1, 1]);
    expect(history.samples[3].found).toBe(false);
    expect(history.gaps).toEqual([{ from: 5, to: 6, reason: 'not-observed' }]);
    expect(
      queryRecording(createSingleSnapshot(scenario.dump()), 0, { selector: { kind: 'monitor' } })
        .count,
    ).toBe(0);
  });
});

it('selects projected cell coordinates without interpreting string item IDs', () => {
  const scenario = scene();
  const spec = {
    selector: { kind: 'cell' as const, environmentId: 'e/:', layerId: 'a/:', x: 1, y: 0 },
    fields: ['/data/score'],
  };
  const result = queryScenario(scenario, spec, location);
  expect(result).toEqual(queryScenario(scenario.dump(), spec, location));
  expect(result.items[0]).toMatchObject({ ref: { agentId: '1' }, fields: [{ value: 9 }] });
});
