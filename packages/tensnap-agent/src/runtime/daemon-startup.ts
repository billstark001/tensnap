import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';

const STDERR_TAIL_BYTES = 64 * 1024;

interface StartupDiagnostics {
  phase: 'spawn' | 'exit' | 'readiness';
  pid?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stderrPath: string;
  stderrTail: string;
  stderrError?: string;
  cleanupError?: string;
}

export class DaemonStartupError extends Error {
  constructor(
    cause: unknown,
    readonly diagnostics: StartupDiagnostics,
  ) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(
      `${message}\nDaemon stderr: ${diagnostics.stderrPath}${diagnostics.stderrTail ? `\n${diagnostics.stderrTail}` : ''}${diagnostics.stderrError ? `\nCannot read daemon stderr: ${diagnostics.stderrError}` : ''}`,
      { cause },
    );
  }
}

async function readStderrTail(file: FileHandle): Promise<string> {
  const { size } = await file.stat();
  const length = Math.min(size, STDERR_TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await file.read(buffer, 0, length, size - length);
  return buffer.toString('utf8', 0, bytesRead).trim();
}

async function openStartupLog(path: string): Promise<FileHandle> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx+', 0o600);
  try {
    // Publish a fresh inode: another launch must not truncate a live child's fd.
    await rename(temporary, path);
    return file;
  } catch (error) {
    const errors: unknown[] = [error];
    try {
      await file.close();
    } catch (cleanupError) {
      errors.push(cleanupError);
    }
    try {
      await rm(temporary, { force: true });
    } catch (cleanupError) {
      errors.push(cleanupError);
    }
    if (errors.length > 1)
      throw Object.assign(
        new AggregateError(errors, 'Daemon log publication and cleanup failed.', { cause: error }),
        { code: (error as NodeJS.ErrnoException).code },
      );
    throw error;
  }
}

/** Observe only startup; the daemon keeps its own stderr fd after the parent exits. */
export async function startDetachedDaemon<T>(
  executable: string,
  args: string[],
  options: {
    cwd: string;
    stderrPath: string;
    waitUntilReady: (signal: AbortSignal) => Promise<T>;
  },
): Promise<T> {
  await mkdir(dirname(options.stderrPath), { recursive: true });
  // One current-launch log, rather than an accumulating log per attempt.
  const stderr = await openStartupLog(options.stderrPath);
  const controller = new AbortController();
  let child: ChildProcess | undefined;
  let phase: StartupDiagnostics['phase'] = 'spawn';
  let startupError: DaemonStartupError | undefined;
  let result: T | undefined;
  let exit: Pick<StartupDiagnostics, 'exitCode' | 'signal'> = {};
  let onError: (error: Error) => void = () => {};
  let onExit: (code: number | null, signal: NodeJS.Signals | null) => void = () => {};
  let onSpawn: () => void = () => {};
  try {
    const spawnedChild = spawn(executable, args, {
      cwd: options.cwd,
      detached: true,
      stdio: ['ignore', 'ignore', stderr.fd],
    });
    child = spawnedChild;
    const failed = new Promise<never>((_resolve, reject) => {
      onError = reject;
      onExit = (code, signal) => {
        phase = 'exit';
        exit = { exitCode: code, signal };
        reject(
          new Error(
            `Runtime daemon exited before readiness (${signal ? `signal ${signal}` : `code ${code}`}).`,
          ),
        );
      };
      spawnedChild.once('error', onError);
      spawnedChild.once('exit', onExit);
    });
    const spawned = new Promise<void>((resolve) => {
      onSpawn = resolve;
      spawnedChild.once('spawn', onSpawn);
    });
    await Promise.race([failed, spawned]);
    phase = 'readiness';
    result = await Promise.race([
      failed,
      Promise.resolve().then(() => options.waitUntilReady(controller.signal)),
    ]);
  } catch (cause) {
    controller.abort();
    const diagnostics: StartupDiagnostics = {
      phase,
      pid: child?.pid,
      ...exit,
      stderrPath: options.stderrPath,
      stderrTail: '',
    };
    try {
      diagnostics.stderrTail = await readStderrTail(stderr);
    } catch (error) {
      diagnostics.stderrError = error instanceof Error ? error.message : String(error);
    }
    // Capture termination after the asynchronous diagnostic read, too.
    Object.assign(diagnostics, { phase, ...exit });
    startupError = new DaemonStartupError(cause, diagnostics);
  } finally {
    controller.abort();
    child?.removeListener('error', onError);
    child?.removeListener('exit', onExit);
    child?.removeListener('spawn', onSpawn);
    child?.unref();
    try {
      await stderr.close();
    } catch (error) {
      const cleanupError = error instanceof Error ? error.message : String(error);
      if (startupError) {
        startupError.diagnostics.cleanupError = cleanupError;
        startupError.message += `\nCannot close daemon stderr: ${cleanupError}`;
      } else
        startupError = new DaemonStartupError(error, {
          phase: 'readiness',
          pid: child?.pid,
          stderrPath: options.stderrPath,
          stderrTail: '',
          cleanupError,
        });
    }
  }
  if (startupError) throw startupError;
  return result as T;
}
