import { expect, it } from 'vitest';
import type { BrowserBenchmarkStats } from '../browser-types';
import type { TimeoutBrowserTrace } from './browser-probe';
import { summarizeTimeoutTrace, type ServerTrace, type ServerActionTrace } from './trace';

const stats = {
  timings: [12, 32],
  measuredFrames: 2,
  completedFrames: 3,
  diagnostics: {
    actions: [
      { requestId: 'warmup', dispatchMs: 0, resultAppliedMs: 2, completedMs: 5 },
      { requestId: 'fast', dispatchMs: 10, resultAppliedMs: 20, completedMs: 22 },
      { requestId: 'slow', dispatchMs: 22, resultAppliedMs: 52, completedMs: 54 },
    ],
    rafTimestampsMs: [],
  },
} as unknown as BrowserBenchmarkStats;
const browser: TimeoutBrowserTrace = {
  timers: [
    { scheduledMs: 2, firedMs: 5, delayMs: 1 },
    { scheduledMs: 20.1, firedMs: 22, delayMs: 1 },
    { scheduledMs: 52.1, firedMs: 54, delayMs: 1 },
    { scheduledMs: 100, firedMs: 1000, delayMs: 1 },
  ],
  messages: [],
  visibility: [],
  longTasks: [],
};
const server: ServerTrace = {
  python: 'fixture',
  platform: 'fixture',
  pid: 1,
  actions: [
    {
      requestId: 'slow',
      receivedMs: 20000,
      finishedMs: 20028,
      receivedCpuMs: 200,
      finishedCpuMs: 210,
      resources: { ru_majflt: 2 },
      gc: [{ durationMs: 1, cpuMs: 1, generation: 2 }],
    },
    {
      requestId: 'warmup',
      receivedMs: 0,
      finishedMs: 1,
      receivedCpuMs: 0,
      finishedCpuMs: 1,
      resources: { ru_majflt: 100 },
    },
    {
      requestId: 'fast',
      receivedMs: 10000,
      finishedMs: 10008,
      receivedCpuMs: 100,
      finishedCpuMs: 106,
      resources: { ru_majflt: 0 },
    },
  ].map(
    (action) =>
      ({
        ...action,
        model: [[0, 1]],
        collection: [[0, 1]],
        projection: [[0, 1]],
        charts: [[0, 1]],
        flush: [[0, 1]],
      }) as ServerActionTrace,
  ),
};

it('joins unrelated clock domains by request ID and separates CPU, waiting and GC', () => {
  const summary = summarizeTimeoutTrace(stats, browser, server, 1);
  expect(summary.cycle.meanMs).toBe(22);
  expect(summary.serverWall.medianMs).toBe(18);
  expect(summary.serverThreadCpu.medianMs).toBe(8);
  expect(summary.serverWallMinusThreadCpu.medianMs).toBe(10);
  expect(summary.requestedOneMsTimers.medianMs).toBeCloseTo(1.9);
  expect(summary.gcWallMs).toBe(1);
  expect(summary.resourceDeltas.ru_majflt).toBe(2);
  expect(summary.cyclesAtLeast25Ms).toBe(1);
});

it('rejects incomplete or duplicate correlations instead of silently dropping actions', () => {
  expect(() =>
    summarizeTimeoutTrace(stats, browser, { ...server, actions: server.actions.slice(1) }, 1),
  ).toThrow('Incomplete trace');
  expect(() =>
    summarizeTimeoutTrace(
      stats,
      browser,
      { ...server, actions: [...server.actions, server.actions[0]!] },
      1,
    ),
  ).toThrow('Duplicate server request');
  expect(() =>
    summarizeTimeoutTrace({ ...stats, diagnostics: undefined }, browser, server, 1),
  ).toThrow('Missing browser action');
});

it('rejects missing stages, duplicate browser IDs, count mismatches and corrupted timings', () => {
  const copy = () => structuredClone(server);
  const missingStage = copy();
  delete (missingStage.actions[0] as Partial<ServerActionTrace>).model;
  expect(() => summarizeTimeoutTrace(stats, browser, missingStage, 1)).toThrow(
    'Missing model stage',
  );
  const duplicate = structuredClone(stats);
  duplicate.diagnostics!.actions[2]!.requestId = 'fast';
  expect(() => summarizeTimeoutTrace(duplicate, browser, server, 1)).toThrow(
    'Duplicate browser request',
  );
  expect(() =>
    summarizeTimeoutTrace({ ...stats, completedFrames: 99 }, browser, server, 1),
  ).toThrow('action counts');
  expect(() => summarizeTimeoutTrace({ ...stats, timings: [1, 2] }, browser, server, 1)).toThrow(
    'Cycle timings differ',
  );
  const incomplete = copy();
  incomplete.actions[0]!.resources = {};
  expect(() => summarizeTimeoutTrace(stats, browser, incomplete, 1)).toThrow('resource counters');
});
