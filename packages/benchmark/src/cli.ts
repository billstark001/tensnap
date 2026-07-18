import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  loadProfileWorkloads,
  renderReport,
  runProfile,
  validateProfile,
  verifyArtifactFiles,
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
  pnpm bench run --profile benchmarks/profiles/browser-all-v0.3.json
  pnpm bench report --input benchmark-results/run
  pnpm bench verify --input benchmark-results/run

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
    const workloads = await loadProfileWorkloads(profilePath, profile);
    const artifact = await runProfile({ repositoryRoot, profile, workloads, suites: selectedSuites });
    const outputDirectory = path.resolve(repositoryRoot, option(args, '--out') ?? defaultOutputDirectory(repositoryRoot));
    await writeArtifact(outputDirectory, artifact);
    process.stdout.write(`${outputDirectory}\n`);
    return;
  }
  if (command === 'report' || command === 'verify') {
    const input = option(args, '--input');
    if (!input) throw new Error(`${command} requires --input.`);
    const artifact = await readArtifact(path.resolve(repositoryRoot, input));
    await verifyArtifactFiles(path.resolve(repositoryRoot, input), artifact);
    if (command === 'report') process.stdout.write(renderReport(artifact));
    else process.stdout.write('Benchmark artifact verified.\n');
    return;
  }
  throw new Error(`Unknown benchmark command: ${command}`);
}

await main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
