import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  archiveCommand,
  fileChecksums,
  listFiles,
  verifyExportChecksums,
  withEvidence,
} from './archive';
import { exists, readJson, writeJson } from './files';
import { buildTables, writeTables } from './tables';
import { verifyEvidence } from './verify';
import type { EvaluationBatch, ExecutionContext } from './types';

async function copyResults(
  evidence: string,
  output: string,
  batch: EvaluationBatch,
): Promise<void> {
  for (const experiment of batch.specification.experiments) {
    const raw = path.join(evidence, 'raw', experiment.id);
    const report = path.join(output, 'reports', experiment.id);
    await mkdir(report, { recursive: true });
    for (const name of ['report.md', 'analysis', 'MATRIX.md', 'summary.json', 'evidence'])
      if (await exists(path.join(raw, name)))
        await cp(path.join(raw, name), path.join(report, name), { recursive: true });
    for (const relative of await listFiles(raw)) {
      if (!relative.endsWith('.png')) continue;
      const target = path.join(output, 'figures', experiment.id, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(raw, relative), target);
    }
  }
}

/**
 * Export checks all raw evidence, then checks its compressed round trip before publication.
 * Heavy manifests, samples, journals, checkpoints and logs live only inside evidence.tar.gz.
 */
export async function exportBatch(
  context: ExecutionContext,
  input: string,
  output: string,
): Promise<void> {
  if (await exists(output))
    throw new Error(`Export already exists; verify it or choose a new --out: ${output}`);
  await mkdir(path.dirname(output), { recursive: true });
  const stage = await mkdtemp(path.join(path.dirname(output), '.evaluation-export-'));
  try {
    await withEvidence(context, input, async (evidence) => {
      const batch = await verifyEvidence(context, evidence);
      const tables = await buildTables(context.repositoryRoot, evidence, batch);
      await writeTables(path.join(stage, 'tables'), tables, batch);
      await copyResults(evidence, stage, batch);
      const archive = path.join(stage, 'evidence.tar.gz');
      const includes = [
        'batch.json',
        'table-selection.json',
        'raw',
        'profiles',
        'logs',
        'doctor.json',
      ];
      const selected = [];
      for (const name of includes)
        if (await exists(path.join(evidence, name))) selected.push('--include', name);
      await archiveCommand(context, ['create', '--input', evidence, '--out', archive, ...selected]);
      await withEvidence(context, archive, async (roundTrip) => {
        await verifyEvidence(context, roundTrip);
        const rebuilt = await buildTables(context.repositoryRoot, roundTrip, batch);
        if (JSON.stringify(rebuilt) !== JSON.stringify(tables))
          throw new Error('Tables differ after the archive round trip.');
      });
      const summary = [
        `# ${batch.specification.id}`,
        '',
        `Mode: ${batch.mode}. Source: ${batch.source.commit}.`,
        `Started: ${batch.createdAt}. Every declared experiment passed offline verification.`,
        '',
        'Raw evidence, full manifests, checkpoints and execution logs are retained in `evidence.tar.gz`.',
        'CSV tables preserve full precision; LaTeX tables round displayed fractional values to three decimal places.',
        'Performance measurement intervals are defined by each recorded profile; model-step and GUI intervals remain separate.',
        '',
        ...batch.specification.experiments.map((experiment) => `- ${experiment.id}: complete`),
        '',
      ].join('\n');
      await writeFile(path.join(stage, 'summary.md'), summary);
      await writeJson(path.join(stage, 'index.json'), {
        schemaVersion: 1,
        mode: batch.mode,
        source: batch.source,
        environment: batch.environment,
        specification: batch.specification,
        filesSha256: await fileChecksums(stage, ['index.json']),
      });
      await verifyExportChecksums(stage);
    });
    await rename(stage, output);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

/** Only prune after both the export and archived experiment evidence verify successfully. */
export async function pruneBatch(context: ExecutionContext, batchDirectory: string): Promise<void> {
  const output = path.join(batchDirectory, 'export');
  await verifyExportChecksums(output);
  await withEvidence(context, path.join(output, 'evidence.tar.gz'), (evidence) =>
    verifyEvidence(context, evidence),
  );
  const retained = await readJson<EvaluationBatch>(path.join(batchDirectory, 'batch.json'));
  const exported = await readFile(path.join(batchDirectory, 'batch.json'));
  await withEvidence(context, path.join(output, 'evidence.tar.gz'), async (evidence) => {
    if (!exported.equals(await readFile(path.join(evidence, 'batch.json'))))
      throw new Error('Archived batch metadata differs from the working copy.');
  });
  if (retained.status !== 'complete') throw new Error('Cannot prune incomplete evidence.');
  for (const name of ['raw', 'profiles', 'logs', 'doctor.json', 'table-selection.json'])
    await rm(path.join(batchDirectory, name), { recursive: true, force: true });
}
