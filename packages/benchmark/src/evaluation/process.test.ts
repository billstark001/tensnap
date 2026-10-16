// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { execute, executionContext } from './process';

const root = path.resolve(import.meta.dirname, '../../../..');

describe('evaluation subprocess output', () => {
  it('captures stdout independently while retaining diagnostics in logs and failures', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tensnap-process-test-'));
    const context = executionContext(root, undefined, {
      workDirectory: path.join(directory, 'work'),
      cacheDirectory: path.join(directory, 'cache'),
    });
    const args = [
      '-e',
      'process.stdout.write(\'{"version":"1.13.2"}\\n\'); process.stderr.write("startup warning\\n");',
    ];
    try {
      const log = path.join(directory, 'probe.log');
      const stdout = await execute(context, process.execPath, args, {
        quiet: true,
        capture: 'stdout',
        log,
      });
      expect(JSON.parse(stdout)).toEqual({ version: '1.13.2' });
      const logged = await readFile(log, 'utf8');
      expect(logged).toContain('startup warning');
      expect(logged).toContain(stdout);
      const combined = await execute(context, process.execPath, args, { quiet: true });
      expect(combined).toContain('startup warning');
      expect(combined).toContain(stdout);
      await expect(
        execute(
          context,
          process.execPath,
          ['-e', 'process.stderr.write("package load failed"); process.exitCode = 1;'],
          { quiet: true, capture: 'stdout' },
        ),
      ).rejects.toThrow('package load failed');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
