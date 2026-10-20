import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cliModules, createModuleOrchestrator } from './cli-orchestrator';
import { main } from './cli';
import { resolveRuntimeContextPaths } from './runtime/context-paths';

afterEach(() => vi.restoreAllMocks());

it('loads only the requested capability and shares concurrent imports, including failures', async () => {
  const error = new Error('module unavailable');
  const loaders = {
    online: vi.fn(async () => ({ value: 1 })),
    offline: vi.fn(async () => {
      throw error;
    }),
  };
  const modules = createModuleOrchestrator(loaders);
  expect(loaders.online).not.toHaveBeenCalled();
  const first = modules.load('online');
  expect(modules.load('online')).toBe(first);
  expect(await first).toEqual({ value: 1 });
  expect(loaders.online).toHaveBeenCalledTimes(1);
  expect(loaders.offline).not.toHaveBeenCalled();
  const failure = modules.load('offline');
  await expect(failure).rejects.toBe(error);
  expect(modules.load('offline')).toBe(failure);
  expect(loaders.offline).toHaveBeenCalledTimes(1);
});

it.each([['--version'], ['--help'], ['recording', 'render', '--help']])(
  'does not load execution capabilities for help/version: %j',
  async (...args) => {
    const load = vi.spyOn(cliModules, 'load');
    const fetch = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await main([...args, '--output-version', '1']);
    expect(load).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  },
);

it.each([
  { args: ['param', 'list'], capabilities: [] },
  { args: ['scene', 'snapshot'], capabilities: [] },
  { args: ['monitor', 'get', 'population'], capabilities: ['query'] },
])('keeps online command dependencies scoped: $args', async ({ args, capabilities }) => {
  const directory = await mkdtemp(join(tmpdir(), 'tensnap-cli-load-'));
  try {
    const context = resolveRuntimeContextPaths({ rootDir: directory });
    await mkdir(context.contextDir, { recursive: true });
    await writeFile(context.controlFile, JSON.stringify({ host: '127.0.0.1', controlPort: 1234 }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({}));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const load = vi.spyOn(cliModules, 'load');
    await main([...args, '--context-dir', directory, '--output-version', '1']);
    expect(load.mock.calls.map(([capability]) => capability)).toEqual(capabilities);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('still rejects malformed query selectors before runtime access', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await expect(
    main(['scene', 'inspect', '--query', '{"selector":{"kind":"eval"}}']),
  ).rejects.toMatchObject({ category: 'input_error', exitCode: 2 });
  expect(fetch).not.toHaveBeenCalled();
});
