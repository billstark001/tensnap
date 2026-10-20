import type { runSchellingTrial } from '../../../../../examples/js/src/standalone/schelling-study';
// Publication-only JSON/version adapter over the example's shared study.
import {
  SCHELLING_DYNAMICS_VERSION,
  SchellingModel,
} from '../../../../../examples/js/src/models/schelling';
import {
  formatSchellingStudyCsv,
  parseSchellingStudyOptions,
  runSchellingStudy,
  advanceSchellingTrial,
  summarizeSchellingTrial,
} from '../../../../../examples/js/src/standalone/schelling-study';

if (SCHELLING_DYNAMICS_VERSION !== 1) {
  throw new Error(
    `Benchmark adapter expects Schelling dynamics v1, got v${SCHELLING_DYNAMICS_VERSION}.`,
  );
}

const argv = process.argv.slice(2);
const benchmarkJson = argv.includes('--benchmark-json');
const studyArgs: string[] = [];
let warmupSteps = 0;
for (let index = 0; index < argv.length; index += 1) {
  const argument = argv[index]!;
  if (argument === '--benchmark-json') continue;
  if (argument === '--warmup-steps' || argument.startsWith('--warmup-steps=')) {
    warmupSteps = Number(argument.includes('=') ? argument.split('=')[1] : argv[++index]);
    if (!Number.isInteger(warmupSteps) || warmupSteps < 0)
      throw new Error('warmup steps must be nonnegative');
    continue;
  }
  if (argument === '--instrumentation') {
    const value = argv[++index];
    if (value !== 'none')
      throw new Error('--instrumentation must be none for the JavaScript kernel.');
    continue;
  }
  if (argument.startsWith('--instrumentation=')) {
    if (argument.slice('--instrumentation='.length) !== 'none') {
      throw new Error('--instrumentation must be none for the JavaScript kernel.');
    }
    continue;
  }
  studyArgs.push(argument);
}
const options = parseSchellingStudyOptions(studyArgs);
let elapsedMs = 0;
const measuredTrial: typeof runSchellingTrial = (config, steps, mode) => {
  const model = new SchellingModel(config);
  model.initialize();
  const started = performance.now();
  const { stepsRun, stopped } = advanceSchellingTrial(model, steps, mode);
  elapsedMs += performance.now() - started;
  return summarizeSchellingTrial(model, stepsRun, stopped);
};
if (warmupSteps) {
  measuredTrial(
    {
      gridWidth: options.width,
      gridHeight: options.height,
      density: options.density,
      balance: options.balance,
      similarityThreshold: options.thresholds[0]!,
      seed: options.seed,
    },
    warmupSteps,
    'steady',
  );
  elapsedMs = 0;
}
const result = runSchellingStudy(options, measuredTrial);
const msPerTick = result.totalTicks ? elapsedMs / result.totalTicks : 0;

process.stdout.write(formatSchellingStudyCsv(result));
console.log('performance_metric,total_ticks,elapsed_ms,tpms,mspt');
console.log(
  `performance,${result.totalTicks},${elapsedMs.toFixed(3)},${(elapsedMs ? result.totalTicks / elapsedMs : 0).toFixed(6)},${msPerTick.toFixed(6)}`,
);
if (benchmarkJson) {
  const valid =
    Number.isFinite(elapsedMs) &&
    result.satisfiedPct >= 0 &&
    result.satisfiedPct <= 1 &&
    result.segregationIndex >= 0 &&
    result.segregationIndex <= 1 &&
    result.trials.every(
      (trial) => trial.lastMoved >= 0 && trial.lastMoved <= options.width * options.height,
    ) &&
    result.actualSteps >= 1 &&
    result.actualSteps <= options.steps;
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      timingsMs: [elapsedMs],
      metrics: {
        totalTicks: result.totalTicks,
        elapsedMs: elapsedMs,
        msPerTick: msPerTick,
      },
      state: {
        mode: options.mode,
        instrumentation: 'none',
        satisfiedPct: result.satisfiedPct,
        segregationIndex: result.segregationIndex,
        lastSwapped:
          result.trials.reduce((total, trial) => total + trial.lastMoved, 0) / result.trials.length,
        actualSteps: result.actualSteps,
      },
      correctness: { valid, actionCount: 1 },
      runtime: { node: process.version, v8: process.versions.v8 },
    })}\n`,
  );
}
