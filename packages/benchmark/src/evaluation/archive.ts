import { cp, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { exists, hashFile, isFigure, readJson } from './files';
import { execute, prepareDirectories } from './process';
import type { ExecutionContext, ExportIndex } from './types';

export async function listFiles(directory: string, relative = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    // Finder may add this after a verified export is opened; it is not evidence.
    if (entry.name === '.DS_Store') continue;
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Evidence cannot contain a symbolic link: ${name}`);
    if (entry.isDirectory()) files.push(...(await listFiles(directory, name)));
    else if (entry.isFile()) files.push(name);
  }
  return files.sort();
}

export async function fileChecksums(
  directory: string,
  excluded: readonly string[] = [],
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const relative of await listFiles(directory))
    if (!excluded.includes(relative))
      hashes[relative] = await hashFile(path.join(directory, relative));
  return hashes;
}

export async function archiveCommand(context: ExecutionContext, args: string[]): Promise<void> {
  await execute(context, context.python, ['benchmarks/evaluation/archive.py', ...args], {
    quiet: true,
  });
}

/** Operation-owned temporary directories are removed by their caller's finally block. */
export async function createWorkDirectory(
  context: ExecutionContext,
  prefix: string,
): Promise<string> {
  await prepareDirectories(context);
  return mkdtemp(path.join(context.workDirectory, prefix));
}

/** Resolve both archive layouts without requiring callers to know how a batch was stored. */
export async function evidenceArchives(input: string): Promise<{ data: string; figures?: string }> {
  let data: string;
  if (input.endsWith('.tar.gz')) {
    if (path.basename(input) === 'figures.tar.gz')
      throw new Error('Use data.tar.gz or its export directory for complete evidence.');
    data = input;
  } else {
    const candidates = [
      'data.tar.gz',
      'export/data.tar.gz',
      'evidence.tar.gz',
      'export/evidence.tar.gz',
    ];
    const found = [];
    for (const name of candidates)
      if (await exists(path.join(input, name))) found.push(path.join(input, name));
    if (found.length !== 1) throw new Error(`Expected exactly one evidence archive in ${input}.`);
    data = found[0]!;
  }
  const exportDirectory = path.dirname(data);
  if (await exists(path.join(exportDirectory, 'index.json')))
    await verifyExportChecksums(exportDirectory);
  if (path.basename(data) !== 'data.tar.gz') return { data };
  const figures = path.join(exportDirectory, 'figures.tar.gz');
  if (!(await exists(figures))) throw new Error(`Missing companion figure archive: ${figures}`);
  return { data, figures };
}

/** Use live raw files or a checked temporary extraction; callers never need to unpack evidence manually. */
export async function withEvidence<T>(
  context: ExecutionContext,
  input: string,
  callback: (directory: string) => Promise<T>,
): Promise<T> {
  if (await exists(path.join(input, 'raw'))) return callback(input);
  const archives = await evidenceArchives(input);
  const temporary = await createWorkDirectory(context, 'evidence-');
  try {
    const extracted = path.join(temporary, 'evidence');
    await archiveCommand(context, ['extract', '--input', archives.data, '--out', extracted]);
    if (archives.figures) {
      const figures = path.join(temporary, 'figures');
      await archiveCommand(context, ['extract', '--input', archives.figures, '--out', figures]);
      for (const relative of await listFiles(extracted))
        if (isFigure(relative)) throw new Error(`Figure found in data archive: ${relative}`);
      for (const relative of await listFiles(figures)) {
        if (!isFigure(relative)) throw new Error(`Non-figure found in figure archive: ${relative}`);
        const destination = path.join(extracted, relative);
        if (await exists(destination)) throw new Error(`Overlapping archive member: ${relative}`);
        await mkdir(path.dirname(destination), { recursive: true });
        await cp(path.join(figures, relative), destination);
      }
    }
    return await callback(extracted);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function verifyExportChecksums(directory: string): Promise<void> {
  const index = await readJson<ExportIndex>(path.join(directory, 'index.json'));
  if (![1, 2].includes(index.schemaVersion)) throw new Error('Unsupported export index.');
  if (
    index.schemaVersion === 2 &&
    (index.archives?.data !== 'data.tar.gz' ||
      index.archives?.figures !== 'figures.tar.gz' ||
      index.compression?.algorithm !== 'gzip' ||
      !Number.isInteger(index.compression.level) ||
      index.compression.level < 0 ||
      index.compression.level > 9 ||
      !index.filesSha256['data.tar.gz'] ||
      !index.filesSha256['figures.tar.gz'] ||
      Object.keys(index.filesSha256).some(isFigure))
  )
    throw new Error('Invalid split export index or external figure file.');
  const actual = await fileChecksums(directory, ['index.json']);
  if (
    JSON.stringify(Object.keys(actual).sort()) !==
    JSON.stringify(Object.keys(index.filesSha256).sort())
  )
    throw new Error('Export file inventory differs from index.json.');
  for (const [relative, hash] of Object.entries(index.filesSha256))
    if (actual[relative] !== hash) throw new Error(`Export checksum mismatch: ${relative}`);
}

/** Extract to a fresh destination while retaining the paths referenced by manifests. */
export async function extractEvidence(
  context: ExecutionContext,
  input: string,
  output: string,
  figuresOnly = false,
): Promise<void> {
  if (await exists(output)) throw new Error(`Extraction destination already exists: ${output}`);
  await mkdir(path.dirname(output), { recursive: true });
  const stage = await mkdtemp(path.join(path.dirname(output), '.evaluation-extract-'));
  try {
    const destination = path.join(stage, 'evidence');
    const archives = (await exists(path.join(input, 'raw')))
      ? undefined
      : await evidenceArchives(input);
    if (figuresOnly && archives?.figures) {
      await archiveCommand(context, ['extract', '--input', archives.figures, '--out', destination]);
      for (const file of await listFiles(destination))
        if (!isFigure(file)) throw new Error(`Non-figure found in figure archive: ${file}`);
    } else {
      await withEvidence(context, input, async (evidence) => {
        if (!figuresOnly) await cp(evidence, destination, { recursive: true });
        else {
          await mkdir(destination);
          for (const relative of await listFiles(evidence)) {
            if (!isFigure(relative)) continue;
            const target = path.join(destination, relative);
            await mkdir(path.dirname(target), { recursive: true });
            await cp(path.join(evidence, relative), target);
          }
        }
      });
    }
    await rename(destination, output);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
