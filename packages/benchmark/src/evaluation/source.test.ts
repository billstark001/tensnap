// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createBenchmarkJournalHeader, loadProfileWorkloads } from '../node/runner';
import { sourcePathspecs } from '../node/source';
import { loadBenchmarkProfile } from './config';
import { sourceIdentity } from './doctor';
import { execute, executionContext } from './process';
import type { ExecutionContext } from './types';

const checkout = path.resolve(import.meta.dirname, '../../../..');

async function commit(context: ExecutionContext): Promise<void> {
  await execute(context, 'git', ['add', '.'], { quiet: true });
  await execute(
    context,
    'git',
    [
      '-c',
      'user.name=Evaluation Test',
      '-c',
      'user.email=evaluation@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'test fixture',
    ],
    { quiet: true },
  );
}

async function withRepository(
  callback: (context: ExecutionContext, output: string) => Promise<void>,
): Promise<void> {
  const temporary = await mkdtemp(path.join(tmpdir(), 'tensnap-source-test-'));
  try {
    const repository = path.join(temporary, 'checkout');
    await mkdir(path.join(repository, 'packages/benchmark'), { recursive: true });
    await mkdir(path.join(repository, 'benchmark-results'));
    await writeFile(path.join(repository, 'model.ts'), 'export const steps = 500;\n');
    await writeFile(path.join(repository, '.gitignore'), 'dist/\n');
    await writeFile(path.join(repository, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    await writeFile(path.join(repository, 'packages/benchmark/package.json'), '{"version":"1"}');
    await writeFile(path.join(repository, 'benchmark-results/data.tar.gz'), 'old evidence');
    const context = executionContext(repository, 'python3', {
      workDirectory: path.join(repository, 'scratch [v1]'),
      cacheDirectory: path.join(repository, 'cache'),
    });
    const output = path.join(repository, 'custom-results [v1]', 'batch');
    context.env.TENSNAP_EVALUATION_OUTPUT_DIR = output;
    await execute(context, 'git', ['init', '--quiet'], { quiet: true });
    await commit(context);
    await callback(context, output);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

describe('evaluation source provenance', () => {
  it('keeps the source identity stable while unignored output, caches and build products change', async () => {
    await withRepository(async (context, output) => {
      const before = await sourceIdentity(context);
      expect(before.dirty).toBe(false);
      await mkdir(output, { recursive: true });
      await mkdir(path.join(context.repositoryRoot, 'dist'));
      await mkdir(path.join(context.repositoryRoot, 'evaluation-results'));
      for (const [file, content] of [
        [path.join(output, 'batch.json'), '{"status":"running"}'],
        [path.join(context.repositoryRoot, 'benchmark-results/data.tar.gz'), 'new evidence'],
        [path.join(context.repositoryRoot, 'evaluation-results/report.csv'), 'metric,value'],
        [path.join(context.repositoryRoot, 'dist/cli.js'), 'compiled CLI'],
        [path.join(context.workDirectory, 'runtime.json'), 'runtime scratch'],
        [path.join(context.cacheDirectory, 'compiled.bin'), 'cached bytecode'],
      ] as const)
        await writeFile(file, content);
      expect(await execute(context, 'git', ['status', '--porcelain'], { quiet: true })).not.toBe(
        '',
      );
      expect(await sourceIdentity(context)).toEqual(before);
    });
  });

  it('still detects tracked source changes, untracked source and new commits', async () => {
    await withRepository(async (context) => {
      const before = await sourceIdentity(context);
      const model = path.join(context.repositoryRoot, 'model.ts');
      await writeFile(model, 'export const steps = 501;\n');
      const changed = await sourceIdentity(context);
      expect(changed.dirty).toBe(true);
      expect(changed.filesSha256).not.toBe(before.filesSha256);
      await writeFile(model, 'export const steps = 500;\n');
      await writeFile(
        path.join(context.repositoryRoot, 'new-model.ts'),
        'export const seed = 1;\n',
      );
      const untracked = await sourceIdentity(context);
      expect(untracked.dirty).toBe(true);
      expect(untracked.filesSha256).not.toBe(before.filesSha256);
      await commit(context);
      const committed = await sourceIdentity(context);
      expect(committed.dirty).toBe(false);
      expect(committed.commit).not.toBe(before.commit);
    });
  });

  it('applies the same exclusions to a publication benchmark child and rejects real source edits', async () => {
    await withRepository(async (context, output) => {
      try {
        for (const name of [
          'TENSNAP_EVALUATION_OUTPUT_DIR',
          'TENSNAP_EVALUATION_WORK_DIR',
          'TENSNAP_EVALUATION_CACHE_DIR',
        ])
          vi.stubEnv(name, context.env[name]!);
        await mkdir(output, { recursive: true });
        await writeFile(path.join(output, 'batch.json'), '{"status":"running"}');
        await writeFile(path.join(context.workDirectory, 'runtime.json'), 'runtime scratch');
        const profilePath = path.join(
          checkout,
          'benchmarks/profiles/evaluation-2026-schelling-kernel-v2.json',
        );
        const profile = {
          ...(await loadBenchmarkProfile(checkout, profilePath)),
          requireCleanGit: true,
        };
        const options = {
          repositoryRoot: context.repositoryRoot,
          profile,
          workloads: await loadProfileWorkloads(profilePath, profile),
          suites: profile.suites,
        };
        const header = await createBenchmarkJournalHeader(options);
        expect(header.artifactContext.implementation.dirty).toBe(false);
        await writeFile(
          path.join(context.repositoryRoot, 'model.ts'),
          'export const steps = 501;\n',
        );
        await expect(createBenchmarkJournalHeader(options)).rejects.toThrow(/clean git worktree/);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  it('rejects exclusions that would hide the whole repository', () => {
    expect(() => sourcePathspecs(checkout, [checkout])).toThrow(/repository root/);
  });
});
