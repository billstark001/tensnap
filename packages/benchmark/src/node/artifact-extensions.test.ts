// @vitest-environment node
import { mkdtemp, rm, writeFile, symlink, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extensionTables,
  loadArtifactExtension,
  validateResultTables,
} from './artifact-extensions';
import { writeTables } from '../evaluation/tables';
import type {
  BenchmarkArtifact,
  BenchmarkProfile,
  BenchmarkResultTable,
  BenchmarkArtifactExtension,
} from '../harness';
import type { EvaluationBatch } from '../evaluation/types';

const hash = (source: string) => createHash('sha256').update(source).digest('hex');
function artifact(module: string, sources: Record<string, string>): BenchmarkArtifact {
  return {
    profile: { artifactExtension: { module, sources } },
    runs: [{}],
  } as unknown as BenchmarkArtifact;
}
const table = (): BenchmarkResultTable => ({
  id: 'fixture',
  caption: 'Byte counts',
  columns: [{ key: 'bytes', label: 'Bytes' }],
  rows: [{ bytes: 42 }],
});
describe('profile artifact extensions', () => {
  it('leaves profiles without extensions unchanged', async () => {
    expect(
      await loadArtifactExtension('/nonexistent', { profile: {} } as BenchmarkArtifact),
    ).toBeUndefined();
  });
  it('checks lexical and symlink boundaries, including declared dependencies', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'benchmark-extension-'));
    const root = path.join(base, 'repo');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(root);
    try {
      const source = 'export default {verify(){}}';
      await writeFile(path.join(base, 'outside.mjs'), source);
      await symlink(path.join(base, 'outside.mjs'), path.join(root, 'link.mjs'));
      for (const module of ['../outside.mjs', path.join(base, 'outside.mjs'), 'link.mjs']) {
        await expect(
          loadArtifactExtension(root, artifact(module, { [module]: hash(source) })),
        ).rejects.toThrow(/repository-relative|symlink/);
      }
      await expect(loadArtifactExtension(root, artifact('missing.mjs', {}))).rejects.toThrow(/pin/);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
  it('checks source bytes before import and detects dependency edits even after module caching', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'benchmark-extension-'));
    try {
      const source =
        'export default {verify(a){if(a.runs.length!==1)throw Error("wrong matrix")}, tables(){return [{id:"fixture",caption:"Byte counts",columns:[{key:"bytes",label:"Bytes"}],rows:[{bytes:42}]}]}}';
      await writeFile(path.join(root, 'extension.mjs'), source);
      await writeFile(path.join(root, 'oracle.mjs'), 'export const count=42;');
      const a = artifact('extension.mjs', {
        'extension.mjs': hash(source),
        'oracle.mjs': hash('export const count=42;'),
      });
      const extension: BenchmarkArtifactExtension | undefined = await loadArtifactExtension(
        root,
        a,
      );
      expect(() => extension!.verify(a)).not.toThrow();
      expect(await extensionTables(root, a)).toEqual([table()]);
      await expect(extensionTables(root, { ...a, runs: [] })).rejects.toThrow(/wrong matrix/);
      await writeFile(path.join(root, 'oracle.mjs'), 'export const count=99;');
      await expect(loadArtifactExtension(root, a)).rejects.toThrow(/source mismatch.*oracle/);
      await writeFile(
        path.join(root, 'extension.mjs'),
        'throw Error("must not execute modified source");',
      );
      await expect(loadArtifactExtension(root, a)).rejects.toThrow(/source mismatch/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('rejects malformed exports before invoking a verifier', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'benchmark-extension-'));
    try {
      for (const [index, source] of [
        'export default {}',
        'export default {verify(){},tables:1}',
      ].entries()) {
        const name = `invalid-${index}.mjs`;
        await writeFile(path.join(root, name), source);
        await expect(
          loadArtifactExtension(root, artifact(name, { [name]: hash(source) })),
        ).rejects.toThrow(/export verify/);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it.each([
    (t: BenchmarkResultTable) => {
      t.id = '../escape';
    },
    (t: BenchmarkResultTable) => {
      t.columns.push({ ...t.columns[0]! });
    },
    (t: BenchmarkResultTable) => {
      t.columns[0]!.label = '';
    },
    (t: BenchmarkResultTable) => {
      t.rows[0]!.bytes = NaN;
    },
    (t: BenchmarkResultTable) => {
      delete t.rows[0]!.bytes;
    },
    (t: BenchmarkResultTable) => {
      t.rows = [Object.create({ bytes: 42 })];
    },
  ])('rejects invalid table schema or values %#', (mutate) => {
    const t = table();
    mutate(t);
    expect(() => validateResultTables([t])).toThrow();
  });
  it('rejects conflicting table IDs across contributions before writing any output', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'benchmark-tables-'));
    const output = path.join(base, 'out');
    try {
      await expect(writeTables(output, [table(), table()], {} as EvaluationBatch)).rejects.toThrow(
        /duplicate/,
      );
      await expect(access(output)).rejects.toThrow();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
// Compile-check the public extension descriptor, rather than importing private type files.
const publicProfile: Partial<BenchmarkProfile> = {
  artifactExtension: { module: 'fixture.mjs', sources: { 'fixture.mjs': 'a'.repeat(64) } },
};
void publicProfile;
