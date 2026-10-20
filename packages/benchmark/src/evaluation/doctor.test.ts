import type * as Process from './process';
// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectEnvironment } from './doctor';
import { execute, executionContext } from './process';
import type { EvaluationSpecification } from './types';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('./config', () => ({ checkProfileLocks: vi.fn().mockResolvedValue({}) }));
vi.mock('./process', async (importOriginal) => ({
  ...(await importOriginal<typeof Process>()),
  execute: vi.fn(),
}));
vi.mock('playwright', () => ({
  chromium: { launch: vi.fn(), executablePath: () => '/test/chromium' },
}));

const root = path.resolve(import.meta.dirname, '../../../..');
const context = executionContext(root);
const specification: EvaluationSpecification = { schemaVersion: 1, id: 'test', experiments: [] };
const julia = {
  version: '1.13.2',
  bindingPath: path.join(root, 'packages/tensnap-julia/src/TenSnap.jl'),
  agents: '7.0.2',
  wglmakie: '0.13.11',
};

describe('evaluation environment probes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFile).mockResolvedValue('');
    vi.mocked(chromium.launch).mockResolvedValue({
      version: () => 'test-chromium',
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof chromium.launch>>);
    vi.mocked(execute).mockImplementation(async (_context, executable, args) => {
      if (executable === context.python && args[0] === '-c')
        return JSON.stringify({
          bindingPath: path.join(root, 'packages/tensnap-python/tensnap/__init__.py'),
        });
      if (executable === 'julia') return `Package initialization output\n${JSON.stringify(julia)}`;
      return '';
    });
  });

  it('reads Julia metadata as JSON with startup files disabled and diagnostics excluded', async () => {
    const environment = await inspectEnvironment(context, specification);
    expect(environment.julia).toEqual(julia);
    expect(execute).toHaveBeenCalledWith(
      context,
      'julia',
      [
        '--startup-file=no',
        `--project=${context.env.TENSNAP_JULIA_PROJECT}`,
        '-e',
        expect.stringContaining('JSON3.write'),
      ],
      { quiet: true, capture: 'stdout' },
    );
  });

  it('probes only native Node and the standard-library archiver for Node-only evaluation', async () => {
    vi.mocked(execute).mockResolvedValue('{}');
    const environment = await inspectEnvironment(context, {
      ...specification,
      environment: 'node',
    });
    expect(environment).toHaveProperty('native');
    expect(environment).not.toHaveProperty('julia');
    expect(environment).not.toHaveProperty('pythonFreezeSha256');
    expect(chromium.launch).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(execute)
        .mock.calls.some(([, executable]) => executable === 'julia' || executable === 'go'),
    ).toBe(false);
  });

  it.each([
    '/another-checkout/packages/tensnap-julia/src/TenSnap.jl',
    path.join(root, 'packages/tensnap-julia-other/src/TenSnap.jl'),
  ])('rejects a binding outside the checkout package: %s', async (bindingPath) => {
    const executeNormally = vi.mocked(execute).getMockImplementation()!;
    vi.mocked(execute).mockImplementation(async (...args) =>
      args[1] === 'julia' ? JSON.stringify({ ...julia, bindingPath }) : executeNormally(...args),
    );
    await expect(inspectEnvironment(context, specification)).rejects.toThrow(
      `Julia must import the binding from this checkout. Loaded: ${bindingPath}`,
    );
    expect(chromium.launch).not.toHaveBeenCalled();
  });
});
