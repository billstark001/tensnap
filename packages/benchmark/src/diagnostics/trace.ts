import type { BrowserBenchmarkStats } from '../browser-types';
import type { TimeoutBrowserTrace } from './browser-probe';

type Stage = 'model' | 'collection' | 'projection' | 'charts' | 'flush';
export interface ServerActionTrace {
  requestId: string;
  receivedMs: number;
  finishedMs: number;
  receivedCpuMs: number;
  finishedCpuMs: number;
  model: [number, number][];
  collection: [number, number][];
  projection: [number, number][];
  charts: [number, number][];
  flush: [number, number][];
  gc?: { durationMs: number; cpuMs: number; generation: number }[];
  resources: Record<string, number>;
}
export interface ServerTrace {
  python: string;
  platform: string;
  pid: number;
  actions: ServerActionTrace[];
}

function duration(start: number, end: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    throw new Error('Invalid diagnostic timestamp interval.');
  return end - start;
}
function distribution(values: number[]) {
  if (!values.length || values.some((value) => !Number.isFinite(value)))
    throw new Error('Missing or non-finite diagnostic series.');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >>> 1;
  return {
    count: sorted.length,
    medianMs: sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
    meanMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    maxMs: sorted[sorted.length - 1]!,
  };
}

/** Join by request ID, never by the clocks' unrelated absolute timestamps. */
export function summarizeTimeoutTrace(
  stats: BrowserBenchmarkStats,
  browser: TimeoutBrowserTrace,
  server: ServerTrace,
  warmupActions: number,
) {
  const fullActions = stats.diagnostics?.actions;
  if (
    !fullActions ||
    !Number.isSafeInteger(warmupActions) ||
    warmupActions < 0 ||
    fullActions.length !== stats.completedFrames ||
    stats.completedFrames !== warmupActions + stats.measuredFrames ||
    stats.measuredFrames < 1 ||
    stats.timings.length !== stats.measuredFrames
  )
    throw new Error('Missing browser action trace or inconsistent action counts.');
  const browserIds = new Set(fullActions.map((action) => action.requestId));
  if (browserIds.size !== fullActions.length) throw new Error('Duplicate browser request ID.');
  const serverById = new Map(server.actions.map((action) => [action.requestId, action]));
  if (serverById.size !== server.actions.length) throw new Error('Duplicate server request ID.');
  for (const action of fullActions) {
    if (
      !action.requestId ||
      !serverById.has(action.requestId) ||
      action.resultAppliedMs === undefined
    )
      throw new Error(`Incomplete trace for ${action.requestId}.`);
    duration(action.dispatchMs, action.resultAppliedMs);
    duration(action.resultAppliedMs, action.completedMs);
  }
  if (server.actions.length !== fullActions.length)
    throw new Error('Unmatched server action trace.');
  const actions = fullActions.slice(warmupActions);
  const pairs = actions.map((action, index) => {
    if (duration(action.dispatchMs, action.completedMs) !== stats.timings[index])
      throw new Error('Cycle timings differ from action trace.');
    return { browser: action, server: serverById.get(action.requestId)! };
  });
  const stage = (name: Stage) =>
    distribution(
      pairs.map(({ server: action }) => {
        const intervals = action[name];
        if (!Array.isArray(intervals) || !intervals.length)
          throw new Error(`Missing ${name} stage trace.`);
        return intervals.reduce((total, interval) => {
          if (interval.length !== 2) throw new Error(`Invalid ${name} stage trace.`);
          return total + duration(interval[0], interval[1]);
        }, 0);
      }),
    );
  const resourceNames = Object.keys(pairs[0]!.server.resources).sort();
  if (!resourceNames.length) throw new Error('Missing resource counters.');
  for (const { server: action } of pairs) {
    if (
      Object.keys(action.resources).sort().join(',') !== resourceNames.join(',') ||
      Object.values(action.resources).some((value) => !Number.isFinite(value) || value < 0)
    )
      throw new Error('Incomplete resource counters.');
  }
  const gc = pairs.flatMap(({ server: action }) => action.gc ?? []);
  if (gc.some((entry) => !Number.isFinite(entry.durationMs) || entry.durationMs < 0))
    throw new Error('Invalid GC duration.');
  return {
    cycle: distribution(stats.timings),
    roundTrip: distribution(
      actions.map((action) => duration(action.dispatchMs, action.resultAppliedMs!)),
    ),
    postResult: distribution(
      actions.map((action) => duration(action.resultAppliedMs!, action.completedMs)),
    ),
    requestedOneMsTimers: distribution(
      browser.timers
        .filter(
          (timer) =>
            timer.delayMs === 1 &&
            timer.scheduledMs >= actions[0]!.dispatchMs &&
            timer.scheduledMs <= actions[actions.length - 1]!.completedMs &&
            timer.firedMs !== undefined &&
            timer.firedMs <= actions[actions.length - 1]!.completedMs,
        )
        .map((timer) => duration(timer.scheduledMs, timer.firedMs!)),
    ),
    serverWall: distribution(
      pairs.map(({ server: action }) => duration(action.receivedMs, action.finishedMs)),
    ),
    serverThreadCpu: distribution(
      pairs.map(({ server: action }) => duration(action.receivedCpuMs, action.finishedCpuMs)),
    ),
    // Server finish may follow response delivery. This is not wire latency.
    serverWallMinusThreadCpu: distribution(
      pairs.map(
        ({ server: action }) =>
          duration(action.receivedMs, action.finishedMs) -
          duration(action.receivedCpuMs, action.finishedCpuMs),
      ),
    ),
    stages: {
      model: stage('model'),
      collection: stage('collection'),
      projection: stage('projection'),
      charts: stage('charts'),
      flush: stage('flush'),
    },
    gcWallMs: gc.reduce((sum, entry) => sum + entry.durationMs, 0),
    resourceDeltas: Object.fromEntries(
      resourceNames.map((name) => [
        name,
        pairs.reduce((sum, pair) => sum + pair.server.resources[name]!, 0),
      ]),
    ),
    cyclesAtLeast25Ms: stats.timings.filter((value) => value >= 25).length,
  };
}
