import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type {
  BenchmarkArtifact,
  BenchmarkArtifactExtension,
  BenchmarkResultTable,
  BenchmarkProfile,
} from '../harness/types';

async function sourcePath(root: string, name: string): Promise<string> {
  const inside = (base: string, target: string) => {
    const relative = path.relative(base, target);
    return (
      relative !== '' &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };
  const resolved = path.resolve(root, name);
  if (typeof name !== 'string' || path.isAbsolute(name) || !inside(root, resolved))
    throw new Error('Artifact extension must be a repository-relative source module.');
  const physical = await realpath(resolved);
  if (!inside(await realpath(root), physical))
    throw new Error('Artifact extension symlink leaves the repository.');
  return physical;
}

export async function verifyExtensionSources(
  root: string,
  profile: BenchmarkProfile,
): Promise<string | undefined> {
  const declaration = profile.artifactExtension;
  if (!declaration) return undefined;
  if (
    !declaration.sources ||
    !Object.prototype.hasOwnProperty.call(declaration.sources, declaration.module)
  )
    throw new Error('Artifact extension must pin its module and offline source dependencies.');
  for (const [name, expected] of Object.entries(declaration.sources)) {
    if (!/^[a-f0-9]{64}$/.test(expected))
      throw new Error('Invalid artifact extension source hash.');
    const actual = createHash('sha256')
      .update(await readFile(await sourcePath(root, name)))
      .digest('hex');
    if (actual !== expected)
      throw new Error(
        `Artifact extension source mismatch: ${name}. Use the recorded source checkout.`,
      );
  }
  return sourcePath(root, declaration.module);
}

/** Extensions are trusted source modules referenced by a profile, never artifact-bundled code. */
export async function loadArtifactExtension(
  root: string,
  artifact: BenchmarkArtifact,
): Promise<BenchmarkArtifactExtension | undefined> {
  const resolved = await verifyExtensionSources(root, artifact.profile);
  if (!resolved) return undefined;
  const imported = await import(pathToFileURL(resolved).href);
  const extension = imported.default as BenchmarkArtifactExtension | undefined;
  if (
    typeof extension?.verify !== 'function' ||
    (extension.tables !== undefined && typeof extension.tables !== 'function')
  )
    throw new Error('Artifact extension must export verify() and optional tables().');
  return extension;
}

export async function extensionTables(
  root: string,
  artifact: BenchmarkArtifact,
): Promise<BenchmarkResultTable[]> {
  const extension = await loadArtifactExtension(root, artifact);
  await extension?.verify(artifact);
  const tables = (await extension?.tables?.(artifact)) ?? [];
  validateResultTables(tables);
  return tables;
}

export function validateResultTables(tables: BenchmarkResultTable[]): void {
  if (!Array.isArray(tables)) throw new Error('Extension tables must be an array.');
  const ids = new Set<string>();
  for (const table of tables) {
    if (
      !table ||
      !/^[a-z][a-z0-9-]*$/.test(table.id) ||
      ids.has(table.id) ||
      typeof table.caption !== 'string' ||
      !Array.isArray(table.columns) ||
      !table.columns.length ||
      !Array.isArray(table.rows)
    )
      throw new Error('Invalid or duplicate extension table ID/columns.');
    ids.add(table.id);
    const keys = new Set<string>();
    for (const column of table.columns) {
      if (
        !column ||
        typeof column.key !== 'string' ||
        !column.key ||
        keys.has(column.key) ||
        typeof column.label !== 'string' ||
        !column.label
      )
        throw new Error(`Invalid or duplicate table column: ${table.id}`);
      keys.add(column.key);
    }
    for (const row of table.rows)
      for (const column of table.columns) {
        const value =
          row && Object.prototype.hasOwnProperty.call(row, column.key)
            ? row[column.key]
            : undefined;
        if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value)))
          throw new Error(`Invalid extension table value: ${table.id}/${column.key}`);
      }
  }
}
