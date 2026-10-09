import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  archiveCommand,
  fileChecksums,
  listFiles,
  verifyExportChecksums,
  withEvidence,
  createWorkDirectory,
} from './archive';
import { exists, isFigure, readJson, writeJson } from './files';
import { buildTables, writeTables } from './tables';
import { verifyEvidence } from './verify';
import { compactEvidence } from './compact';
import type { EvaluationBatch, ExecutionContext, ExportOptions } from './types';

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
        await cp(path.join(raw, name), path.join(report, name), {
          recursive: true,
          filter: (source) => path.basename(source) !== '.DS_Store' && !isFigure(source),
        });
  }
}

/**
 * Export checks all raw evidence, then checks its compressed round trip before publication.
 * Data and original figures occupy separate archives; external reports contain no figures.
 */
export async function exportBatch(
  context: ExecutionContext,
  input: string,
  output: string,
  options: ExportOptions = {},
): Promise<void> {
  const gzipLevel = options.gzipLevel ?? 6;
  if (!Number.isInteger(gzipLevel) || gzipLevel < 0 || gzipLevel > 9)
    throw new Error('--gzip-level must be an integer from 0 through 9.');
  if (await exists(output))
    throw new Error(`Export already exists; verify it or choose a new --out: ${output}`);
  await mkdir(path.dirname(output), { recursive: true });
  const stage = await mkdtemp(path.join(path.dirname(output), '.evaluation-export-'));
  let payload: string | undefined;
  try {
    payload = await createWorkDirectory(context, 'export-payload-');
    const payloadDirectory = payload;
    await withEvidence(context, input, async (evidence) => {
      const batch = await verifyEvidence(context, evidence);
      const tables = await buildTables(context.repositoryRoot, evidence, batch);
      await writeTables(path.join(stage, 'tables'), tables, batch);
      await copyResults(evidence, stage, batch);
      const data = path.join(payloadDirectory, 'data');
      const figures = path.join(payloadDirectory, 'figures');
      await mkdir(data);
      await mkdir(figures);
      const includes = [
        'batch.json',
        'table-selection.json',
        'raw',
        'profiles',
        'logs',
        'doctor.json',
      ];
      for (const name of includes)
        if (await exists(path.join(evidence, name)))
          await cp(path.join(evidence, name), path.join(data, name), { recursive: true });
      await compactEvidence(data, batch);
      for (const relative of await listFiles(data)) {
        if (!isFigure(relative)) continue;
        const target = path.join(figures, relative);
        await mkdir(path.dirname(target), { recursive: true });
        await rename(path.join(data, relative), target);
      }
      for (const [name, source] of [
        ['data', data],
        ['figures', figures],
      ] as const)
        await archiveCommand(context, [
          'create',
          '--input',
          source,
          '--out',
          path.join(stage, `${name}.tar.gz`),
          '--gzip-level',
          String(gzipLevel),
          ...(name === 'figures' ? ['--allow-empty'] : []),
        ]);
      await withEvidence(context, path.join(stage, 'data.tar.gz'), async (roundTrip) => {
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
        'Raw samples, compact manifests, checkpoints and logs are retained in `data.tar.gz`.',
        'Original PNGs and plots are retained only in `figures.tar.gz`; paths and SHA-256 checks remain verifiable.',
        `Gzip compression level: ${gzipLevel}. Manifest and journal samples reference the checked samples.jsonl rows.`,
        'Use `pnpm evaluation extract --input EXPORT --out DIRECTORY --figures-only` to extract figures on demand.',
        'CSV tables preserve full precision; LaTeX tables round displayed fractional values to three decimal places.',
        'Performance measurement intervals are defined by each recorded profile; model-step and GUI intervals remain separate.',
        '',
        ...batch.specification.experiments.map((experiment) => `- ${experiment.id}: complete`),
        '',
      ].join('\n');
      await writeFile(path.join(stage, 'summary.md'), summary);
      await writeJson(path.join(stage, 'index.json'), {
        schemaVersion: 2,
        archives: { data: 'data.tar.gz', figures: 'figures.tar.gz' },
        compression: { algorithm: 'gzip', level: gzipLevel },
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
  } finally {
    if (payload) await rm(payload, { recursive: true, force: true });
  }
}

/** Only prune after both the export and archived experiment evidence verify successfully. */
export async function pruneBatch(context: ExecutionContext, batchDirectory: string): Promise<void> {
  const output = path.join(batchDirectory, 'export');
  await verifyExportChecksums(output);
  await withEvidence(context, output, (evidence) => verifyEvidence(context, evidence));
  const retained = await readJson<EvaluationBatch>(path.join(batchDirectory, 'batch.json'));
  const exported = await readFile(path.join(batchDirectory, 'batch.json'));
  await withEvidence(context, output, async (evidence) => {
    if (!exported.equals(await readFile(path.join(evidence, 'batch.json'))))
      throw new Error('Archived batch metadata differs from the working copy.');
  });
  if (retained.status !== 'complete') throw new Error('Cannot prune incomplete evidence.');
  for (const name of ['raw', 'profiles', 'logs', 'doctor.json', 'table-selection.json'])
    await rm(path.join(batchDirectory, name), { recursive: true, force: true });
}
