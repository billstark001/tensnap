import path from 'node:path';
import { sha256, stableJson } from '../node/runner';
import { readJson } from './files';
import { readBenchmark, verifyExperiment } from './experiments';
import { withEvidence } from './archive';
import { verifyRetainedJournal } from './compact';
import type { EvaluationBatch, ExecutionContext } from './types';

export async function verifyEvidence(
  context: ExecutionContext,
  directory: string,
): Promise<EvaluationBatch> {
  const batch = await readJson<EvaluationBatch>(path.join(directory, 'batch.json'));
  if (batch.schemaVersion !== 1 || batch.status !== 'complete')
    throw new Error('Batch is incomplete.');
  if (batch.specificationSha256 !== sha256(batch.specification))
    throw new Error('Batch specification hash mismatch.');
  const expected = batch.specification.experiments.map((experiment) => experiment.id).sort();
  if (stableJson(expected) !== stableJson(Object.keys(batch.experiments).sort()))
    throw new Error('Batch experiment matrix mismatch.');
  if (batch.mode === 'publication' && batch.source.dirty)
    throw new Error('Publication evidence requires a clean measured source commit.');
  for (const experiment of batch.specification.experiments) {
    if (batch.experiments[experiment.id]?.status !== 'complete')
      throw new Error(`Incomplete experiment: ${experiment.id}`);
    const folder = path.join(directory, 'raw', experiment.id);
    await verifyExperiment(context, experiment, folder);
    let revision: string;
    if (experiment.kind === 'benchmark') {
      const artifact = await readBenchmark(folder);
      await verifyRetainedJournal(
        path.join(directory, 'raw', `${experiment.id}.journal.jsonl`),
        artifact,
      );
      revision = artifact.implementation.gitSha!;
      const declared = await readJson(path.join(directory, 'profiles', `${experiment.id}.json`));
      if (sha256(declared) !== artifact.integrity.profileSha256)
        throw new Error(`Recorded profile differs from benchmark: ${experiment.id}`);
      if (
        batch.mode === 'publication' &&
        (artifact.implementation.dirty || !artifact.profile.requireCleanGit)
      )
        throw new Error('Benchmark was not run with publication source validation.');
    } else {
      const filename =
        experiment.kind === 'conformance'
          ? 'results.json'
          : experiment.kind === 'workflow'
            ? 'summary.json'
            : 'manifest.json';
      const provenance = await readJson<{
        revision?: string;
        sourceCommit?: string;
        purpose?: string;
      }>(path.join(folder, filename));
      revision = provenance.revision ?? provenance.sourceCommit!;
      if (experiment.kind === 'fire' && (provenance.purpose ?? 'publication') !== batch.mode)
        throw new Error('Fire/DQN diagnostic/publication purpose mismatch.');
    }
    if (revision !== batch.source.commit)
      throw new Error(`Mixed source revisions in batch: ${experiment.id}`);
  }
  return batch;
}

export async function verifyBatch(
  context: ExecutionContext,
  input: string,
): Promise<EvaluationBatch> {
  return withEvidence(context, input, (directory) => verifyEvidence(context, directory));
}
