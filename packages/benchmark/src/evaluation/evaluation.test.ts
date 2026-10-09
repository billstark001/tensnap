// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { diagnosticProfile, loadBenchmarkProfile } from './config';
import { renderCsv, renderTex, selectRun } from './tables';
import { archiveCommand, withEvidence } from './archive';
import { execute, executionContext } from './process';
import { exists } from './files';
import type { BenchmarkArtifact } from '../harness/types';

const root = path.resolve(import.meta.dirname, '../../../..');

describe('evaluation planning and table semantics', () => {
  it('retains every condition, transport and paired comparison in a diagnostic profile', async () => {
    const relative = 'benchmarks/profiles/evaluation-2026-paper-v0.3.json';
    const original = await loadBenchmarkProfile(root, relative);
    const smoke = diagnosticProfile(original, path.join(root, relative));
    expect(smoke.workloads.map((workload) => workload.id)).toEqual(
      original.workloads.map((workload) => workload.id),
    );
    expect(smoke.comparisons).toEqual(original.comparisons);
    expect(smoke.encodings).toEqual(original.encodings);
    expect(smoke.validation).toEqual(original.validation);
    expect(smoke.repetitions).toBe(1);
    expect(smoke.requireCleanGit).toBe(false);
  });

  it('keeps kernel trajectories at 500 steps while shortening graphical action series', async () => {
    const relative = 'benchmarks/profiles/evaluation-2026-schelling-ui-js-v2.json';
    const smoke = diagnosticProfile(
      await loadBenchmarkProfile(root, relative),
      path.join(root, relative),
    );
    expect(smoke.workloads[0]!.measuredActions).toBe(1);
    expect(smoke.workloads[0]!.dimensions!.steps).toBe(500);
    expect(smoke.workloads[1]!.dimensions!.finalTick).toBe(3);
    const kernelPath = 'benchmarks/profiles/evaluation-2026-schelling-kernel-v2.json';
    const kernel = diagnosticProfile(
      await loadBenchmarkProfile(root, kernelPath),
      path.join(root, kernelPath),
    );
    expect(kernel.warmupActions).toBe(0);
    expect(kernel.measuredActions).toBe(1);
    for (const workload of kernel.workloads) {
      expect(workload.warmupActions).toBe(0);
      expect(workload.measuredActions).toBe(1);
    }
  });

  it('rejects ambiguous or missing table selectors instead of silently using a nearby run', () => {
    const artifact = { runs: [{ id: 'one' }, { id: 'one' }] } as unknown as BenchmarkArtifact;
    expect(() => selectRun(artifact, 'one')).toThrow(/exactly one/);
    expect(() => selectRun(artifact, 'missing')).toThrow(/exactly one/);
  });

  it('preserves CSV precision and escapes LaTeX text while labelling diagnostic output', () => {
    const table = {
      id: 'example',
      caption: 'A & B',
      columns: [
        { key: 'label', label: 'Label' },
        { key: 'value', label: 'Value' },
      ],
      rows: [{ label: 'A,"B"_C', value: 1.23456789 }],
    };
    expect(renderCsv(table)).toContain('"A,""B""_C",1.23456789');
    expect(renderTex(table, 'smoke')).toContain('A \\& B');
    expect(renderTex(table, 'smoke')).toContain('Diagnostic smoke data.');
    expect(renderTex(table, 'smoke')).toContain('1.235');
  });
});

describe('compressed evidence trust boundary', () => {
  it('rejects traversal and link members before creating an extraction directory', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tensnap-unsafe-archive-test-'));
    const context = executionContext(root, process.env.TENSNAP_TEST_PYTHON ?? 'python3');
    try {
      for (const kind of ['traversal', 'link']) {
        const archive = path.join(directory, `${kind}.tar.gz`);
        const output = path.join(directory, `${kind}-output`);
        await execute(
          context,
          context.python,
          [
            '-c',
            [
              'import io, sys, tarfile',
              'with tarfile.open(sys.argv[1], "w:gz") as archive:',
              '    member = tarfile.TarInfo("../escaped" if sys.argv[2] == "traversal" else "link")',
              '    if sys.argv[2] == "link":',
              '        member.type = tarfile.SYMTYPE',
              '        member.linkname = "../escaped"',
              '    archive.addfile(member, io.BytesIO())',
            ].join('\n'),
            archive,
            kind,
          ],
          { quiet: true },
        );
        await expect(
          archiveCommand(context, ['extract', '--input', archive, '--out', output]),
        ).rejects.toThrow(/unsafe archive path|unsupported or duplicate/);
        expect(await exists(output)).toBe(false);
        expect(await exists(path.join(directory, 'escaped'))).toBe(false);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('produces deterministic gzip bytes, checks inventory and rejects altered payloads', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tensnap-archive-test-'));
    const context = executionContext(root, process.env.TENSNAP_TEST_PYTHON ?? 'python3');
    try {
      const input = path.join(directory, 'input');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(input);
      await writeFile(path.join(input, 'sample.jsonl'), '{"sample":1}\n');
      const first = path.join(directory, 'first.tar.gz');
      const second = path.join(directory, 'second.tar.gz');
      for (const archive of [first, second])
        await archiveCommand(context, ['create', '--input', input, '--out', archive]);
      expect(await readFile(first)).toEqual(await readFile(second));
      const extracted = await withEvidence(context, first, (folder) =>
        readFile(path.join(folder, 'sample.jsonl'), 'utf8'),
      );
      expect(extracted).toBe('{"sample":1}\n');
      const altered = await readFile(first);
      altered[Math.floor(altered.length / 2)]! ^= 0xff;
      await writeFile(first, altered);
      await expect(archiveCommand(context, ['verify', '--input', first])).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
