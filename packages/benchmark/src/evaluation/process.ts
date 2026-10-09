import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ExecutionContext } from './types';

/** Arguments are passed directly to the executable, never through a shell. */
export async function execute(
  context: ExecutionContext,
  executable: string,
  args: readonly string[],
  options: { cwd?: string; log?: string; quiet?: boolean } = {},
): Promise<string> {
  context.signal?.throwIfAborted();
  if (options.log) await mkdir(path.dirname(options.log), { recursive: true });
  const log = options.log ? createWriteStream(options.log, { flags: 'a' }) : undefined;
  let output = '';
  const child = spawn(executable, [...args], {
    cwd: options.cwd ?? context.repositoryRoot,
    env: context.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const forward = (data: Buffer) => {
    output = (output + data.toString()).slice(-2_000_000);
    log?.write(data);
    if (!options.quiet) process.stdout.write(data);
  };
  child.stdout.on('data', forward);
  child.stderr.on('data', forward);
  const interrupt = () => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch (error) {
      if (!['ESRCH', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      child.kill('SIGTERM');
    }
  };
  if (context.signal) context.signal.addEventListener('abort', interrupt, { once: true });
  else {
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
  }
  if (context.signal?.aborted) interrupt();
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`${executable} exited ${code ?? signal}:\n${output.slice(-6000)}`));
      });
    });
    return output.trim();
  } finally {
    context.signal?.removeEventListener('abort', interrupt);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (log)
      await new Promise<void>((resolve, reject) => {
        log.once('error', reject);
        log.end(resolve);
      });
  }
}

export function executionContext(root: string, python?: string): ExecutionContext {
  const selected = python ?? process.env.TENSNAP_EVALUATION_PYTHON ?? '.evaluation-venv/bin/python';
  const interpreter =
    selected.includes('/') || selected.includes('\\') ? path.resolve(root, selected) : selected;
  return {
    repositoryRoot: root,
    python: interpreter,
    env: {
      ...process.env,
      PATH: path.isAbsolute(interpreter)
        ? `${path.dirname(interpreter)}${path.delimiter}${process.env.PATH ?? ''}`
        : process.env.PATH,
      PYTHONPATH: [path.join(root, 'packages/tensnap-python'), process.env.PYTHONPATH]
        .filter(Boolean)
        .join(path.delimiter),
      TENSNAP_JULIA_PROJECT: path.join(root, 'benchmarks/evaluation/environments/julia'),
      NETLOGO_HOME: process.env.NETLOGO_HOME ?? '/Applications/NetLogo 7.0.4',
    },
  };
}
