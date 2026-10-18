// @vitest-environment node
import { it, expect } from 'vitest';
import { Scenario } from '../scenario';
import { diffCapturedFrames } from './diff';
import type { CapturedFrame } from './CapturedFrame';
function frame(): CapturedFrame {
  const scenario = new Scenario();
  scenario.apply({ type: 'monitor_create', payload: { id: 'diagnostic', label: 'Diagnostic' } });
  scenario.apply({
    type: 'monitor_update',
    payload: { id: 'diagnostic', value: { replayed_calls: 1, score: 100 } },
  });
  return {
    id: 'f',
    capturedAt: 0,
    scene: scenario.dump(),
    source: { kind: 'live' },
    consistency: 'aligned',
    checkpointStatus: 'captured',
    checkpoint: { encoding: 'raw', data: 'AQ==', model_id: 'm' },
    modelIdentity: { model_id: 'm' },
  };
}
it('reports exact diagnostics separately from selected equality and opaque checkpoint bytes', () => {
  const a = frame(),
    b = frame();
  b.scene.monitors[0].value = { replayed_calls: 2, score: 100.1 };
  b.checkpoint!.data = Uint8Array.of(1);
  expect(diffCapturedFrames(a, b)).toMatchObject({
    exactSceneEqual: false,
    selectedEqual: false,
    checkpointEqual: true,
  });
  const result = diffCapturedFrames(a, b, {
    ignore: ['/monitors/diagnostic/value/replayed_calls'],
    relativeTolerance: 0.001,
  });
  expect(result).toMatchObject({
    exactSceneEqual: false,
    selectedEqual: true,
    checkpointEqual: true,
    changeCount: 2,
  });
  expect(result.changes.some((c) => c.ignored)).toBe(true);
  b.modelIdentity!.state_schema_version = 'different';
  expect(diffCapturedFrames(a, b, result.policy).selectedEqual).toBe(false);
  expect(() => diffCapturedFrames(a, b, { absoluteTolerance: -1 })).toThrow();
});
it('matches typed entities while preserving ordinary array order and reports incomplete enumeration', () => {
  const a = frame(),
    b = frame();
  a.scene.monitors[0].value = [1, 2];
  b.scene.monitors[0].value = [2, 1];
  const result = diffCapturedFrames(a, b, {}, { limit: 1 });
  expect(result).toMatchObject({
    selectedEqual: false,
    complete: false,
    continuation: 1,
    changeCount: 2,
  });
  expect(diffCapturedFrames(a, b, {}, { offset: 1 }).changes).toHaveLength(1);
});

it('selects explicit typed objects without hiding the remaining exact changes', () => {
  const a = frame(),
    b = frame();
  a.scene.metadata.time = 1;
  b.scene.metadata.time = 2;
  expect(
    diffCapturedFrames(a, b, { objects: [{ kind: 'monitor', id: 'diagnostic' }] }),
  ).toMatchObject({
    exactSceneEqual: false,
    selectedEqual: true,
    changeCount: 1,
    selectedChangeCount: 0,
  });
  b.checkpoint!.data = Uint8Array.of(2);
  expect(
    diffCapturedFrames(a, b, { objects: [{ kind: 'monitor', id: 'diagnostic' }] }).selectedEqual,
  ).toBe(false);
});
