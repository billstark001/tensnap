import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { cpus, platform, release } from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type CDPSession, type Page } from 'playwright';
import { workload } from '../../../../benchmarks/schelling/tensnap-web-external';
import { option } from '../cli-options';
import {
  allocateLoopbackPort,
  sha256,
  startBrowserServer,
  startExternalServer,
  waitForWebSocketEndpoint,
  withTimeout,
} from '../node/runner';
import type { BrowserBenchmarkStats } from '../browser-types';
import { installTimeoutProbes } from './browser-probe';
import { summarizeTimeoutTrace, type ServerTrace } from './trace';

const root = path.resolve(import.meta.dirname, '../../../..');
const args = process.argv.slice(2);
function integer(name: string, fallback: number): number {
  const value = Number(option(args, name) ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer.`);
  return value;
}
function fileHash(contents: Uint8Array): string {
  return createHash('sha256').update(contents).digest('hex');
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function capture(page: Page) {
  return withTimeout(
    page.evaluate(() => ({
      result: window.__TENSNAP_BENCHMARK_RESULT__ as
        | { ok: boolean; error?: string; snapshot?: unknown; stats?: BrowserBenchmarkStats }
        | undefined,
      request: window.__TENSNAP_BENCHMARK_REQUEST__,
      trace: window.__TENSNAP_TIMEOUT_TRACE__,
      visibility: document.visibilityState,
      userAgent: navigator.userAgent,
      timeOrigin: performance.timeOrigin,
    })),
    'Browser diagnostic capture',
    5_000,
  );
}
const output = option(args, '--out');
if (!output) throw new Error('diagnose:timeout requires a fresh --out directory.');
if (platform() === 'win32') throw new Error('The Python resource/SIGTERM probes require POSIX.');
const directory = path.resolve(root, output);
const repetitions = integer('--repetitions', 4);
const totalActions = integer('--actions', 500);
const warmupActions = 5;
if (totalActions <= warmupActions)
  throw new Error('--actions must exceed the five warmup actions.');
const measuredActions = totalActions - warmupActions;
const policy = option(args, '--server-policy') ?? 'default';
if (!['default', 'utility', 'background'].includes(policy))
  throw new Error('Unknown --server-policy.');
if (policy !== 'default' && platform() !== 'darwin')
  throw new Error('Controlled taskpolicy experiments require macOS.');
const chromiumTrace = !args.includes('--no-chromium-trace');
const validation = option(args, '--validation') ?? 'error';
if (validation !== 'off' && validation !== 'error')
  throw new Error('--validation must be off or error.');
const modelSource = path.resolve(
  root,
  option(args, '--model-source') ?? 'examples/python_mesa/schelling.py',
);
const modelContents = await readFile(modelSource);
const modelSha256 = fileHash(modelContents);
const profileFile = 'benchmarks/profiles/evaluation-2026-schelling-ui-mesa-v2.json';
const profile = JSON.parse(await readFile(path.join(root, profileFile), 'utf8')) as {
  workloads: { id: string; config: Parameters<typeof workload.resolveConfig>[0] }[];
};
const entry = profile.workloads.find((candidate) => candidate.id === 'mesa-tensnap-web-timeout');
if (!entry) throw new Error('Mesa timeout profile entry is missing.');
const config = workload.resolveConfig(entry.config);
const runOptions = {
  renderTriggerMode: 'setTimeout' as const,
  maxTps: 0,
  maxRenderFps: 0,
  diagnostics: true,
};
const subjectHash = sha256({
  config,
  warmupActions,
  measuredActions,
  runOptions,
  validation,
  modelSha256,
});
const source = {
  gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  diffSha256: fileHash(execFileSync('git', ['diff', '--binary'], { cwd: root })),
};
const instrumentFiles = [
  'packages/benchmark/src/diagnostics/timeout-cadence.ts',
  'packages/benchmark/src/diagnostics/browser-probe.ts',
  'packages/benchmark/src/diagnostics/trace.ts',
  'benchmarks/diagnostics/mesa/sitecustomize.py',
];
const instrumentSha256 = Object.fromEntries(
  await Promise.all(
    instrumentFiles.map(async (file) => [file, fileHash(await readFile(path.join(root, file)))]),
  ),
);
const runs: Record<string, unknown>[] = [];
const manifest = {
  schemaVersion: 2,
  diagnosticOnly: true,
  status: 'running',
  error: undefined as string | undefined,
  source,
  instrumentSha256,
  modelSource,
  modelSha256,
  validation,
  subjectHash,
  config,
  runOptions,
  policy,
  warmupActions,
  measuredActions,
  platform: platform(),
  release: release(),
  cpu: cpus()[0]?.model,
  node: process.version,
  runs,
};
await mkdir(directory); // Refuse to replace retained evidence.
await writeFile(path.join(directory, 'model.py'), modelContents);
const saveManifest = () =>
  writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
await saveManifest();
// Vite/Lingui resolve their configuration from this working directory.
process.chdir(path.join(root, 'packages/benchmark'));
let ui: Awaited<ReturnType<typeof startBrowserServer>> | undefined;
let failure: unknown;
try {
  ui = await startBrowserServer(root);
  for (let index = 0; index < repetitions; index++) {
    const id = String(index).padStart(2, '0');
    const context = { repositoryRoot: root, replicate: 0, warmupActions, measuredActions };
    const spec = workload.createExternalBrowserSpec(config, {
      ...context,
      port: await allocateLoopbackPort(),
    });
    const serverTraceFile = path.join(directory, `${id}-server.json`);
    const command = {
      ...spec.server,
      env: {
        ...spec.server.env,
        PYTHONPATH: `${path.join(root, 'benchmarks/diagnostics/mesa')}${path.delimiter}${spec.server.env?.PYTHONPATH ?? ''}`,
        TENSNAP_TIMEOUT_MODEL_SOURCE: path.join(directory, 'model.py'),
        TENSNAP_TIMEOUT_SERVER_TRACE: serverTraceFile,
      },
    };
    const run: Record<string, unknown> = { index, status: 'running', subjectHash };
    runs.push(run);
    const server = startExternalServer(
      policy === 'default'
        ? command
        : {
            ...command,
            executable: '/usr/sbin/taskpolicy',
            args: ['-c', policy, command.executable, ...command.args],
          },
    );
    let browser: Browser | undefined;
    let page: Page | undefined;
    let cdp: CDPSession | undefined;
    let tracing = false;
    let captured: Awaited<ReturnType<typeof capture>> | undefined;
    const events: unknown[] = [];
    const pageErrors: string[] = [];
    const errors: unknown[] = [];
    try {
      await waitForWebSocketEndpoint(spec.tensnapHarness!.endpoint, 120_000, server);
      const ready = JSON.parse(await readFile(serverTraceFile, 'utf8'));
      if (
        ready.status !== 'ready' ||
        ready.schemaVersion !== 2 ||
        ready.modelSha256 !== modelSha256
      )
        throw new Error('Python probes did not load the requested model snapshot.');
      browser = await chromium.launch({ headless: true });
      run.browserVersion = browser.version();
      const browserContext = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      });
      page = await browserContext.newPage();
      page.on('pageerror', (error) => pageErrors.push(error.message));
      if (chromiumTrace) {
        cdp = await browserContext.newCDPSession(page);
        cdp.on('Tracing.dataCollected', (event) => events.push(...event.value));
        await cdp.send('Tracing.start', {
          categories: 'devtools.timeline,v8,blink.user_timing,renderer.scheduler',
          transferMode: 'ReportEvents',
        });
        tracing = true;
      }
      await page.addInitScript(installTimeoutProbes);
      await page.addInitScript(
        (request) => {
          window.__TENSNAP_BENCHMARK_REQUEST__ = request;
        },
        {
          ...spec.tensnapHarness!,
          validation: validation as 'off' | 'error',
          warmupActions,
          measuredActions,
          browserOptions: runOptions,
        },
      );
      await page.goto(new URL('browser-runner.html', ui.pageUrl).href, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(
        () => window.__TENSNAP_BENCHMARK_RESULT__ !== undefined,
        undefined,
        { timeout: 120_000 },
      );
      captured = await capture(page);
    } catch (error) {
      errors.push(error);
    } finally {
      // Preserve partial evidence on errors as well as successful runs.
      if (page && !captured) {
        try {
          captured = await capture(page);
        } catch (error) {
          errors.push(error);
        }
      }
      if (cdp && tracing) {
        try {
          const completed = new Promise<void>((resolve) =>
            cdp!.once('Tracing.tracingComplete', () => resolve()),
          );
          await withTimeout(
            Promise.all([cdp.send('Tracing.end'), completed]),
            'Chromium diagnostic flush',
            5_000,
          );
          run.chromiumTraceComplete = true;
        } catch (error) {
          run.chromiumTraceComplete = false;
          errors.push(error);
        }
      }
      const cleanup = await Promise.allSettled([
        browser ? withTimeout(browser.close(), 'Diagnostic browser shutdown', 10_000) : undefined,
        server.stop(),
      ]);
      for (const result of cleanup) if (result.status === 'rejected') errors.push(result.reason);
      const writes = await Promise.allSettled([
        captured
          ? writeFile(
              path.join(directory, `${id}-browser.json.gz`),
              gzipSync(JSON.stringify({ ...captured, pageErrors })),
            )
          : undefined,
        tracing
          ? writeFile(
              path.join(directory, `${id}-chromium.json.gz`),
              gzipSync(JSON.stringify({ traceEvents: events })),
            )
          : undefined,
        writeFile(path.join(directory, `${id}-stderr.txt`), server.stderr()),
      ]);
      for (const result of writes) if (result.status === 'rejected') errors.push(result.reason);
    }
    try {
      if (errors.length) throw new AggregateError(errors, errors.map(errorMessage).join('\n'));
      if (pageErrors.length) throw new Error(pageErrors.join('\n'));
      if (!captured?.result?.ok || !captured.result.stats || !captured.trace)
        throw new Error(captured?.result?.error ?? 'Incomplete browser diagnostic result.');
      const stats = captured.result.stats;
      if (
        stats.effectiveValidation?.send !== validation ||
        stats.effectiveValidation.receive !== validation
      )
        throw new Error('Effective frontend validation differs from the request.');
      if (stats.completedFrames !== totalActions || stats.measuredFrames !== measuredActions)
        throw new Error('Incorrect action count.');
      const correctness = workload.validateExternalBrowserObservation!(
        config,
        {
          initialRevision: 0,
          finalRevision: totalActions,
          initialState: null,
          finalState: captured.result.snapshot ?? stats.snapshot,
        },
        context,
      );
      const serverTrace = JSON.parse(await readFile(serverTraceFile, 'utf8')) as ServerTrace & {
        status: string;
      };
      if (serverTrace.status !== 'stopped') throw new Error('Python trace was not finalized.');
      Object.assign(run, {
        status: 'passed',
        effectiveValidation: stats.effectiveValidation,
        stateHash: sha256(correctness.state),
        summary: summarizeTimeoutTrace(stats, captured.trace, serverTrace, warmupActions),
      });
      process.stdout.write(`${JSON.stringify(run)}\n`);
    } catch (error) {
      run.status = 'failed';
      run.error = errorMessage(error);
      throw error;
    } finally {
      await saveManifest();
    }
  }
  manifest.status = 'passed';
} catch (error) {
  manifest.status = 'failed';
  manifest.error = errorMessage(error);
  failure = error;
} finally {
  try {
    await ui?.close();
  } catch (error) {
    manifest.status = 'failed';
    manifest.error = [manifest.error, errorMessage(error)].filter(Boolean).join('\n');
    failure ??= error;
  }
  try {
    await saveManifest();
  } catch (error) {
    failure ??= error;
  }
}
if (failure !== undefined) throw failure;
