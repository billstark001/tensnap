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
import type { BenchmarkSuite } from './harness/types';
import {
  commaSeparatedValues,
  option,
  parseSuites,
  requiredOptions,
  selectedBlocks,
} from './cli-options';
import { readBenchmarkArtifact } from './node/sample-files';

function defaultOutputDirectory(repositoryRoot: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(repositoryRoot, 'benchmark-results', timestamp);
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

async function loadProfile(repositoryRoot: string, input: string) {
  const profilePath = path.resolve(repositoryRoot, input);
  const profile = validateProfile(JSON.parse(await readFile(profilePath, 'utf8')));
  return { profilePath, profile };
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
    const [profileInput] = requiredOptions(args, command, '--profile');
    const { profilePath, profile } = await loadProfile(repositoryRoot, profileInput);
    const selectedSuites = parseSuites(option(args, '--suite'), profile.suites);
    for (const suite of selectedSuites) {
      if (!profile.suites.includes(suite))
        throw new Error(`${suite} is not enabled by profile ${profile.id}.`);
    }
    if (profile.requireCleanGit && stableSuites(selectedSuites) !== stableSuites(profile.suites)) {
      throw new Error(`Submission profile ${profile.id} must run its complete suite matrix.`);
    }
    const workloads = await loadProfileWorkloads(profilePath, profile);
    const outputDirectory = path.resolve(
      repositoryRoot,
      option(args, '--out') ?? defaultOutputDirectory(repositoryRoot),
    );
    // Fail before creating a journal or running any replicate. The final
    // write repeats this check to preserve immutability across races.
    await assertArtifactOutputAvailable(outputDirectory);
    const blockPlan = selectedBlocks(args, profile.repetitions);
    const journalPath = path.resolve(
      repositoryRoot,
      option(args, '--journal') ?? `${outputDirectory}${blockPlan.suffix}.journal.jsonl`,
    );
    const runOptions = { repositoryRoot, profile, workloads, suites: selectedSuites } as const;
    const expectedHeader = await createBenchmarkJournalHeader(runOptions);
    let existingReplicates = [] as Awaited<ReturnType<typeof readBenchmarkJournal>>['samples'];
    if (args.includes('--resume')) {
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
    const [profileInput, input, output] = requiredOptions(
      args,
      command,
      '--profile',
      '--input',
      '--out',
    );
    const { profilePath, profile } = await loadProfile(repositoryRoot, profileInput);
    const journals = await Promise.all(
      commaSeparatedValues(input).map((value) =>
        readBenchmarkJournal(path.resolve(repositoryRoot, value)),
      ),
    );
    const suites = [...journals[0]!.header.suites];
    const workloads = await loadProfileWorkloads(profilePath, profile);
    const expectedHeader = await createBenchmarkJournalHeader({
      repositoryRoot,
      profile,
      workloads,
      suites,
    });
    for (const journal of journals) assertJournalCompatible(expectedHeader, journal.header);
    const artifact = await runProfile({
      repositoryRoot,
      profile,
      workloads,
      suites,
      blocks: [],
      existingReplicates: mergeBenchmarkJournalSamples(journals),
      artifactContext: expectedHeader.artifactContext,
    });
    if (!isArtifactComplete(artifact))
      throw new Error('Merged journals do not contain the complete profile matrix.');
    const outputDirectory = path.resolve(repositoryRoot, output);
    await writeArtifact(outputDirectory, artifact);
    process.stdout.write(`${outputDirectory}\n`);
    return;
  }
  if (command === 'report' || command === 'verify' || command === 'analyze') {
    const [input] = requiredOptions(args, command, '--input');
    const inputPath = path.resolve(repositoryRoot, input);
    const artifact = await readBenchmarkArtifact(inputPath);
    if (command === 'analyze') {
      await verifyArtifactSourceFiles(inputPath, artifact);
      const directory = inputPath.endsWith('.json') ? path.dirname(inputPath) : inputPath;
      await writeAnalysisFiles(directory, artifact);
      await verifyArtifactFiles(inputPath, artifact);
      process.stdout.write(`Analysis regenerated in ${path.join(directory, 'analysis')}\n`);
    } else {
      await verifyArtifactFiles(inputPath, artifact);
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
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
