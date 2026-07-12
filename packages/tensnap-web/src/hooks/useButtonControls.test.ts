import { describe, expect, it } from 'vitest';
import type { RunStatus } from '@tensnap/core/runtime';
import { isActionVisiblyRunning } from './useButtonControls';

const runningStatus = (pauseRequested: boolean): RunStatus => ({
  id: 'run-1',
  spec: { mode: 'manual', actionId: 'start' },
  state: 'running',
  completedSteps: 2,
  startedAt: 0,
  pauseRequested,
  inFlight: true,
});

describe('isActionVisiblyRunning', () => {
  it('stops showing the pause state immediately after pause is requested', () => {
    expect(isActionVisiblyRunning(runningStatus(false), 'start')).toBe(true);
    expect(isActionVisiblyRunning(runningStatus(true), 'start')).toBe(false);
  });
});
