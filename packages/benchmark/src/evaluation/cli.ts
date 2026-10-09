import path from 'node:path';
import { parseArgs } from 'node:util';
import { defaultSpecification, describePlan, loadSpecification } from './config';
import { inspectEnvironment, sourceIdentity } from './doctor';
import { readJson, repositoryRoot } from './files';
import { executionContext } from './process';
import { runBatch } from './run';
import { verifyBatch } from './verify';
import { exportBatch, pruneBatch } from './export';
import type { EvaluationBatch, EvaluationMode } from './types';

const cancellation = new AbortController();
const cancel = () =>
  cancellation.abort(
    new Error('Evaluation cancelled; verified completed work is retained for resume.'),
  );
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);

const help = `TenSnap paper evaluation

  pnpm evaluation plan [--smoke] [--spec PATH]
  pnpm evaluation doctor [--python PATH]
  pnpm evaluation run --out DIRECTORY [--smoke]
  pnpm evaluation resume --input DIRECTORY
  pnpm evaluation verify --input DIRECTORY_OR_TAR_GZ
  pnpm evaluation export --input DIRECTORY_OR_TAR_GZ --out DIRECTORY
  pnpm evaluation archive --input DIRECTORY --out DIRECTORY

Run executes every declared experiment sequentially, verifies all evidence,
exports deterministic gzip evidence and CSV/LaTeX tables, then removes raw copies.
Smoke is diagnostic: one replicate, short browser actions, two Fire/DQN episodes.
Resume validates the original source and environment before accepting prior work.
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      spec: { type: 'string' },
      python: { type: 'string' },
      out: { type: 'string' },
      input: { type: 'string' },
      smoke: { type: 'boolean' },
      help: { type: 'boolean' },
      prune: { type: 'boolean' },
    },
  });
  const [command] = positionals;
  if (!command || values.help) {
    process.stdout.write(help);
    return;
  }
  if (positionals.length !== 1) throw new Error('Expected one evaluation command.');
  const root = await repositoryRoot();
  const context = executionContext(root, values.python);
  context.signal = cancellation.signal;
  const specification = await loadSpecification(root, values.spec ?? defaultSpecification);
  const mode: EvaluationMode = values.smoke ? 'smoke' : 'publication';
  const input = values.input ? path.resolve(root, values.input) : undefined;
  const output = values.out ? path.resolve(root, values.out) : undefined;
  if (command === 'plan') {
    process.stdout.write((await describePlan(root, specification, mode)) + '\n');
  } else if (command === 'doctor') {
    process.stdout.write(
      JSON.stringify(
        {
          source: await sourceIdentity(context),
          environment: await inspectEnvironment(context, specification),
        },
        null,
        2,
      ) + '\n',
    );
  } else if (command === 'run') {
    if (!output) throw new Error('run requires --out.');
    await runBatch(context, output, specification, mode, false);
  } else if (command === 'resume') {
    if (!input) throw new Error('resume requires --input.');
    const batch = await readJson<EvaluationBatch>(path.join(input, 'batch.json'));
    await runBatch(context, input, batch.specification, batch.mode, true);
  } else if (command === 'verify') {
    if (!input) throw new Error('verify requires --input.');
    const batch = await verifyBatch(context, input);
    process.stdout.write(
      `Evaluation verified: ${batch.specification.id} (${batch.mode}). No hosts or training started.\n`,
    );
  } else if (command === 'export' || command === 'archive') {
    if (!input || !output) throw new Error(`${command} requires --input and --out.`);
    if (values.prune && output !== path.join(input, 'export'))
      throw new Error('--prune requires the batch export destination INPUT/export.');
    await exportBatch(context, input, output);
    if (values.prune) {
      await pruneBatch(context, input);
    }
    process.stdout.write(`Evaluation export: ${output}\n`);
  } else throw new Error(`Unknown command: ${command}`);
}

await main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  });
