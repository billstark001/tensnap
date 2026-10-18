import { mkdtemp, readFile, readdir, rm, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { writeFileAtomically } from './atomic-file';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, writeFile: vi.fn(original.writeFile), rename: vi.fn(original.rename) };
});

afterEach(() => vi.restoreAllMocks());

it.each(['write', 'rename'] as const)(
  'preserves an existing file and removes temporary output after %s failure',
  async (failure) => {
    const root = await mkdtemp(join(tmpdir(), 'tensnap-atomic-write-'));
    const output = join(root, 'artifact.png');
    const original = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    try {
      await original.writeFile(output, 'previous-complete-image');
      if (failure === 'write') {
        vi.mocked(writeFile).mockImplementationOnce(async (path) => {
          await original.writeFile(path, 'partial');
          throw new Error('disk full');
        });
      } else {
        vi.mocked(rename).mockRejectedValueOnce(new Error('rename failed'));
      }
      await expect(writeFileAtomically(output, new Uint8Array([1, 2, 3]))).rejects.toThrow(
        failure === 'write' ? 'disk full' : 'rename failed',
      );
      expect(await readFile(output, 'utf8')).toBe('previous-complete-image');
      expect(await readdir(root)).toEqual(['artifact.png']);
      await writeFileAtomically(output, new Uint8Array([4, 5, 6]));
      expect(Array.from(await readFile(output))).toEqual([4, 5, 6]);
      expect(await readdir(root)).toEqual(['artifact.png']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
