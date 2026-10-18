import fs from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { writeFileAtomically } from './atomic-file';

afterEach(() => vi.restoreAllMocks());
it.each(['write', 'rename'] as const)(
  'preserves a previous complete artifact after %s failure',
  async (failure) => {
    const root = await mkdtemp(join(tmpdir(), 'tensnap-atomic-'));
    const output = join(root, 'artifact.png');
    try {
      await writeFile(output, 'previous');
      if (failure === 'rename')
        vi.spyOn(fs, 'rename').mockImplementationOnce((_from, _to, callback) =>
          callback(new Error('rename failed')),
        );
      else
        vi.spyOn(fs, 'write').mockImplementationOnce((_fd, _buffer, ...args) => {
          const callback = args[args.length - 1] as (error: Error) => void;
          callback(new Error('disk full'));
        });
      await expect(writeFileAtomically(output, Uint8Array.of(1, 2))).rejects.toThrow(
        failure === 'write' ? 'disk full' : 'rename failed',
      );
      expect(await readFile(output, 'utf8')).toBe('previous');
      expect(await readdir(root)).toEqual(['artifact.png']);
      vi.restoreAllMocks();
      await Promise.all([
        writeFileAtomically(output, Uint8Array.of(3)),
        writeFileAtomically(output, Uint8Array.of(4)),
      ]);
      expect([[3], [4]]).toContainEqual([...(await readFile(output))]);
      expect(await readdir(root)).toEqual(['artifact.png']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
