import { cp, mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { sha256, stableJson } from '../node/runner';
import { inspectEnvironment, sourceIdentity } from './doctor';
import { exists, readJson, writeJson } from './files';
import { runExperiment, verifyExperiment } from './experiments';
import { execute } from './process';
import { exportBatch, pruneBatch } from './export';
import { verifyBatch } from './verify';
import type {
  EvaluationBatch,
  EvaluationMode,
  EvaluationSpecification,
  ExecutionContext,
} from './types';

export async function runBatch(
  context: ExecutionContext,
  directory: string,
  specification: EvaluationSpecification,
  mode: EvaluationMode,
  resume: boolean,
): Promise<void> {
  const source = await sourceIdentity(context);
  if (mode === 'publication' && source.dirty)
    throw new Error(
      'Commit source changes before a publication run. Smoke accepts an identifiable dirty source tree.',
    );
  const environment = await inspectEnvironment(context, specification);
  let batch: EvaluationBatch;
  if (resume) {
    batch = await readJson<EvaluationBatch>(path.join(directory, 'batch.json'));
    if (
      batch.schemaVersion !== 1 ||
      batch.mode !== mode ||
      batch.specificationSha256 !== sha256(specification)
    )
      throw new Error('Resume mode/specification differs from the recorded batch.');
    if (
      stableJson(batch.source) !== stableJson(source) ||
      stableJson(batch.environment) !== stableJson(environment)
    )
      throw new Error(
        'Resume requires the same source bytes, commit, dependencies and execution environment.',
      );
  } else {
    if (await exists(directory))
      throw new Error('Batch directory already exists. Use resume or choose a new --out.');
    await mkdir(directory, { recursive: true });
    batch = {
      schemaVersion: 1,
      mode,
      specification,
      specificationSha256: sha256(specification),
      source,
      environment,
      createdAt: new Date().toISOString(),
      status: 'running',
      experiments: Object.fromEntries(
        specification.experiments.map((experiment) => [experiment.id, { status: 'pending' }]),
      ),
    };
    await writeJson(path.join(directory, 'batch.json'), batch);
    await writeJson(path.join(directory, 'doctor.json'), environment);
    await cp(
      path.join(context.repositoryRoot, 'benchmarks/evaluation/tables.json'),
      path.join(directory, 'table-selection.json'),
    );
  }
  const lockPath = path.join(directory, '.execution.lock');
  const lock = await open(lockPath, 'wx').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'EEXIST')
      throw new Error(
        `Another run owns ${lockPath}. After a forced kill, confirm no runner remains before removing this lock.`,
      );
    throw error;
  });
  await lock.writeFile(`${process.pid}\n`);
  try {
    if (batch.status === 'complete') {
      await verifyBatch(context, directory);
    } else {
      await execute(context, 'pnpm', ['--filter', '@tensnap/agent', 'build'], {
        log: path.join(directory, 'logs/build.log'),
      });
      batch.status = 'running';
      for (const experiment of specification.experiments) {
        context.signal?.throwIfAborted();
        if (stableJson(await sourceIdentity(context)) !== stableJson(source))
          throw new Error(
            'Source changed during the batch; prior outputs remain available for inspection.',
          );
        const progress = batch.experiments[experiment.id]!;
        const output = path.join(directory, 'raw', experiment.id);
        if (await exists(output)) {
          await verifyExperiment(context, experiment, output);
          progress.status = 'complete';
          progress.completedAt ??= new Date().toISOString();
          await writeJson(path.join(directory, 'batch.json'), batch);
          continue;
        }
        progress.status = 'running';
        progress.startedAt = new Date().toISOString();
        delete progress.error;
        await writeJson(path.join(directory, 'batch.json'), batch);
        process.stdout.write(`\n[evaluation] ${experiment.id} started\n`);
        try {
          await runExperiment(context, experiment, directory, mode);
          progress.status = 'complete';
          progress.completedAt = new Date().toISOString();
        } catch (error) {
          progress.status = 'failed';
          progress.error = error instanceof Error ? error.message : String(error);
          batch.status = 'failed';
          await writeJson(path.join(directory, 'batch.json'), batch);
          throw error;
        }
        await writeJson(path.join(directory, 'batch.json'), batch);
        process.stdout.write(`[evaluation] ${experiment.id} complete\n`);
      }
      if (stableJson(await sourceIdentity(context)) !== stableJson(source))
        throw new Error('Source changed during the final experiment.');
      batch.status = 'complete';
      await writeJson(path.join(directory, 'batch.json'), batch);
      await verifyBatch(context, directory);
    }
    const output = path.join(directory, 'export');
    if (!(await exists(output))) await exportBatch(context, directory, output);
    await pruneBatch(context, directory);
    process.stdout.write(`\n[evaluation] Verified archive and tables: ${output}\n`);
  } catch (error) {
    if (batch.status !== 'complete') {
      batch.status = 'failed';
      await writeJson(path.join(directory, 'batch.json'), batch);
    }
    throw error;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
