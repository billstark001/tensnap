import path from 'node:path';
import { parseArgs } from 'node:util';
import { defaultSpecification, describePlan, loadSpecification } from './config';
import { inspectEnvironment, sourceIdentity } from './doctor';
import { readJson, repositoryRoot } from './files';
import { executionContext, prepareDirectories } from './process';
import { runBatch } from './run';
import { verifyBatch } from './verify';
import { exportBatch, pruneBatch } from './export';
import { extractEvidence } from './archive';
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
  pnpm evaluation run --out DIRECTORY [--smoke] [--gzip-level 0..9]
  pnpm evaluation resume --input DIRECTORY [--gzip-level 0..9]
  pnpm evaluation verify --input DIRECTORY_OR_TAR_GZ
  pnpm evaluation export --input DIRECTORY_OR_TAR_GZ --out DIRECTORY [--gzip-level 0..9]
  pnpm evaluation archive --input DIRECTORY --out DIRECTORY
  pnpm evaluation extract --input DIRECTORY_OR_TAR_GZ --out DIRECTORY [--figures-only]

Run executes every declared experiment sequentially, verifies all evidence,
exports data.tar.gz, figures.tar.gz and CSV/LaTeX tables, then removes raw copies.
No figures remain outside the archives. Gzip defaults to level 6.
Verify/export accept legacy evidence.tar.gz and paired data/figures archives.
Smoke is diagnostic: one replicate, short browser actions, two Fire/DQN episodes.
Resume validates the original source and environment before accepting prior work.
All commands accept --work-dir and --cache-dir. Defaults relative to the checkout:
  benchmark-results/.work   temporary extraction and runtime scratch space
  benchmark-results/.cache  Python bytecode, Go build and Vite caches
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
      'gzip-level': { type: 'string' },
      'figures-only': { type: 'boolean' },
      'work-dir': { type: 'string' },
      'cache-dir': { type: 'string' },
    },
  });
  const [command] = positionals;
  if (!command || values.help) {
    process.stdout.write(help);
    return;
  }
  if (positionals.length !== 1) throw new Error('Expected one evaluation command.');
  const gzipValue = values['gzip-level'];
  if (gzipValue !== undefined && !/^[0-9]$/.test(gzipValue))
    throw new Error('--gzip-level must be an integer from 0 through 9.');
  if (gzipValue !== undefined && !['run', 'resume', 'export', 'archive'].includes(command))
    throw new Error('--gzip-level applies to run, resume, export and archive.');
  if (values['figures-only'] && command !== 'extract')
    throw new Error('--figures-only applies to extract.');
  const exportOptions = { gzipLevel: gzipValue === undefined ? 6 : Number(gzipValue) };
  const root = await repositoryRoot();
  const context = executionContext(root, values.python, {
    workDirectory: values['work-dir'],
    cacheDirectory: values['cache-dir'],
  });
  context.signal = cancellation.signal;
  const specification = await loadSpecification(root, values.spec ?? defaultSpecification);
  const mode: EvaluationMode = values.smoke ? 'smoke' : 'publication';
  const input = values.input ? path.resolve(root, values.input) : undefined;
  const output = values.out ? path.resolve(root, values.out) : undefined;
  if (output) {
    for (const directory of [context.workDirectory, context.cacheDirectory]) {
      const relative = path.relative(output, directory);
      if (
        !relative ||
        (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
      )
        throw new Error('--work-dir and --cache-dir must be outside --out.');
    }
  }
  if (command !== 'plan') {
    await prepareDirectories(context);
    // Playwright creates scratch directories in this CLI process as well as in children.
    for (const name of ['TMPDIR', 'TMP', 'TEMP']) process.env[name] = context.workDirectory;
  }
  if (command === 'plan') {
    process.stdout.write((await describePlan(root, specification, mode)) + '\n');
  } else if (command === 'doctor') {
    process.stdout.write(
      JSON.stringify(
        {
          source: await sourceIdentity(context),
          environment: await inspectEnvironment(context, specification),
          directories: { work: context.workDirectory, cache: context.cacheDirectory },
        },
        null,
        2,
      ) + '\n',
    );
  } else if (command === 'run') {
    if (!output) throw new Error('run requires --out.');
    await runBatch(context, output, specification, mode, false, exportOptions);
  } else if (command === 'resume') {
    if (!input) throw new Error('resume requires --input.');
    const batch = await readJson<EvaluationBatch>(path.join(input, 'batch.json'));
    await runBatch(context, input, batch.specification, batch.mode, true, exportOptions);
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
    await exportBatch(context, input, output, exportOptions);
    if (values.prune) {
      await pruneBatch(context, input);
    }
    process.stdout.write(`Evaluation export: ${output}\n`);
  } else if (command === 'extract') {
    if (!input || !output) throw new Error('extract requires --input and --out.');
    await extractEvidence(context, input, output, values['figures-only']);
    process.stdout.write(`Evaluation extracted: ${output}\n`);
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
