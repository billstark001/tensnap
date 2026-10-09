import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { BenchmarkArtifact, BenchmarkReplicate, BenchmarkRun } from '../harness/types';

/** Paths are relative to the JSON/JSONL file containing the reference. */
export interface SamplesReference {
  path: string;
  sha256: string;
  runId: string;
  block?: number;
}

export interface SampleRow {
  runId: string;
  suite: BenchmarkRun['suite'];
  workload: BenchmarkRun['workload'];
  execution: BenchmarkRun['execution'];
  sample: BenchmarkReplicate;
}

export type SampleFileCache = Map<string, { sha256: string; rows: SampleRow[] }>;

export function referencePath(owner: string, relative: string): string {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.includes('\0') ||
    relative.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error(`Unsafe sample file reference: ${relative}`);
  return path.resolve(path.dirname(owner), relative);
}

/** A single checked samples file can supply every run and journal record. */
export async function referencedSamples(
  owner: string,
  reference: SamplesReference,
  cache: SampleFileCache,
): Promise<BenchmarkReplicate[]> {
  const file = referencePath(owner, reference.path);
  let contents = cache.get(file);
  if (!contents) {
    const bytes = await readFile(file);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== reference.sha256)
      throw new Error(`Sample reference checksum mismatch: ${reference.path}`);
    contents = {
      sha256,
      rows: bytes
        .toString('utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    };
    cache.set(file, contents);
  }
  if (!/^[a-f0-9]{64}$/.test(reference.sha256) || contents.sha256 !== reference.sha256)
    throw new Error(`Sample reference checksum mismatch: ${reference.path}`);
  const rows = contents.rows.filter(
    (row) =>
      row.runId === reference.runId &&
      (reference.block === undefined || row.sample.block === reference.block),
  );
  if (!rows.length || (reference.block !== undefined && rows.length !== 1))
    throw new Error(`Missing or ambiguous sample reference: ${reference.runId}`);
  return rows.map((row) => row.sample);
}

/** Legacy manifests embed samples; compact exports load the same rows by hash. */
export async function readBenchmarkArtifact(input: string): Promise<BenchmarkArtifact> {
  const file = input.endsWith('.json') ? input : path.join(input, 'manifest.json');
  type StoredRun = Omit<BenchmarkRun, 'samples'> & {
    samples?: BenchmarkReplicate[];
    samplesReference?: SamplesReference;
  };
  const stored = JSON.parse(await readFile(file, 'utf8')) as Omit<BenchmarkArtifact, 'runs'> & {
    runs: StoredRun[];
  };
  const cache: SampleFileCache = new Map();
  const runs: BenchmarkRun[] = [];
  for (const run of stored.runs) {
    const { samples, samplesReference, ...metadata } = run;
    if (
      samplesReference &&
      (samples || samplesReference.runId !== run.id || samplesReference.block !== undefined)
    )
      throw new Error(`Invalid manifest sample reference: ${run.id}`);
    const loaded = samplesReference
      ? await referencedSamples(file, samplesReference, cache)
      : samples;
    if (!Array.isArray(loaded)) throw new Error(`Missing run samples: ${run.id}`);
    runs.push({ ...metadata, samples: loaded });
  }
  return { ...stored, runs };
}

/** Rehydrate PNGs in memory only when a journal is used to resume or merge. */
export async function journalSampleWithImages(
  sample: BenchmarkReplicate,
  samplesFile: string,
): Promise<BenchmarkReplicate> {
  if (!sample.visual?.files) return sample;
  const inlinePngBase64: Record<string, string> = {};
  for (const [checkpoint, relative] of Object.entries(sample.visual.files)) {
    const bytes = await readFile(referencePath(samplesFile, relative));
    if (createHash('sha256').update(bytes).digest('hex') !== sample.visual.checkpoints[checkpoint])
      throw new Error(`Journal visual checkpoint checksum mismatch: ${relative}`);
    inlinePngBase64[checkpoint] = bytes.toString('base64');
  }
  return { ...sample, visual: { checkpoints: sample.visual.checkpoints, inlinePngBase64 } };
}
