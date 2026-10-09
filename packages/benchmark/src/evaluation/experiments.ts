import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { BenchmarkArtifact } from '../harness/types';
import { verifyArtifactFiles } from '../node/runner';
import { diagnosticProfile, loadBenchmarkProfile } from './config';
import { exists, readJson, writeJson } from './files';
import { execute } from './process';
import { verifyWorkflow } from './workflow';
import type { EvaluationMode, ExecutionContext, Experiment } from './types';

export async function verifyExperiment(
  context: ExecutionContext,
  experiment: Experiment,
  folder: string,
): Promise<void> {
  if (experiment.kind === 'benchmark') {
    await verifyArtifactFiles(folder);
  } else if (experiment.kind === 'conformance') {
    await execute(
      context,
      context.python,
      ['conformance/run_matrix.py', '--verify', '--input', folder],
      { quiet: true },
    );
  } else if (experiment.kind === 'workflow') {
    await verifyWorkflow(folder);
  } else {
    await execute(
      context,
      context.python,
      ['-m', 'python_dqn.evidence', 'verify', '--input', folder],
      {
        cwd: path.join(context.repositoryRoot, 'examples'),
        quiet: true,
      },
    );
  }
}

export async function runExperiment(
  context: ExecutionContext,
  experiment: Experiment,
  batch: string,
  mode: EvaluationMode,
): Promise<void> {
  const output = path.join(batch, 'raw', experiment.id);
  const log = path.join(batch, 'logs', `${experiment.id}.log`);
  await mkdir(path.dirname(output), { recursive: true });
  if (experiment.kind === 'benchmark') {
    const sourceProfile = path.resolve(context.repositoryRoot, experiment.profile!);
    const profile = await loadBenchmarkProfile(context.repositoryRoot, experiment.profile!);
    const recordedProfile = path.join(batch, 'profiles', `${experiment.id}.json`);
    // Smoke runs from its generated copy with absolute modules. Publication runs
    // use the original profile path and retain an unchanged copy as evidence.
    const runnable = mode === 'smoke' ? diagnosticProfile(profile, sourceProfile) : profile;
    if (!(await exists(recordedProfile))) await writeJson(recordedProfile, runnable);
    const journal = `${output}.journal.jsonl`;
    await execute(
      context,
      'pnpm',
      [
        'bench',
        'run',
        '--profile',
        mode === 'smoke' ? recordedProfile : sourceProfile,
        '--out',
        output,
        ...((await exists(journal)) ? ['--resume'] : []),
      ],
      { log },
    );
  } else if (experiment.kind === 'conformance') {
    await execute(
      context,
      context.python,
      ['conformance/run_matrix.py', '--write', '--out', output],
      { log },
    );
  } else if (experiment.kind === 'workflow') {
    await execute(
      context,
      process.execPath,
      ['benchmarks/schelling/headless/run.mjs', '--out', output, '--skip-build'],
      { log },
    );
  } else {
    await execute(
      context,
      context.python,
      [
        '-m',
        'python_dqn.evidence',
        'run',
        '--out',
        output,
        ...(mode === 'smoke' ? ['--smoke'] : []),
      ],
      {
        cwd: path.join(context.repositoryRoot, 'examples'),
        log,
      },
    );
  }
  await verifyExperiment(context, experiment, output);
}

export async function readBenchmark(directory: string): Promise<BenchmarkArtifact> {
  return readJson<BenchmarkArtifact>(path.join(directory, 'manifest.json'));
}
