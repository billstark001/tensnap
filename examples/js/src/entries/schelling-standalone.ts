import { SchellingModel, type SchellingConfig } from '../models/schelling';

type Mode = 'steady' | 'convergence';

interface TrialResult {
  readonly elapsedMs: number;
  readonly satisfiedPct: number;
  readonly segregationIndex: number;
  readonly stepsRun: number;
}

interface Options {
  width: number;
  height: number;
  density: number;
  balance: number;
  thresholds: number[];
  warmupSteps: number;
  steps: number;
  seeds: number;
  seed: number;
  mode: Mode;
  benchmarkJson: boolean;
}

function optionValues(argv: readonly string[]): Map<string, string | true> {
  const values = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const equalsAt = argument.indexOf('=');
    if (equalsAt >= 0) {
      values.set(argument.slice(2, equalsAt), argument.slice(equalsAt + 1));
      continue;
    }
    const name = argument.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      values.set(name, next);
      index += 1;
    } else {
      values.set(name, true);
    }
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

function positiveInteger(values: Map<string, string | true>, name: string, fallback: number): number {
  const value = finiteNumber(values, name, fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`--${name} must be a positive integer.`);
  return value;
}

function parseThresholds(values: Map<string, string | true>): number[] {
  const raw = values.get('thresholds') ?? '0.30,0.50,0.70,0.90';
  if (raw === true) throw new Error('--thresholds requires comma-separated values.');
  const thresholds = raw.split(',').filter(Boolean).map((value) => Number(value.trim()));
  if (thresholds.length === 0 || thresholds.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error('--thresholds must contain one or more values from 0 through 1.');
  }
  return thresholds;
}

function parseOptions(argv: readonly string[]): Options {
  const values = optionValues(argv);
  const mode = values.get('mode') ?? 'convergence';
  if (mode !== 'steady' && mode !== 'convergence') throw new Error('--mode must be steady or convergence.');
  const benchmarkJsonOption = values.get('benchmark-json');
  if (benchmarkJsonOption !== undefined && benchmarkJsonOption !== true) {
    throw new Error('--benchmark-json does not accept a value.');
  }
  const warmupSteps = finiteNumber(values, 'warmup-steps', 0);
  if (!Number.isInteger(warmupSteps) || warmupSteps < 0) throw new Error('--warmup-steps must be a non-negative integer.');
  return {
    width: positiveInteger(values, 'width', 50),
    height: positiveInteger(values, 'height', 50),
    density: finiteNumber(values, 'density', 0.8),
    balance: finiteNumber(values, 'balance', 0.5),
    thresholds: parseThresholds(values),
    warmupSteps,
    steps: positiveInteger(values, 'steps', 1000),
    seeds: positiveInteger(values, 'seeds', 8),
    seed: Math.trunc(finiteNumber(values, 'seed', 7)),
    mode,
    benchmarkJson: benchmarkJsonOption === true,
  };
}

function runTrial(config: SchellingConfig, steps: number, mode: Mode): TrialResult {
  const model = new SchellingModel(config);
  model.initialize();
  const started = process.hrtime.bigint();
  let stepsRun = 0;
  for (let step = 0; step < steps; step += 1) {
    stepsRun += 1;
    const moved = model.step();
    if (mode === 'convergence' && !moved) break;
  }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  const statistics = model.getStatistics();
  return {
    elapsedMs,
    satisfiedPct: statistics.satisfactionRate,
    segregationIndex: statistics.segregationIndex,
    stepsRun,
  };
}

function main(argv: readonly string[]): void {
  const options = parseOptions(argv);
  if (options.density < 0 || options.density > 1 || options.balance < 0 || options.balance > 1) {
    throw new Error('--density and --balance must be values from 0 through 1.');
  }

  const baseConfig = {
    gridWidth: options.width,
    gridHeight: options.height,
    density: options.density,
    balance: options.balance,
  };
  if (options.warmupSteps > 0) {
    runTrial({ ...baseConfig, similarityThreshold: options.thresholds[0]!, seed: options.seed }, options.warmupSteps, 'steady');
  }

  let elapsedMs = 0;
  let totalTicks = 0;
  let satisfiedTotal = 0;
  let segregationTotal = 0;
  for (const threshold of options.thresholds) {
    for (let seedOffset = 0; seedOffset < options.seeds; seedOffset += 1) {
      const result = runTrial({ ...baseConfig, similarityThreshold: threshold, seed: options.seed + seedOffset }, options.steps, options.mode);
      elapsedMs += result.elapsedMs;
      totalTicks += result.stepsRun;
      satisfiedTotal += result.satisfiedPct;
      segregationTotal += result.segregationIndex;
    }
  }

  const trialCount = options.thresholds.length * options.seeds;
  const actualSteps = totalTicks / trialCount;
  const satisfiedPct = satisfiedTotal / trialCount;
  const segregationIndex = segregationTotal / trialCount;
  const msPerTick = totalTicks === 0 ? 0 : elapsedMs / totalTicks;
  const valid = Number.isFinite(elapsedMs)
    && satisfiedPct >= 0 && satisfiedPct <= 1
    && segregationIndex >= 0 && segregationIndex <= 1
    && actualSteps >= 1 && actualSteps <= options.steps;

  if (options.benchmarkJson) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      timingsMs: [elapsedMs],
      metrics: { totalTicks, elapsedMs, msPerTick },
      state: { mode: options.mode, instrumentation: 'none', satisfiedPct, segregationIndex, actualSteps },
      correctness: { valid, actionCount: 1 },
      runtime: { node: process.version, v8: process.versions.v8 },
    })}\n`);
    return;
  }

  process.stdout.write(`total_ticks,elapsed_ms,mspt\n${totalTicks},${elapsedMs.toFixed(3)},${msPerTick.toFixed(6)}\n`);
}

main(process.argv.slice(2));
