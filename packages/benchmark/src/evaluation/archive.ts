import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exists, hashFile, readJson } from './files';
import { execute } from './process';
import type { ExecutionContext } from './types';

export async function listFiles(directory: string, relative = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
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

/** Use live raw files or a checked temporary extraction; callers never need to unpack evidence manually. */
export async function withEvidence<T>(
  context: ExecutionContext,
  input: string,
  callback: (directory: string) => Promise<T>,
): Promise<T> {
  if (await exists(path.join(input, 'raw'))) return callback(input);
  const archive = input.endsWith('.tar.gz') ? input : path.join(input, 'export/evidence.tar.gz');
  const exportDirectory = path.dirname(archive);
  const index = path.join(exportDirectory, 'index.json');
  if (await exists(index)) await verifyExportChecksums(exportDirectory);
  const temporary = await mkdtemp(path.join(tmpdir(), 'tensnap-evidence-'));
  try {
    const extracted = path.join(temporary, 'evidence');
    await archiveCommand(context, ['extract', '--input', archive, '--out', extracted]);
    return await callback(extracted);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function verifyExportChecksums(directory: string): Promise<void> {
  const index = await readJson<{ schemaVersion: number; filesSha256: Record<string, string> }>(
    path.join(directory, 'index.json'),
  );
  if (index.schemaVersion !== 1) throw new Error('Unsupported export index.');
  const actual = await fileChecksums(directory, ['index.json']);
  if (
    JSON.stringify(Object.keys(actual).sort()) !==
    JSON.stringify(Object.keys(index.filesSha256).sort())
  )
    throw new Error('Export file inventory differs from index.json.');
  for (const [relative, hash] of Object.entries(index.filesSha256))
    if (actual[relative] !== hash) throw new Error(`Export checksum mismatch: ${relative}`);
}
