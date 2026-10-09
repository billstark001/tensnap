import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BenchmarkArtifact, BenchmarkRun } from '../harness/types';
import { exists, readJson, writeJson } from './files';
import { readBenchmark } from './experiments';
import { workflowHosts } from './workflow';
import type { WorkflowReport } from './workflow';
import type { EvaluationBatch } from './types';

export interface ResultTable {
  id: string;
  caption: string;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number>[];
}
interface TableSelection {
  protocol: { operation: string; runId: string }[];
  schelling: {
    platform: string;
    kernelExperiment: string;
    kernelRun: string;
    uiExperiment: string;
    rafRun: string;
    timeoutRun: string;
  }[];
  conformance: { id: string; label: string }[];
}

export function selectRun(artifact: BenchmarkArtifact, id: string): BenchmarkRun {
  const runs = artifact.runs.filter((run) => run.id === id);
  if (runs.length !== 1) throw new Error(`Expected exactly one declared table run: ${id}`);
  return runs[0]!;
}
function metricMedian(run: BenchmarkRun, metric: string): number {
  if (run.execution.primaryMetric !== metric)
    throw new Error(
      `Unexpected measurement interval for ${run.id}: ${run.execution.primaryMetric}`,
    );
  const summary = metric === 'cycle' ? run.summary.cycle : run.summary.metrics[metric];
  if (!summary) throw new Error(`Missing metric ${metric} in ${run.id}`);
  return summary.medianMs;
}

export async function buildTables(
  root: string,
  evidence: string,
  batch: EvaluationBatch,
): Promise<ResultTable[]> {
  const storedSelection = path.join(evidence, 'table-selection.json');
  const selection = await readJson<TableSelection>(
    (await exists(storedSelection))
      ? storedSelection
      : path.join(root, 'benchmarks/evaluation/tables.json'),
  );
  const tables: ResultTable[] = [];
  const has = (id: string) =>
    batch.specification.experiments.some((experiment) => experiment.id === id);
  if (has('protocol-core')) {
    const artifact = await readBenchmark(path.join(evidence, 'raw/protocol-core'));
    tables.push({
      id: 'protocol-stages',
      caption:
        'Protocol/core costs. Median and P95 are measured-action statistics; recording/restoration is a compound workflow.',
      columns: [
        { key: 'operation', label: 'Operation' },
        { key: 'medianMs', label: 'Median (ms)' },
        { key: 'p95Ms', label: 'P95 (ms)' },
      ],
      rows: selection.protocol.map(({ operation, runId }) => {
        const run = selectRun(artifact, runId);
        return {
          operation,
          runId,
          medianMs: run.summary.cycle.medianMs,
          p95Ms: run.summary.cycle.p95Ms,
        };
      }),
    });
    const recording = selectRun(artifact, 'snapshot-restore-10k|node|-|-');
    tables.push({
      id: 'recording-storage',
      caption: 'Storage from the compound recording/restoration workflow; MB uses decimal bytes.',
      columns: [
        { key: 'medianBytes', label: 'Median archive bytes' },
        { key: 'medianMB', label: 'Median archive MB' },
        { key: 'medianSegments', label: 'Median segments' },
      ],
      rows: [
        {
          medianBytes: recording.summary.metrics.archiveBytes!.medianMs,
          medianMB: recording.summary.metrics.archiveBytes!.medianMs / 1_000_000,
          medianSegments: recording.summary.metrics.archiveSegments!.medianMs,
        },
      ],
    });
  }
  if (selection.schelling.every((row) => has(row.kernelExperiment) && has(row.uiExperiment))) {
    const rows = [];
    for (const row of selection.schelling) {
      const kernel = selectRun(
        await readBenchmark(path.join(evidence, 'raw', row.kernelExperiment)),
        row.kernelRun,
      );
      const steps = kernel.execution.dimensions?.steps;
      if (typeof steps !== 'number' || steps <= 0)
        throw new Error(`Kernel table requires its declared step count: ${kernel.id}`);
      const ui = await readBenchmark(path.join(evidence, 'raw', row.uiExperiment));
      rows.push({
        platform: row.platform,
        modelStepMs: metricMedian(kernel, 'cycle') / steps,
        rafMs: metricMedian(selectRun(ui, row.rafRun), 'actionToRenderCompleteMs'),
        timeoutMs: metricMedian(selectRun(ui, row.timeoutRun), 'actionToRunCompletionMs'),
        kernelSteps: steps,
      });
    }
    tables.push({
      id: 'schelling-routes',
      caption:
        'Model-step medians are replicate-average step times. rAF and timeout are distinct graphical action intervals.',
      columns: [
        { key: 'platform', label: 'Platform' },
        { key: 'modelStepMs', label: 'Model step (ms)' },
        { key: 'rafMs', label: 'rAF interval (ms)' },
        { key: 'timeoutMs', label: 'Timeout interval (ms)' },
      ],
      rows,
    });
  }
  if (has('conformance')) {
    const results = await readJson<{
      runs: { binding: string; encoding: string; rows: Record<string, { status: string }> }[];
    }>(path.join(evidence, 'raw/conformance/results.json'));
    const bindings = ['python', 'go', 'js', 'julia'];
    const count = (property: string, binding: string) => {
      const runs = results.runs.filter((run) => run.binding === binding);
      if (runs.length !== 2 || new Set(runs.map((run) => run.encoding)).size !== 2)
        throw new Error('Incomplete conformance encoding coverage.');
      return `pass ${runs.filter((run) => run.rows[property]?.status === 'pass').length}/2`;
    };
    const columns = [
      { key: 'property', label: 'Property' },
      ...bindings.map((binding) => ({ key: binding, label: binding })),
    ];
    const rowsFor = (properties: { id: string; label: string }[]) =>
      properties.map((property) => ({
        property: property.label,
        ...Object.fromEntries(bindings.map((binding) => [binding, count(property.id, binding)])),
      }));
    tables.push({
      id: 'conformance',
      caption: 'Two encodings per binding, not independent trials.',
      columns,
      rows: rowsFor(selection.conformance),
    });
    tables.push({
      id: 'conformance-full',
      caption: 'All sixteen conformance properties.',
      columns,
      rows: rowsFor(Object.keys(results.runs[0]!.rows).map((id) => ({ id, label: id }))),
    });
  }
  if (has('schelling-workflow')) {
    const rows = [];
    for (const host of workflowHosts) {
      const report = await readJson<WorkflowReport>(
        path.join(evidence, 'raw/schelling-workflow', host, 'report.json'),
      );
      rows.push({
        host,
        restore: report.exactRestore.pass ? 'equal 1/1' : 'fail',
        rerun: `match ${report.deterministicFuture.replay.length}/3`,
        branches: '2 x 6, different',
        outputs: 'JSON, PNG',
      });
    }
    tables.push({
      id: 'schelling-workflow',
      caption: 'One checkpoint comparison, three rerun points, and two six-step branches per host.',
      columns: [
        { key: 'host', label: 'Host' },
        { key: 'restore', label: 'Restored audit state' },
        { key: 'rerun', label: 'Rerun' },
        { key: 'branches', label: 'Threshold branches' },
        { key: 'outputs', label: 'Retained outputs' },
      ],
      rows,
    });
  }
  if (has('fire-dqn')) {
    const directory = path.join(evidence, 'raw/fire-dqn');
    const manifest = await readJson<{ referenceEpisodes: number; stabilityEpisodes: number }>(
      path.join(directory, 'manifest.json'),
    );
    const summary = await readJson<Record<string, Record<string, Record<string, number>>>>(
      path.join(directory, 'summary.json'),
    );
    const reference = summary[`reference${manifest.referenceEpisodes}`]!;
    tables.push({
      id: 'fire-reference',
      caption: 'Policy comparison on common evaluation cases.',
      columns: [
        { key: 'policy', label: 'Policy' },
        { key: 'episodes', label: 'Episodes' },
        { key: 'evacuated', label: 'Mean evacuated' },
        { key: 'dead', label: 'Mean dead' },
      ],
      rows: Object.entries(reference).map(([policy, row]) => ({
        policy,
        episodes: row.episodes!,
        evacuated: row.evacuated!,
        dead: row.dead!,
      })),
    });
    const stability = summary[`stability${manifest.stabilityEpisodes}`]!.dqnAcrossTrainingSeeds!;
    tables.push({
      id: 'fire-stability',
      caption: 'Uncertainty across training-seed means on a shared holdout.',
      columns: [
        { key: 'meanEvacuated', label: 'Mean evacuated' },
        { key: 'sampleSdEvacuated', label: 'Sample SD across training seeds' },
      ],
      rows: [
        {
          meanEvacuated: stability.meanEvacuated!,
          sampleSdEvacuated: stability.sampleSdEvacuated!,
        },
      ],
    });
  }
  return tables;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export function renderCsv(table: ResultTable): string {
  const rows = [
    table.columns.map((column) => column.label),
    ...table.rows.map((row) => table.columns.map((column) => row[column.key]!)),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}
function texEscape(value: string | number): string {
  const text =
    typeof value === 'number'
      ? Number.isInteger(value)
        ? String(value)
        : value.toFixed(3)
      : value;
  const escaped: Record<string, string> = {
    '\\': '\\textbackslash{}',
    '&': '\\&',
    '%': '\\%',
    $: '\\$',
    '#': '\\#',
    _: '\\_',
    '{': '\\{',
    '}': '\\}',
    '~': '\\textasciitilde{}',
    '^': '\\textasciicircum{}',
  };
  return text.replace(/[\\&%$#_{}~^]/g, (character) => escaped[character]!);
}
export function renderTex(table: ResultTable, mode: string): string {
  const rows = table.rows.map(
    (row) => table.columns.map((column) => texEscape(row[column.key]!)).join(' & ') + ' \\\\',
  );
  return [
    `% Generated evidence table; mode=${mode}. Requires booktabs, tabularx and array.`,
    '\\begin{table}[htbp]',
    '\\centering',
    '\\small',
    `\\caption{${texEscape(table.caption)}${mode === 'smoke' ? ' Diagnostic smoke data.' : ''}}`,
    `\\label{tab:${table.id}}`,
    `\\begin{tabularx}{\\linewidth}{${table.columns.map((column) => (table.rows.every((row) => typeof row[column.key] === 'number') ? '>{\\raggedleft\\arraybackslash}X' : '>{\\raggedright\\arraybackslash}X')).join('')}}`,
    '\\toprule',
    table.columns.map((column) => texEscape(column.label)).join(' & ') + ' \\\\',
    '\\midrule',
    ...rows,
    '\\bottomrule',
    '\\end{tabularx}',
    '\\end{table}',
    '',
  ].join('\n');
}

export async function writeTables(
  directory: string,
  tables: ResultTable[],
  batch: EvaluationBatch,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeJson(path.join(directory, 'results.json'), {
    mode: batch.mode,
    source: batch.source,
    tables,
  });
  for (const table of tables) {
    await writeFile(path.join(directory, `${table.id}.csv`), renderCsv(table));
    await writeFile(path.join(directory, `${table.id}.tex`), renderTex(table, batch.mode));
  }
}
