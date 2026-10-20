import { mkdtemp, readFile, rm, rename, writeFile, mkdir, readdir } from 'node:fs/promises';
import * as files from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { DaemonStartupError, startDetachedDaemon } from './daemon-startup';
import { isProcessAlive } from './context-paths';
import { classifyCliError } from '../cli';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof files>();
  return { ...actual, open: vi.fn(actual.open) };
});

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function paths() {
  const cwd = await mkdtemp(join(tmpdir(), 'tensnap-daemon-startup-'));
  directories.push(cwd);
  return { cwd, stderrPath: join(cwd, 'logs', 'daemon.stderr.log') };
}

it('fails on an early exit with bounded native-module diagnostics and cancels readiness polling', async () => {
  const options = await paths();
  let readinessAborted = false;
  const result = startDetachedDaemon(
    process.execPath,
    [
      '-e',
      `require('node:fs').writeSync(2, 'x'.repeat(100000) + '\\nCannot find module canvas.node\\n'); process.exit(1);`,
    ],
    {
      ...options,
      waitUntilReady: async (signal) => {
        try {
          await delay(10_000, undefined, { signal });
        } finally {
          readinessAborted = signal.aborted;
        }
      },
    },
  );
  let error: unknown;
  try {
    await result;
  } catch (cause) {
    error = cause;
  }
  expect(error).toBeInstanceOf(DaemonStartupError);
  const failure = error as DaemonStartupError;
  expect(failure.diagnostics).toMatchObject({
    exitCode: 1,
    stderrPath: options.stderrPath,
    stderrTail: expect.stringContaining('Cannot find module canvas.node'),
  });
  expect(Buffer.byteLength(failure.diagnostics.stderrTail)).toBeLessThanOrEqual(64 * 1024);
  expect(classifyCliError(failure)).toEqual({ category: 'execution_failed', exitCode: 3 });
  await Promise.resolve();
  expect(readinessAborted).toBe(true);
});

it('reports spawn failures without waiting for the readiness deadline', async () => {
  const options = await paths();
  await expect(
    startDetachedDaemon(join(options.cwd, 'missing-node'), [], {
      ...options,
      waitUntilReady: async () => true,
    }),
  ).rejects.toMatchObject({
    cause: { code: 'ENOENT' },
    diagnostics: { phase: 'spawn', stderrTail: '', stderrPath: options.stderrPath },
  });
});

it('leaves a successfully started daemon independent and keeps stderr writable', async () => {
  const options = await paths();
  const readyPath = join(options.cwd, 'ready');
  let pid: number | undefined;
  try {
    pid = await startDetachedDaemon(
      process.execPath,
      [
        '-e',
        `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(readyPath)}, String(process.pid));setInterval(()=>fs.writeSync(2,'alive\\n'),20);`,
      ],
      {
        ...options,
        waitUntilReady: async (signal) => {
          for (;;) {
            signal.throwIfAborted();
            try {
              return Number(await readFile(readyPath, 'utf8'));
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
            await delay(10, undefined, { signal });
          }
        },
      },
    );
    expect(isProcessAlive(pid)).toBe(true);
    for (let tries = 0; tries < 100; tries++) {
      if ((await readFile(options.stderrPath, 'utf8')).includes('alive')) break;
      await delay(10);
    }
    expect(await readFile(options.stderrPath, 'utf8')).toContain('alive');
  } finally {
    if (pid) process.kill(pid, 'SIGTERM');
  }
});

it('keeps a readiness timeout distinct from child exit and leaves the daemon running', async () => {
  const options = await paths();
  const readyPath = join(options.cwd, 'ready');
  let pid: number | undefined;
  try {
    await expect(
      startDetachedDaemon(
        process.execPath,
        [
          '-e',
          `require('node:fs').writeFileSync(${JSON.stringify(readyPath)}, String(process.pid));setInterval(()=>{},1000);`,
        ],
        {
          ...options,
          waitUntilReady: async (signal) => {
            for (;;) {
              signal.throwIfAborted();
              try {
                pid = Number(await readFile(readyPath, 'utf8'));
                break;
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
              }
              await delay(10, undefined, { signal });
            }
            throw new Error('Timed out waiting for runtime daemon.');
          },
        },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(DaemonStartupError);
      expect((error as DaemonStartupError).diagnostics).not.toHaveProperty('exitCode');
      expect(classifyCliError(error)).toEqual({ category: 'result_unknown', exitCode: 4 });
      return true;
    });
    expect(pid).toBeDefined();
    expect(isProcessAlive(pid!)).toBe(true);
  } finally {
    if (pid) process.kill(pid, 'SIGTERM');
  }
});

it.each(['remove', 'replace'])(
  'retains original child stderr when its pathname is %s during startup',
  async (operation) => {
    const options = await paths();
    const readyPath = join(options.cwd, 'ready');
    await expect(
      startDetachedDaemon(
        process.execPath,
        [
          '-e',
          `const fs=require('node:fs');fs.writeSync(2,'Cannot find module canvas.node\\n');fs.writeFileSync(${JSON.stringify(readyPath)},'ready');setTimeout(()=>process.exit(1),100);`,
        ],
        {
          ...options,
          waitUntilReady: async (signal) => {
            for (;;) {
              signal.throwIfAborted();
              try {
                await readFile(readyPath);
                break;
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
              }
              await delay(5, undefined, { signal });
            }
            if (operation === 'remove') await rm(options.stderrPath);
            else {
              const replacement = join(options.cwd, 'replacement.log');
              await writeFile(replacement, 'another launch');
              await rename(replacement, options.stderrPath);
            }
            await delay(10_000, undefined, { signal });
          },
        },
      ),
    ).rejects.toMatchObject({
      diagnostics: { phase: 'exit', exitCode: 1, stderrTail: 'Cannot find module canvas.node' },
    });
  },
);

it('removes the temporary log and closes it when log publication fails before spawning', async () => {
  const options = await paths();
  await mkdir(options.stderrPath, { recursive: true });
  const waitUntilReady = vi.fn();
  await expect(
    startDetachedDaemon(process.execPath, ['-e', 'process.exit(0)'], {
      ...options,
      waitUntilReady,
    }),
  ).rejects.toMatchObject({ code: expect.stringMatching(/EISDIR|EEXIST|EPERM|EACCES/) });
  expect(waitUntilReady).not.toHaveBeenCalled();
  expect(await readdir(join(options.cwd, 'logs'))).toEqual(['daemon.stderr.log']);
});

it('preserves the original exit failure alongside diagnostic read and close errors', async () => {
  const options = await paths();
  const actualOpen = (await vi.importActual<typeof files>('node:fs/promises')).open;
  let closeActual: (() => Promise<void>) | undefined;
  vi.mocked(files.open).mockImplementation(async (...args) => {
    const file = await actualOpen(...args);
    closeActual = file.close.bind(file);
    vi.spyOn(file, 'stat').mockRejectedValue(new Error('diagnostic read failed'));
    vi.spyOn(file, 'close').mockRejectedValue(new Error('diagnostic close failed'));
    return file;
  });
  try {
    let failure: unknown;
    try {
      await startDetachedDaemon(process.execPath, ['-e', 'process.exit(1)'], {
        ...options,
        waitUntilReady: (signal) => delay(10_000, undefined, { signal }),
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(DaemonStartupError);
    expect(failure).toMatchObject({
      message: expect.stringContaining('exited before readiness'),
      diagnostics: {
        phase: 'exit',
        exitCode: 1,
        stderrError: 'diagnostic read failed',
        cleanupError: 'diagnostic close failed',
      },
    });
    expect(classifyCliError(failure)).toEqual({ category: 'execution_failed', exitCode: 3 });
  } finally {
    vi.mocked(files.open).mockImplementation(actualOpen);
    await closeActual?.();
  }
});
