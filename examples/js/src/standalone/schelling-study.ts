// Reusable scientific loop shared by the user CLI and publication adapter.
// The extraction prevents drift; it is not required by the JS binding.
import {
  DEFAULT_SCHELLING_CONFIG,
  SchellingModel,
  type SchellingConfig,
} from '../models/schelling';

export type SchellingStudyMode = 'steady' | 'convergence';

export interface SchellingStudyOptions {
  width: number;
  height: number;
  density: number;
  balance: number;
  thresholds: number[];
  steps: number;
  seeds: number;
  seed: number;
  mode: SchellingStudyMode;
}

export interface SchellingTrialResult {
  readonly threshold: number;
  readonly seed: number;
  readonly satisfiedPct: number;
  readonly segregationIndex: number;
  readonly stepsRun: number;
  readonly termination: 'satisfied' | 'jammed' | 'limit';
  readonly lastMoved: number;
}

export interface SchellingStudyRow {
  readonly threshold: number;
  readonly meanSatisfiedPct: number;
  readonly meanSegregationIndex: number;
  readonly meanLastMoved: number;
  readonly meanSteps: number;
  readonly satisfiedRuns: number;
  readonly jammedRuns: number;
  readonly limitRuns: number;
}

export interface SchellingStudyResult {
  readonly options: SchellingStudyOptions;
  readonly trials: readonly SchellingTrialResult[];
  readonly rows: readonly SchellingStudyRow[];
  readonly totalTicks: number;
  readonly satisfiedPct: number;
  readonly segregationIndex: number;
  readonly actualSteps: number;
}

export const DEFAULT_SCHELLING_STUDY_OPTIONS: SchellingStudyOptions = {
  width: DEFAULT_SCHELLING_CONFIG.gridWidth,
  height: DEFAULT_SCHELLING_CONFIG.gridHeight,
  density: DEFAULT_SCHELLING_CONFIG.density,
  balance: DEFAULT_SCHELLING_CONFIG.balance,
  thresholds: [0.3, 0.5, 0.7, 0.9],
  steps: 1_000,
  seeds: 8,
  seed: 7,
  mode: 'convergence',
};

function optionValues(argv: readonly string[]): Map<string, string | true> {
  const values = new Map<string, string | true>();
  const allowed = new Set([
    'width',
    'height',
    'density',
    'balance',
    'thresholds',
    'steps',
    'seeds',
    'seed',
    'mode',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const equalsAt = argument.indexOf('=');
    const name = argument.slice(2, equalsAt >= 0 ? equalsAt : undefined);
    if (!allowed.has(name)) throw new Error(`Unknown option: --${name}`);
    if (equalsAt >= 0) {
      values.set(name, argument.slice(equalsAt + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`--${name} requires a value.`);
    values.set(name, next);
    index += 1;
  }
  return values;
}

function finiteNumber(values: Map<string, string | true>, name: string, fallback: number): number {
  const raw = values.get(name);
  if (raw === undefined) return fallback;
  if (raw === true) throw new Error(`--${name} requires a number.`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a finite number.`);
  return value;
}

function positiveInteger(
  values: Map<string, string | true>,
  name: string,
  fallback: number,
): number {
  const value = finiteNumber(values, name, fallback);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`--${name} must be a positive integer.`);
  return value;
}

export function parseSchellingThresholds(value: string): number[] {
  const thresholds = value
    .split(',')
    .filter(Boolean)
    .map((item) => Number(item.trim()));
  if (
    thresholds.length === 0 ||
    thresholds.some((threshold) => !Number.isFinite(threshold) || threshold < 0 || threshold > 1)
  ) {
    throw new Error('--thresholds must contain one or more values from 0 through 1.');
  }
  return thresholds;
}

export function parseSchellingStudyOptions(
  argv: readonly string[],
  defaults: SchellingStudyOptions = DEFAULT_SCHELLING_STUDY_OPTIONS,
): SchellingStudyOptions {
  const values = optionValues(argv);
  const mode = values.get('mode') ?? defaults.mode;
  if (mode !== 'steady' && mode !== 'convergence')
    throw new Error('--mode must be steady or convergence.');
  const density = finiteNumber(values, 'density', defaults.density);
  const balance = finiteNumber(values, 'balance', defaults.balance);
  if (density < 0 || density > 1 || balance < 0 || balance > 1) {
    throw new Error('--density and --balance must be values from 0 through 1.');
  }
  const thresholdsRaw = values.get('thresholds');
  return {
    width: positiveInteger(values, 'width', defaults.width),
    height: positiveInteger(values, 'height', defaults.height),
    density,
    balance,
    thresholds:
      thresholdsRaw === undefined
        ? [...defaults.thresholds]
        : parseSchellingThresholds(thresholdsRaw as string),
    steps: positiveInteger(values, 'steps', defaults.steps),
    seeds: positiveInteger(values, 'seeds', defaults.seeds),
    seed: Math.trunc(finiteNumber(values, 'seed', defaults.seed)),
    mode,
  };
}

export function runSchellingTrial(
  config: SchellingConfig,
  steps: number,
  mode: SchellingStudyMode,
): Omit<SchellingTrialResult, 'threshold' | 'seed'> {
  const model = new SchellingModel(config);
  model.initialize();
  const { stepsRun, stopped } = advanceSchellingTrial(model, steps, mode);
  return summarizeSchellingTrial(model, stepsRun, stopped);
}

export function advanceSchellingTrial(
  model: SchellingModel,
  steps: number,
  mode: SchellingStudyMode,
) {
  for (let tick = 1; tick <= steps; tick++) {
    const moved = model.step();
    if (mode === 'convergence' && !moved) return { stepsRun: tick, stopped: true };
  }
  return { stepsRun: steps, stopped: false };
}

export function summarizeSchellingTrial(
  model: SchellingModel,
  stepsRun: number,
  stopped: boolean,
): Omit<SchellingTrialResult, 'threshold' | 'seed'> {
  const statistics = model.getStatistics();
  const allSatisfied = statistics.satisfiedCount === statistics.totalAgents;
  return {
    satisfiedPct: statistics.satisfactionRate,
    segregationIndex: statistics.segregationIndex,
    stepsRun,
    lastMoved: statistics.lastMoved,
    termination: stopped ? (allSatisfied ? 'satisfied' : 'jammed') : 'limit',
  };
}

export function runSchellingStudy(
  options: SchellingStudyOptions,
  trialRunner: typeof runSchellingTrial = runSchellingTrial,
): SchellingStudyResult {
  const baseConfig = {
    gridWidth: options.width,
    gridHeight: options.height,
    density: options.density,
    balance: options.balance,
  };
  const trials: SchellingTrialResult[] = [];
  for (const threshold of options.thresholds) {
    for (let seedOffset = 0; seedOffset < options.seeds; seedOffset += 1) {
      const seed = options.seed + seedOffset;
      trials.push({
        threshold,
        seed,
        ...trialRunner(
          { ...baseConfig, similarityThreshold: threshold, seed },
          options.steps,
          options.mode,
        ),
      });
    }
  }

  const totalTicks = trials.reduce((total, trial) => total + trial.stepsRun, 0);
  const trialCount = trials.length;
  const rows = options.thresholds.map((threshold) => {
    const selected = trials.filter((trial) => trial.threshold === threshold);
    return {
      threshold,
      meanSatisfiedPct:
        selected.reduce((total, trial) => total + trial.satisfiedPct, 0) / selected.length,
      meanSegregationIndex:
        selected.reduce((total, trial) => total + trial.segregationIndex, 0) / selected.length,
      meanLastMoved:
        selected.reduce((total, trial) => total + trial.lastMoved, 0) / selected.length,
      meanSteps: selected.reduce((total, trial) => total + trial.stepsRun, 0) / selected.length,
      satisfiedRuns: selected.filter((trial) => trial.termination === 'satisfied').length,
      jammedRuns: selected.filter((trial) => trial.termination === 'jammed').length,
      limitRuns: selected.filter((trial) => trial.termination === 'limit').length,
    };
  });
  return {
    options,
    trials,
    rows,
    totalTicks,
    satisfiedPct: trials.reduce((total, trial) => total + trial.satisfiedPct, 0) / trialCount,
    segregationIndex:
      trials.reduce((total, trial) => total + trial.segregationIndex, 0) / trialCount,
    actualSteps: totalTicks / trialCount,
  };
}

export function formatSchellingStudyCsv(result: SchellingStudyResult): string {
  const lines = [
    'threshold,mean_satisfied_pct,mean_segregation_index,mean_last_swapped,mean_steps,satisfied_runs,jammed_runs,limit_runs',
  ];
  for (const row of result.rows) {
    lines.push(
      [
        row.threshold.toFixed(2),
        row.meanSatisfiedPct.toFixed(4),
        row.meanSegregationIndex.toFixed(4),
        row.meanLastMoved.toFixed(2),
        row.meanSteps.toFixed(2),
        row.satisfiedRuns,
        row.jammedRuns,
        row.limitRuns,
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
