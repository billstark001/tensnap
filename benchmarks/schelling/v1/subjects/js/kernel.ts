// Publication-only JSON/version adapter over the example's shared study.
import {
  SCHELLING_DYNAMICS_VERSION,
} from '../../../../../examples/js/src/models/schelling';
import {
  formatSchellingStudyCsv,
  parseSchellingStudyOptions,
  runSchellingStudy,
} from '../../../../../examples/js/src/standalone/schelling-study';

if (SCHELLING_DYNAMICS_VERSION !== 1) {
  throw new Error(`Benchmark adapter expects Schelling dynamics v1, got v${SCHELLING_DYNAMICS_VERSION}.`);
}

const argv = process.argv.slice(2);
const benchmarkJson = argv.includes('--benchmark-json');
const studyArgs: string[] = [];
for (let index = 0; index < argv.length; index += 1) {
  const argument = argv[index]!;
  if (argument === '--benchmark-json') continue;
  if (argument === '--instrumentation') {
    const value = argv[++index];
    if (value !== 'none') throw new Error('--instrumentation must be none for the JavaScript kernel.');
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
const result = runSchellingStudy(options);

process.stdout.write(formatSchellingStudyCsv(result));
if (benchmarkJson) {
  const valid = Number.isFinite(result.elapsedMs)
    && result.satisfiedPct >= 0 && result.satisfiedPct <= 1
    && result.segregationIndex >= 0 && result.segregationIndex <= 1
    && result.trials.every((trial) => trial.lastMoved >= 0 && trial.lastMoved <= options.width * options.height)
    && result.actualSteps >= 1 && result.actualSteps <= options.steps;
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    timingsMs: [result.elapsedMs],
    metrics: {
      totalTicks: result.totalTicks,
      elapsedMs: result.elapsedMs,
      msPerTick: result.msPerTick,
    },
    state: {
      mode: options.mode,
      instrumentation: 'none',
      satisfiedPct: result.satisfiedPct,
      segregationIndex: result.segregationIndex,
      lastSwapped: result.trials.reduce((total, trial) => total + trial.lastMoved, 0) / result.trials.length,
      actualSteps: result.actualSteps,
    },
    correctness: { valid, actionCount: 1 },
    runtime: { node: process.version, v8: process.versions.v8 },
  })}\n`);
}
