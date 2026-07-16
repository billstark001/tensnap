import { describe, expect, it } from 'vitest';
import { ActionRunMetrics } from './ActionRunMetrics';

describe('ActionRunMetrics', () => {
  it('uses a sliding one-second window for runtime and simulator timings', () => {
    let now = 0;
    const metrics = new ActionRunMetrics('step', () => now);

    metrics.recordDispatch({ id: 'step', request_id: 'one' });
    now = 100;
    expect(metrics.recordCompletion({
      id: 'step',
      request_id: 'one',
      timings: { simulate_ms: 10, communicate_ms: 2 },
    })).toEqual({
      runtime: { tps: 10, mspt: 100 },
      simulator: { simulate_ms: 10, communicate_ms: 2, render_ms: undefined },
    });

    now = 400;
    metrics.recordDispatch({ id: 'step', request_id: 'two' });
    now = 500;
    expect(metrics.recordCompletion({
      id: 'step',
      request_id: 'two',
      timings: { simulate_ms: 30, communicate_ms: 6 },
    })).toEqual({
      runtime: { tps: 2.5, mspt: 100 },
      simulator: { simulate_ms: 20, communicate_ms: 4, render_ms: undefined },
    });

    now = 1_600;
    metrics.recordDispatch({ id: 'step', request_id: 'three' });
    now = 1_700;
    expect(metrics.recordCompletion({
      id: 'step',
      request_id: 'three',
      timings: { simulate_ms: 50 },
    })).toEqual({
      runtime: { tps: 10, mspt: 100 },
      simulator: { simulate_ms: 50, communicate_ms: undefined, render_ms: undefined },
    });
  });

  it('only accepts completions paired with this execution dispatch', () => {
    let now = 0;
    const metrics = new ActionRunMetrics('step', () => now);

    metrics.recordDispatch({ id: 'other', request_id: 'other-tick' });
    expect(metrics.recordCompletion({ id: 'other', request_id: 'other-tick' })).toBeNull();

    metrics.recordDispatch({ id: 'step', request_id: 'step-tick' });
    now = 20;
    expect(metrics.recordCompletion({ id: 'step', request_id: 'stale-tick' })).toBeNull();
    expect(metrics.recordCompletion({ id: 'step', request_id: 'step-tick' })).toMatchObject({
      runtime: { tps: 50, mspt: 20 },
    });
  });

  it('updates samples every tick but emits UI snapshots at most four times per second', () => {
    let now = 0;
    const metrics = new ActionRunMetrics('step', () => now);

    metrics.recordDispatch({ id: 'step', request_id: 'one' });
    now = 10;
    expect(metrics.recordCompletion({ id: 'step', request_id: 'one' })).not.toBeNull();

    metrics.recordDispatch({ id: 'step', request_id: 'two' });
    now = 20;
    expect(metrics.recordCompletion({ id: 'step', request_id: 'two' })).toBeNull();

    metrics.recordDispatch({ id: 'step', request_id: 'three' });
    now = 270;
    expect(metrics.recordCompletion({ id: 'step', request_id: 'three' })).toMatchObject({
      runtime: { tps: expect.any(Number), mspt: expect.any(Number) },
    });
  });
});
