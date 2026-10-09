import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BenchmarkArtifact, BenchmarkReplicate } from '../harness/types';
import { readBenchmarkArtifact, type SamplesReference } from '../node/sample-files';
import { readBenchmarkJournal, stableJson, type BenchmarkJournal } from '../node/runner';
import { exists, hashBytes, hashFile, writeJson } from './files';
import type { EvaluationBatch } from './types';

function withoutVisualFiles(sample: BenchmarkReplicate): BenchmarkReplicate {
  if (!sample.visual) return sample;
  const { files: _files, inlinePngBase64: _inline, ...visual } = sample.visual;
  return { ...sample, visual };
}

function checkJournalSample(original: BenchmarkReplicate, retained: BenchmarkReplicate): void {
  if (stableJson(withoutVisualFiles(original)) !== stableJson(withoutVisualFiles(retained)))
    throw new Error('Journal sample differs from its retained samples.jsonl row.');
  for (const [checkpoint, encoded] of Object.entries(original.visual?.inlinePngBase64 ?? {})) {
    if (
      !retained.visual?.files?.[checkpoint] ||
      hashBytes(Buffer.from(encoded, 'base64')) !== retained.visual.checkpoints[checkpoint]
    )
      throw new Error(`Journal PNG differs from its retained checkpoint: ${checkpoint}`);
  }
}

/** Check journal references and embedded legacy records against the authoritative sample rows. */
export async function verifyRetainedJournal(
  journal: string,
  artifact: BenchmarkArtifact,
): Promise<BenchmarkJournal | undefined> {
  if (!(await exists(journal))) return undefined;
  const checked = await readBenchmarkJournal(journal);
  if (
    checked.header.profileSha256 !== artifact.integrity.profileSha256 ||
    checked.header.implementationGitSha !== artifact.implementation.gitSha ||
    stableJson([...checked.header.suites].sort()) !==
      stableJson([...new Set(artifact.runs.map((run) => run.suite))].sort()) ||
    stableJson([...checked.header.expectedRunIds].sort()) !==
      stableJson([...artifact.integrity.expectedRunIds].sort()) ||
    stableJson(checked.header.artifactContext) !==
      stableJson({
        harness: artifact.harness,
        implementation: artifact.implementation,
        environment: artifact.environment,
      })
  )
    throw new Error('Journal provenance differs from its benchmark manifest.');
  const samples = new Map(
    artifact.runs.flatMap((run) =>
      run.samples.map((sample) => [`${run.id}\0${sample.block}`, sample] as const),
    ),
  );
  if (checked.samples.length !== samples.size)
    throw new Error('Journal does not contain the complete retained replicate set.');
  for (const record of checked.samples) {
    const retained = samples.get(`${record.runId}\0${record.block}`);
    if (!retained) throw new Error(`Journal has an unknown run/block: ${record.runId}`);
    checkJournalSample(record.sample, retained);
  }
  return checked;
}

/** Compact a private export copy; measured outputs and their source revision stay untouched. */
export async function compactEvidence(directory: string, batch: EvaluationBatch): Promise<void> {
  for (const experiment of batch.specification.experiments) {
    if (experiment.kind !== 'benchmark') continue;
    const folder = path.join(directory, 'raw', experiment.id);
    const artifact = await readBenchmarkArtifact(folder);
    const samplesSha256 = await hashFile(path.join(folder, 'samples.jsonl'));
    const reference = (runId: string, file: string, block?: number): SamplesReference => ({
      path: file,
      sha256: samplesSha256,
      runId,
      ...(block === undefined ? {} : { block }),
    });
    const journal = path.join(directory, 'raw', `${experiment.id}.journal.jsonl`);
    const checked = await verifyRetainedJournal(journal, artifact);
    if (checked) {
      const compacted = [JSON.stringify(checked.header)];
      for (const record of checked.samples) {
        const { sample: _sample, ...metadata } = record;
        compacted.push(
          JSON.stringify({
            ...metadata,
            sampleReference: reference(
              record.runId,
              `${experiment.id}/samples.jsonl`,
              record.block,
            ),
          }),
        );
      }
      await writeFile(journal, compacted.join('\n') + '\n');
    }
    await writeJson(path.join(folder, 'manifest.json'), {
      ...artifact,
      runs: artifact.runs.map(({ samples: _samples, ...run }) => ({
        ...run,
        samplesReference: reference(run.id, 'samples.jsonl'),
      })),
    });
  }
}
