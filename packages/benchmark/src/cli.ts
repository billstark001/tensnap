import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  loadProfileWorkloads,
  appendBenchmarkJournalSample,
  assertArtifactOutputAvailable,
  assertJournalCompatible,
  createBenchmarkJournalHeader,
  initializeBenchmarkJournal,
  isArtifactComplete,
  mergeBenchmarkJournalSamples,
  readBenchmarkJournal,
  renderReport,
  runProfile,
  validateProfile,
  verifyArtifactFiles,
  verifyArtifactSourceFiles,
  writeAnalysisFiles,
  writeArtifact,
} from './node/runner';
import type { BenchmarkArtifact, BenchmarkSuite } from './harness/types';

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(name);
}

function suites(value: string | undefined, fallback: readonly BenchmarkSuite[]): BenchmarkSuite[] {
  if (!value) return [...fallback];
  const parsed = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (parsed.length === 0 || parsed.some((entry) => !['node', 'ws', 'browser'].includes(entry))) {
    throw new Error('--suite accepts a comma-separated subset of node,ws,browser.');
  }
  return parsed as BenchmarkSuite[];
}

function defaultOutputDirectory(repositoryRoot: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(repositoryRoot, 'benchmark-results', timestamp);
}

function selectedBlocks(args: readonly string[], repetitions: number): { blocks?: number[]; suffix: string } {
  const blockInput = option(args, '--block');
  const shardInput = option(args, '--shard');
  if (blockInput && shardInput) throw new Error('--block and --shard are mutually exclusive.');
  if (blockInput) {
    const oneBased = blockInput.split(',').map((value) => Number(value.trim()));
    if (oneBased.length === 0 || oneBased.some((value) => !Number.isInteger(value) || value < 1 || value > repetitions)) {
      throw new Error(`--block accepts comma-separated values from 1 through ${repetitions}.`);
    }
    return { blocks: oneBased.map((value) => value - 1), suffix: `.blocks-${oneBased.join('-')}` };
  }
  if (shardInput) {
    const match = /^(\d+)\/(\d+)$/.exec(shardInput);
    if (!match) throw new Error('--shard must use one-based INDEX/COUNT syntax, for example 1/4.');
    const index = Number(match[1]);
    const count = Number(match[2]);
    if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 1 || index > count) throw new Error('--shard INDEX must be from 1 through COUNT.');
    return {
      blocks: Array.from({ length: repetitions }, (_, block) => block).filter((block) => block % count === index - 1),
      suffix: `.shard-${index}-of-${count}`,
    };
  }
  return { suffix: '' };
}

async function findRepositoryRoot(start: string): Promise<string> {
  let directory = path.resolve(start);
  while (true) {
    try {
      await access(path.join(directory, 'pnpm-workspace.yaml'));
      return directory;
    } catch {
      const parent = path.dirname(directory);
      if (parent === directory) throw new Error('Could not locate the TenSnap workspace root.');
      directory = parent;
    }
  }
}

async function readArtifact(input: string): Promise<BenchmarkArtifact> {
  const manifest = input.endsWith('.json') ? input : path.join(input, 'manifest.json');
  return JSON.parse(await readFile(manifest, 'utf8')) as BenchmarkArtifact;
}

function usage(): string {
  return `TenSnap reproducible benchmark harness

Usage:
  pnpm bench run --profile benchmarks/profiles/smoke.json [--suite node,ws] [--out benchmark-results/run]
  pnpm bench run --profile benchmarks/profiles/paper-v0.3.json --out benchmark-results/paper --shard 1/4
  pnpm bench run --profile benchmarks/profiles/paper-v0.3.json --out benchmark-results/paper --shard 1/4 --resume
  pnpm bench merge --profile benchmarks/profiles/paper-v0.3.json --input shard-1.jsonl,shard-2.jsonl --out benchmark-results/paper
  pnpm bench run --profile benchmarks/profiles/browser-all-v0.3.json
  pnpm bench report --input benchmark-results/run
  pnpm bench verify --input benchmark-results/run
  pnpm bench analyze --input benchmark-results/run

Install the pinned browser before a profile containing the browser suite:
  pnpm bench:browser:install
`;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const repositoryRoot = await findRepositoryRoot(process.cwd());
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(usage());
    return;
  }
  if (command === 'run') {
    const profileInput = option(args, '--profile');
    if (!profileInput) throw new Error('run requires --profile.');
    const profilePath = path.resolve(repositoryRoot, profileInput);
    const profile = validateProfile(JSON.parse(await readFile(profilePath, 'utf8')));
    const selectedSuites = suites(option(args, '--suite'), profile.suites);
    for (const suite of selectedSuites) {
      if (!profile.suites.includes(suite)) throw new Error(`${suite} is not enabled by profile ${profile.id}.`);
    }
    if (profile.requireCleanGit && stableSuites(selectedSuites) !== stableSuites(profile.suites)) {
      throw new Error(`Submission profile ${profile.id} must run its complete suite matrix.`);
    }
    const workloads = await loadProfileWorkloads(profilePath, profile);
    const outputDirectory = path.resolve(repositoryRoot, option(args, '--out') ?? defaultOutputDirectory(repositoryRoot));
    // Fail before creating a journal or running any replicate. The final
    // write repeats this check to preserve immutability across races.
    await assertArtifactOutputAvailable(outputDirectory);
    const blockPlan = selectedBlocks(args, profile.repetitions);
    const journalPath = path.resolve(repositoryRoot, option(args, '--journal') ?? `${outputDirectory}${blockPlan.suffix}.journal.jsonl`);
    const runOptions = { repositoryRoot, profile, workloads, suites: selectedSuites } as const;
    const expectedHeader = await createBenchmarkJournalHeader(runOptions);
    let existingReplicates = [] as Awaited<ReturnType<typeof readBenchmarkJournal>>['samples'];
    if (hasFlag(args, '--resume')) {
      const journal = await readBenchmarkJournal(journalPath);
      assertJournalCompatible(expectedHeader, journal.header);
      existingReplicates = journal.samples;
    } else {
      await initializeBenchmarkJournal(journalPath, expectedHeader);
    }
    const artifact = await runProfile({
      ...runOptions,
      ...(blockPlan.blocks ? { blocks: blockPlan.blocks } : {}),
      existingReplicates,
      artifactContext: expectedHeader.artifactContext,
      onReplicate: (record) => appendBenchmarkJournalSample(journalPath, record),
      onProgress: (message) => process.stdout.write(`[benchmark] ${message}\n`),
    });
    if (isArtifactComplete(artifact)) {
      await writeArtifact(outputDirectory, artifact);
      process.stdout.write(`${outputDirectory}\n`);
    } else {
      process.stdout.write(`Partial run journal: ${journalPath}\n`);
    }
    return;
  }
  if (command === 'merge') {
    const profileInput = option(args, '--profile');
    const input = option(args, '--input');
    const output = option(args, '--out');
    if (!profileInput || !input || !output) throw new Error('merge requires --profile, --input, and --out.');
    const profilePath = path.resolve(repositoryRoot, profileInput);
    const profile = validateProfile(JSON.parse(await readFile(profilePath, 'utf8')));
    const journals = await Promise.all(input.split(',').map((value) => readBenchmarkJournal(path.resolve(repositoryRoot, value.trim()))));
    const suites = [...journals[0]!.header.suites];
    const workloads = await loadProfileWorkloads(profilePath, profile);
    const expectedHeader = await createBenchmarkJournalHeader({ repositoryRoot, profile, workloads, suites });
    for (const journal of journals) assertJournalCompatible(expectedHeader, journal.header);
    const artifact = await runProfile({ repositoryRoot, profile, workloads, suites, blocks: [], existingReplicates: mergeBenchmarkJournalSamples(journals), artifactContext: expectedHeader.artifactContext });
    if (!isArtifactComplete(artifact)) throw new Error('Merged journals do not contain the complete profile matrix.');
    const outputDirectory = path.resolve(repositoryRoot, output);
    await writeArtifact(outputDirectory, artifact);
    process.stdout.write(`${outputDirectory}\n`);
    return;
  }
  if (command === 'report' || command === 'verify' || command === 'analyze') {
    const input = option(args, '--input');
    if (!input) throw new Error(`${command} requires --input.`);
    const artifact = await readArtifact(path.resolve(repositoryRoot, input));
    if (command === 'analyze') {
      await verifyArtifactSourceFiles(path.resolve(repositoryRoot, input), artifact);
      const directory = path.dirname(input.endsWith('.json') ? path.resolve(repositoryRoot, input) : path.join(path.resolve(repositoryRoot, input), 'manifest.json'));
      await writeAnalysisFiles(directory, artifact);
      await verifyArtifactFiles(path.resolve(repositoryRoot, input), artifact);
      process.stdout.write(`Analysis regenerated in ${path.join(directory, 'analysis')}\n`);
    } else {
      await verifyArtifactFiles(path.resolve(repositoryRoot, input), artifact);
      if (command === 'report') process.stdout.write(renderReport(artifact));
      else process.stdout.write('Benchmark artifact verified.\n');
    }
    return;
  }
  throw new Error(`Unknown benchmark command: ${command}`);
}

function stableSuites(value: readonly BenchmarkSuite[]): string {
  return [...value].sort().join(',');
}

await main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
