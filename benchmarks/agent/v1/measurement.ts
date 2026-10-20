import assert from 'node:assert/strict';
import type { RunStatus } from '../../../packages/core/src/runtime';
import type { AgentBenchmarkConfig } from './benchmark';

export type RunObservation = Pick<
  RunStatus,
  | 'dispatchedActions'
  | 'completedActions'
  | 'succeededActions'
  | 'failedActions'
  | 'settled'
  | 'stateKnown'
  | 'stopReason'
  | 'primaryFailure'
  | 'startedAt'
  | 'settledAt'
>;
export interface ActionObservation {
  actionId: string;
  status: string;
  settled: boolean;
  stateKnown: boolean;
  elapsedMs: number;
}
export type Measurement =
  | { kind: 'single'; actions: ActionObservation[]; transactionsMs: number[] }
  | { kind: 'bounded'; run: RunObservation; transactionsMs: number[]; recordingStatus?: string }
  | { kind: 'query'; responses: { elapsedMs: number; bytes: number }[] };

export function observeRun(run: RunStatus): RunObservation {
  return {
    dispatchedActions: run.dispatchedActions,
    completedActions: run.completedActions,
    succeededActions: run.succeededActions,
    failedActions: run.failedActions,
    settled: run.settled,
    stateKnown: run.stateKnown,
    stopReason: run.stopReason,
    primaryFailure: run.primaryFailure,
    startedAt: run.startedAt,
    settledAt: run.settledAt,
  };
}
export function assertRun(run: RunObservation, steps: number): void {
  assert.equal(run.settled, true);
  assert.equal(run.stateKnown, true);
  assert.equal(run.failedActions, 0);
  assert.equal(run.dispatchedActions, steps);
  assert.equal(run.succeededActions, steps);
  assert.equal(run.completedActions, steps);
  assert.equal(run.stopReason, 'max-steps');
  assert.equal(run.primaryFailure, undefined);
  assert.ok(
    Number.isFinite(run.startedAt) &&
      Number.isFinite(run.settledAt) &&
      run.settledAt! >= run.startedAt,
    'Invalid runtime completion timestamps.',
  );
}
export function validateMeasurement(
  config: AgentBenchmarkConfig,
  input: unknown,
  timings: readonly number[],
  stages: Readonly<Record<string, readonly number[]>>,
  metrics: Readonly<Record<string, readonly number[]>>,
): void {
  assert.ok(input && typeof input === 'object', 'Missing measurement boundary evidence.');
  const evidence = input as Measurement;
  for (const [name, values] of Object.entries(stages))
    assert.ok(
      values.length > 0 && values.every((n) => Number.isFinite(n) && n >= 0),
      `Invalid stage ${name}`,
    );
  if (config.case === 'query') {
    assert.equal(evidence.kind, 'query');
    const responses = (evidence as Extract<Measurement, { kind: 'query' }>).responses;
    assert.equal(responses?.length, timings.length);
    assert.deepEqual(
      responses.map((r) => r.elapsedMs),
      timings,
    );
    assert.deepEqual(
      responses.map((r) => r.bytes),
      metrics.responseBytes,
    );
    assert.ok(
      responses.every((r) => Number.isSafeInteger(r.bytes) && r.bytes > 0),
      'Invalid response bytes.',
    );
    assert.deepEqual(Object.keys(stages), []);
    return;
  }
  assert.equal(
    evidence.kind,
    config.case === 'control' && config.control === 'cli-single' ? 'single' : 'bounded',
  );
  const work = evidence as Exclude<Measurement, { kind: 'query' }>;
  assert.ok(
    Array.isArray(work.transactionsMs) &&
      work.transactionsMs.length > 0 &&
      work.transactionsMs.every((n) => Number.isFinite(n) && n > 0),
    'Invalid measured transactions.',
  );
  assert.ok(
    work.transactionsMs.reduce((a, b) => a + b, 0) <= timings[0]! + 1e-7,
    'Transactions exceed the measured workflow.',
  );
  if (work.kind === 'single') {
    assert.equal(work.actions.length, config.steps);
    for (const action of work.actions)
      assert.deepEqual(
        {
          actionId: action.actionId,
          status: action.status,
          settled: action.settled,
          stateKnown: action.stateKnown,
        },
        { actionId: 'step', status: 'succeeded', settled: true, stateKnown: true },
      );
    assert.deepEqual(
      work.actions.map((a) => a.elapsedMs),
      stages.actionCliMs,
    );
    assert.deepEqual(work.transactionsMs, stages.actionCliMs);
    assert.deepEqual(Object.keys(stages), ['actionCliMs']);
  } else {
    assertRun(work.run, config.steps);
    const duration = work.run.settledAt! - work.run.startedAt;
    assert.deepEqual(stages.runtimeSettledMs, [duration]);
    assert.ok(duration <= timings[0]! + 1e-7, 'Runtime duration exceeds the measured workflow.');
    if (config.case === 'collection') {
      assert.deepEqual(stages.completionOverheadMs, [timings[0]! - duration]);
      const archive = config.collection === 'archive';
      assert.equal(work.transactionsMs.length, archive ? 3 : 1);
      if (archive) assert.deepEqual(stages.recordingSetupCliMs, [work.transactionsMs[0]!]);
      assert.equal(work.recordingStatus, config.collection === 'none' ? undefined : 'persisted');
      assert.deepEqual(
        Object.keys(stages).sort(),
        [
          'runtimeSettledMs',
          'completionOverheadMs',
          ...(archive ? ['recordingSetupCliMs'] : []),
        ].sort(),
      );
    } else {
      assert.equal(work.transactionsMs.length, config.control === 'http-batch' ? 2 : 1);
      assert.deepEqual(Object.keys(stages), ['runtimeSettledMs']);
    }
  }
}
