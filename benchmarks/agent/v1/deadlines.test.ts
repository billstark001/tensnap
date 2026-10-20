// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../../packages/tensnap-agent/src/cli';
import { resolveRuntimeContextPaths } from '../../../packages/tensnap-agent/src/runtime/context';
import {
  commandTimeoutMs,
  completionArgs,
  completionTimeoutMs,
  replicateTimeoutMs,
  runWaitBody,
} from './deadlines';

describe('benchmark completion deadlines', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['action', 'run', 'step', '--wait'],
    ['run', 'start', 'start', '--max-actions', '1000', '--wait'],
    [
      'run',
      'start',
      'start',
      '--max-actions',
      '1000',
      '--wait',
      '--record',
      '--until',
      'persisted',
    ],
    ['recording', 'stop'],
  ])('passes the long completion deadline through the public CLI: %j', async (...args) => {
    const directory = await mkdtemp(join(tmpdir(), 'tensnap-benchmark-deadline-'));
    try {
      const context = resolveRuntimeContextPaths({ rootDir: directory });
      await mkdir(context.contextDir, { recursive: true });
      await writeFile(
        context.controlFile,
        JSON.stringify({ host: '127.0.0.1', controlPort: 1234 }),
      );
      const requests: { path: string; body: unknown }[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === '/health') return Response.json({});
        requests.push({ path, body: JSON.parse(String(init?.body)) });
        return Response.json({ run: { id: 'slow' }, requestId: 'slow' });
      });
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await main([
        ...completionArgs(args, true),
        '--context-dir',
        directory,
        '--output-version',
        '1',
      ]);
      const wait = requests.find(
        (request) => request.path.endsWith('/wait') || request.path.endsWith('/stop'),
      );
      expect(wait?.body).toEqual({
        timeoutMs: completionTimeoutMs,
        ...(args[0] === 'run' && args.includes('--until') ? { until: 'persisted' } : {}),
      });
      expect(requests.filter((request) => !request.path.endsWith('/wait'))).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not inject wait options into bounded queries, offline reads or an explicit deadline', () => {
    for (const [args, online] of [
      [['scene', 'inspect'], true],
      [['recording', 'info', 'store'], false],
      [['run', 'start', 'start', '--max-actions', '1', '--wait', '--timeout-ms', '5'], true],
    ] as [string[], boolean][])
      expect(completionArgs(args, online)).toEqual(args);
  });

  it('uses the same HTTP completion budget and reserves outer time for exit and validation', () => {
    expect(runWaitBody()).toEqual({ until: 'settled', timeoutMs: completionTimeoutMs });
    expect(runWaitBody('persisted')).toEqual({
      until: 'persisted',
      timeoutMs: completionTimeoutMs,
    });
    expect(completionTimeoutMs).toBeGreaterThan(30_000);
    expect(commandTimeoutMs - completionTimeoutMs).toBeGreaterThanOrEqual(60_000);
    expect(replicateTimeoutMs - commandTimeoutMs).toBeGreaterThanOrEqual(240_000);
  });
});
