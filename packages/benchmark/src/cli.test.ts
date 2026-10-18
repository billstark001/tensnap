// @vitest-environment node
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const runner = vi.hoisted(() => ({
  loadProfileWorkloads: vi.fn(),
  appendBenchmarkJournalSample: vi.fn(),
  assertArtifactOutputAvailable: vi.fn(),
  assertJournalCompatible: vi.fn(),
  createBenchmarkJournalHeader: vi.fn(),
  initializeBenchmarkJournal: vi.fn(),
  isArtifactComplete: vi.fn(),
  mergeBenchmarkJournalSamples: vi.fn(),
  readBenchmarkJournal: vi.fn(),
  renderReport: vi.fn(),
  runProfile: vi.fn(),
  validateProfile: vi.fn(),
  verifyArtifactFiles: vi.fn(),
  verifyArtifactSourceFiles: vi.fn(),
  writeAnalysisFiles: vi.fn(),
  writeArtifact: vi.fn(),
}));
const files = vi.hoisted(() => ({
  access: vi.fn(),
  readFile: vi.fn(),
  readBenchmarkArtifact: vi.fn(),
}));
vi.mock('./node/runner', () => runner);
vi.mock('node:fs/promises', () => ({ access: files.access, readFile: files.readFile }));
vi.mock('./node/sample-files', () => ({ readBenchmarkArtifact: files.readBenchmarkArtifact }));

const originalArgv = process.argv;
const originalExitCode = process.exitCode;
const profile = { id: 'fixture', suites: ['node', 'ws'], repetitions: 4, requireCleanGit: false };
const artifact = { runs: [] };
const header = { suites: ['node'], artifactContext: {} };

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  process.exitCode = 0;
  files.access.mockResolvedValue(undefined);
  files.readFile.mockResolvedValue(JSON.stringify(profile));
  files.readBenchmarkArtifact.mockResolvedValue(artifact);
  runner.validateProfile.mockImplementation((value) => value);
  runner.loadProfileWorkloads.mockResolvedValue([]);
  runner.createBenchmarkJournalHeader.mockResolvedValue(header);
  runner.readBenchmarkJournal.mockResolvedValue({ header, samples: [] });
  runner.mergeBenchmarkJournalSamples.mockReturnValue([]);
  runner.runProfile.mockResolvedValue(artifact);
  runner.isArtifactComplete.mockReturnValue(true);
  runner.renderReport.mockReturnValue('report');
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

async function invoke(...args: string[]) {
  process.argv = ['node', 'cli.ts', ...args];
  await import('./cli');
}

it('uses shared profile and CSV parsing without changing block journals or run inputs', async () => {
  await invoke(
    'run',
    '--profile',
    './profile.json',
    '--suite',
    ' ws, node ',
    '--out',
    'results',
    '--block',
    '1, 3',
  );
  const output = path.resolve('results');
  expect(files.readFile).toHaveBeenCalledWith(path.resolve('profile.json'), 'utf8');
  expect(runner.runProfile).toHaveBeenCalledWith(
    expect.objectContaining({
      repositoryRoot: process.cwd(),
      profile,
      suites: ['ws', 'node'],
      blocks: [0, 2],
      existingReplicates: [],
    }),
  );
  expect(runner.initializeBenchmarkJournal).toHaveBeenCalledWith(
    `${output}.blocks-1-3.journal.jsonl`,
    header,
  );
  expect(runner.writeArtifact).toHaveBeenCalledWith(output, artifact);
  expect(process.exitCode).toBe(0);
});

it('retains explicit journal paths and resume validation', async () => {
  await invoke(
    'run',
    '--profile',
    'profile.json',
    '--out',
    'results',
    '--journal',
    'logs/resume.jsonl',
    '--resume',
  );
  expect(runner.readBenchmarkJournal).toHaveBeenCalledWith(path.resolve('logs/resume.jsonl'));
  expect(runner.assertJournalCompatible).toHaveBeenCalledWith(header, header);
  expect(runner.initializeBenchmarkJournal).not.toHaveBeenCalled();
});

it('resolves each merge CSV path independently and preserves absolute inputs', async () => {
  const absolute = path.resolve('journals/second.jsonl');
  await invoke(
    'merge',
    '--profile',
    'profile.json',
    '--input',
    ` journals/first.jsonl, ${absolute} `,
    '--out',
    'merged',
  );
  expect(runner.readBenchmarkJournal.mock.calls.map(([file]) => file)).toEqual([
    path.resolve('journals/first.jsonl'),
    absolute,
  ]);
  expect(runner.runProfile).toHaveBeenCalledWith(
    expect.objectContaining({ suites: ['node'], blocks: [], existingReplicates: [] }),
  );
  expect(runner.writeArtifact).toHaveBeenCalledWith(path.resolve('merged'), artifact);
});

it.each(['report', 'verify', 'analyze'])(
  'normalizes the %s artifact path once for reading and verification',
  async (command) => {
    await invoke(command, '--input', 'results/../results/run');
    const input = path.resolve('results/run');
    expect(files.readBenchmarkArtifact).toHaveBeenCalledWith(input);
    expect(runner.verifyArtifactFiles).toHaveBeenCalledWith(input, artifact);
    if (command === 'analyze') {
      expect(runner.verifyArtifactSourceFiles).toHaveBeenCalledWith(input, artifact);
      expect(runner.writeAnalysisFiles).toHaveBeenCalledWith(input, artifact);
    }
  },
);

it.each(['results/manifest.json', 'results/manifest.json/'])(
  'uses the normalized manifest path to locate analysis output: %s',
  async (input) => {
    await invoke('analyze', '--input', input);
    expect(files.readBenchmarkArtifact).toHaveBeenCalledWith(path.resolve('results/manifest.json'));
    expect(runner.writeAnalysisFiles).toHaveBeenCalledWith(path.resolve('results'), artifact);
  },
);

it('rejects a suite absent from the profile before loading workloads or writing output', async () => {
  await invoke('run', '--profile', 'profile.json', '--suite', 'browser');
  expect(process.exitCode).toBe(1);
  expect(process.stderr.write).toHaveBeenCalledWith(
    expect.stringContaining('browser is not enabled by profile fixture.'),
  );
  expect(runner.loadProfileWorkloads).not.toHaveBeenCalled();
  expect(runner.initializeBenchmarkJournal).not.toHaveBeenCalled();
  expect(runner.runProfile).not.toHaveBeenCalled();
});

it.each([
  ['run', 'run requires --profile.'],
  ['merge', 'merge requires --profile, --input, and --out.'],
  ['report', 'report requires --input.'],
  ['verify', 'verify requires --input.'],
  ['analyze', 'analyze requires --input.'],
])(
  'rejects missing %s inputs before reading profile or artifact files',
  async (command, message) => {
    await invoke(command);
    expect(process.exitCode).toBe(1);
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining(message));
    expect(files.readFile).not.toHaveBeenCalled();
    expect(files.readBenchmarkArtifact).not.toHaveBeenCalled();
    expect(runner.runProfile).not.toHaveBeenCalled();
  },
);
