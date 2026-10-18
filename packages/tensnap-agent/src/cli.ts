import { NodeRecordingStore } from './runtime/NodeRecordingStore';
import { validateCollectionConfig, compileRunCondition } from '@tensnap/core/runtime';
import { ArtifactInputError, isFileSystemFailure } from './runtime/artifact-errors';
import {
  readRecording,
  readRecordingBoundary,
  inspectRecordingBoundary,
  withRecordingStore,
  monitorStoreHistory,
  isRecordingStore,
  renderRecordingFrame,
  exportRecordingFrame,
} from './runtime/recording-files';
import { readCapturedFrame, compareCapturedFrames, FrameSaveError } from './runtime/frame-files';
import {
  RecordingStoreWriter,
  rebuildRecordingStoreIndex,
  type RecordingSelection,
} from '@tensnap/core/persistence';
import { monitorHistory, diffCapturedFrames, ComparisonPolicySchema } from '@tensnap/core/snapshot';
import { ScenarioQuerySchema, type ScenarioQuery } from '@tensnap/core/scenario';
import type { SceneRenderOptions } from './types';
import { RenderBatchError } from './runtime/painter';
import { DaemonStartupError, startDetachedDaemon } from './runtime/daemon-startup';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  isProcessAlive,
  readRuntimeControl,
  resolveRuntimeContextPaths,
  type RuntimeContextPaths,
} from './runtime/context';
import { listenerUrl } from '@tensnap/network';
import { Argument, Command, CommanderError, Help, Option } from 'commander';

import {
  addOptions,
  CliInputError,
  jsonOption,
  numericOption,
  startupOptions,
  imageOptions,
  selectionOptions,
  type CliOptions,
} from './cli-options';
import { CLI_VERSION, listSkills, installBundledSkills, SkillPersistenceError } from './skills';

const DEFAULT_RUNTIME_READY_TIMEOUT_MS = 10000;

function parseJsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function buildBaseUrl(control: { host: string; controlPort: number | null }): string {
  if (!control.controlPort) {
    throw new Error('Runtime control port is not available.');
  }
  return listenerUrl({ address: control.host, port: control.controlPort }, 'http');
}

async function resolveRunningRuntime(
  context: RuntimeContextPaths,
  signal?: AbortSignal,
): Promise<{ baseUrl: string } | null> {
  const control = await readRuntimeControl(context);
  if (!control?.controlPort) {
    return null;
  }

  try {
    const response = await fetch(`${buildBaseUrl(control)}/health`, { signal });
    await response.body?.cancel();
    if (!response.ok) {
      return null;
    }
    return { baseUrl: buildBaseUrl(control) };
  } catch {
    return null;
  }
}

async function requestJson(baseUrl: string, path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const raw = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      body = { error: raw };
    }
    throw new CliRequestError(response.status, body);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function requestWait(
  baseUrl: string,
  identity: { requestId: string } | { runId: string },
  body: { timeoutMs?: number; until?: 'settled' | 'persisted' },
): Promise<unknown> {
  const path =
    'requestId' in identity
      ? `/v1/action-results/${encodeURIComponent(identity.requestId)}/wait`
      : `/v1/runs/${encodeURIComponent(identity.runId)}/wait`;
  try {
    return await requestJson(baseUrl, path, { method: 'POST', body: JSON.stringify(body) });
  } catch (cause) {
    throw new CliWaitError(cause, identity);
  }
}

async function waitForDaemon(
  context: RuntimeContextPaths,
  timeoutMs = 5000,
  signal?: AbortSignal,
): Promise<{ baseUrl: string }> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const pollingSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    for (;;) {
      pollingSignal.throwIfAborted();
      const running = await resolveRunningRuntime(context, pollingSignal);
      if (running) return running;
      await delay(100, undefined, { signal: pollingSignal });
    }
  } catch (cause) {
    if (!deadline.aborted || signal?.aborted) throw cause;
    throw new Error(`Timed out waiting for runtime daemon in context ${context.contextName}.`, {
      cause,
    });
  }
}

function resolveRuntimeContextPathsFromOptions(options: CliOptions): RuntimeContextPaths {
  return resolveRuntimeContextPaths({
    contextName: options.context,
    rootDir: options.contextDir,
  });
}

async function startForegroundDaemon(options: CliOptions): Promise<void> {
  // Metadata, skill installs, and HTTP clients do not need native headless painters.
  const { AgentRuntime, HeadlessEnvironmentPainter, HeadlessChartPainter, RuntimeControlServer } =
    await import('./index');
  const context = resolveRuntimeContextPathsFromOptions(options);
  const controlPort = options.port;

  const runtime = new AgentRuntime(context, {
    ip_family: options.ipFamily ?? 'auto',
    host: options.host,
    controlPort,
    encoding: options.encoding ?? 'msgpack',
    clientMessageValidation: options.clientMessageValidation,
    serverMessageValidation: options.serverMessageValidation,
    maxRunStepsPolicy: options.maxStepsPolicy,
    render: {
      trigger: options.renderTrigger ?? 'manual',
      backgroundColor: options.backgroundColor,
    },
  });
  const server = new RuntimeControlServer(runtime, {
    ip_family: options.ipFamily ?? 'auto',
    host: options.host,
    port: controlPort,
  });
  try {
    await runtime.initialize();
    runtime.registerPainter(
      new HeadlessEnvironmentPainter({
        capturesDir: context.capturesDir,
        defaultFormat: 'png',
        backgroundColor: options.backgroundColor,
      }),
    );
    runtime.registerPainter(
      new HeadlessChartPainter({
        capturesDir: context.capturesDir,
        defaultFormat: 'png',
      }),
    );

    const address = await server.listen();

    const simulatorUrl = options.simulatorUrl;
    if (simulatorUrl) {
      await runtime.connect({
        ip_family: options.ipFamily ?? 'auto',
        simulatorUrl,
        encoding: options.encoding ?? 'msgpack',
        clientMessageValidation: options.clientMessageValidation,
        serverMessageValidation: options.serverMessageValidation,
      });
      await runtime.waitUntilReady(DEFAULT_RUNTIME_READY_TIMEOUT_MS);
    }

    printJson(options, {
      status: runtime.getStatus(),
      control: address,
    });
  } catch (error) {
    const cleanup = await Promise.allSettled([runtime.stop(), server.close()]);
    const failures = cleanup
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    if (failures.length)
      throw new AggregateError(
        [error, ...failures],
        `${error instanceof Error ? error.message : String(error)}; daemon startup cleanup failed.`,
        { cause: error },
      );
    throw error;
  }

  const shutdown = async (): Promise<void> => {
    await runtime.stop();
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

async function startBackgroundDaemon(options: CliOptions): Promise<void> {
  const ipFamily = options.ipFamily ?? 'auto';
  const port = options.port;
  const context = resolveRuntimeContextPathsFromOptions(options);

  const running = await resolveRunningRuntime(context, AbortSignal.timeout(5000));
  if (running) {
    printJson(options, await requestJson(running.baseUrl, '/v1/runtime/status'));
    return;
  }

  const modulePath = fileURLToPath(import.meta.url);
  const isSourceEntry = modulePath.endsWith('.ts');
  const scriptPath = isSourceEntry
    ? fileURLToPath(new URL('./bin.ts', import.meta.url))
    : modulePath;
  const childArgs = [
    // Keep the same policy for the simulator connection and local control listener.
    ...(isSourceEntry
      ? ['--import', fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url))]
      : process.execArgv),
    scriptPath,
    'daemon',
    'serve',
    '--context',
    context.contextName,
    '--context-dir',
    context.rootDir,
    '--render-trigger',
    options.renderTrigger ?? 'manual',
  ];

  const simulatorUrl = options.simulatorUrl;
  childArgs.push('--ip-family', ipFamily);
  if (simulatorUrl) {
    childArgs.push('--simulator-url', simulatorUrl);
  }

  const host = options.host;
  if (host) {
    childArgs.push('--host', host);
  }

  if (port !== undefined) {
    childArgs.push('--port', String(port));
  }

  const encoding = options.encoding;
  if (encoding) {
    childArgs.push('--encoding', encoding);
  }

  const backgroundColor = options.backgroundColor;
  if (backgroundColor) {
    childArgs.push('--background-color', backgroundColor);
  }

  const maxStepsPolicy = options.maxStepsPolicy;
  if (maxStepsPolicy !== undefined) {
    childArgs.push('--max-steps-policy', String(maxStepsPolicy));
  }

  for (const [flag, level] of [
    ['client-message-validation', options.clientMessageValidation],
    ['server-message-validation', options.serverMessageValidation],
  ] as const) {
    if (level !== undefined) childArgs.push(`--${flag}`, level);
  }

  const status = await startDetachedDaemon(process.execPath, childArgs, {
    cwd: context.cwd,
    stderrPath: join(context.logsDir, 'daemon.stderr.log'),
    waitUntilReady: async (signal) => {
      const ready = await waitForDaemon(context, 5000, signal);
      const deadline = AbortSignal.timeout(DEFAULT_RUNTIME_READY_TIMEOUT_MS);
      const readinessSignal = AbortSignal.any([signal, deadline]);
      try {
        if (simulatorUrl) {
          await requestJson(ready.baseUrl, '/v1/runtime/wait-ready', {
            method: 'POST',
            body: JSON.stringify({ timeoutMs: DEFAULT_RUNTIME_READY_TIMEOUT_MS }),
            signal: readinessSignal,
          });
        }
        return await requestJson(ready.baseUrl, '/v1/runtime/status', { signal: readinessSignal });
      } catch (cause) {
        if (deadline.aborted && !signal.aborted)
          throw new Error('Timed out waiting for runtime readiness.', { cause });
        throw cause;
      }
    },
  });
  printJson(options, status);
}

async function stopDaemon(options: CliOptions): Promise<void> {
  const context = resolveRuntimeContextPathsFromOptions(options);
  const running = await resolveRunningRuntime(context);
  if (running) {
    const result = await requestJson(running.baseUrl, '/v1/runtime/stop', { method: 'POST' });
    if (options.outputVersion === '1') printJson(options, result);
    return;
  }

  const control = await readRuntimeControl(context);
  if (control?.pid && isProcessAlive(control.pid)) {
    process.kill(control.pid, 'SIGTERM');
    if (options.outputVersion === '1') printJson(options, { stopping: true });
    return;
  }

  throw new Error(`No running daemon found for context ${context.contextName}.`);
}

async function printStatus(options: CliOptions): Promise<void> {
  const context = resolveRuntimeContextPathsFromOptions(options);
  const running = await resolveRunningRuntime(context);
  if (running) {
    printJson(options, await requestJson(running.baseUrl, '/v1/runtime/status'));
    return;
  }

  const control = await readRuntimeControl(context);
  printJson(options, control ?? { context: context.contextName, running: false });
}

async function printLogs(options: CliOptions): Promise<void> {
  const context = resolveRuntimeContextPathsFromOptions(options);
  try {
    const raw = await readFile(context.logFile, 'utf8');
    emitText(options, raw);
  } catch {
    emitText(options, '');
  }
}

async function requireRuntime(
  options: CliOptions,
): Promise<{ context: RuntimeContextPaths; baseUrl: string }> {
  const context = resolveRuntimeContextPathsFromOptions(options);
  const running = await resolveRunningRuntime(context);
  if (!running) {
    throw new Error(`No running daemon found for context ${context.contextName}.`);
  }
  return { context, baseUrl: running.baseUrl };
}

async function streamEvents(options: CliOptions): Promise<void> {
  const { baseUrl } = await requireRuntime(options);
  const response = await fetch(`${baseUrl}/v1/events`);
  if (!response.ok || !response.body) {
    throw new Error('Unable to open event stream.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary === -1) {
        break;
      }

      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = chunk
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n');
      if (!data) {
        continue;
      }
      printJson(options, JSON.parse(data));
    }
  }
}

/** Build a fresh command tree so repeated in-process invocations never share option state. */
export function createProgram(
  writeText: (text: string) => void = (text) => process.stdout.write(text),
): Command {
  const program = new Command()
    .name('tensnap-agent')
    .description('Headless TenSnap simulator control, rendering, and offline skills.')
    .helpCommand(false)
    .exitOverride()
    .showSuggestionAfterError(false)
    .configureHelp({
      showGlobalOptions: true,
      visibleGlobalOptions(command) {
        return Help.prototype.visibleGlobalOptions
          .call(this, command)
          .filter(
            (option) =>
              option.long !== '--version' &&
              (isRuntimeCommand(command) ||
                !['--context', '--context-dir'].includes(option.long ?? '')),
          );
      },
    })
    .configureOutput({
      writeOut: writeText,
      // main owns diagnostics and JSON error envelopes, including parser errors.
      writeErr: () => {},
    });
  addOptions(program, [
    new Option('--version', 'Output the version number.'),
    new Option('--context <name>', 'Runtime context name (runtime commands only).'),
    new Option('--context-dir <path>', 'Runtime storage root (runtime commands only).'),
    new Option(
      '--output-version <version>',
      'Wrap results, help, and errors in versioned JSON.',
    ).choices(['1']),
  ]);
  program.action(() => {
    if (program.opts<{ version?: boolean }>().version) writeText(`${CLI_VERSION}\n`);
    else program.outputHelp();
  });
  program.hook('preAction', (_parent, command) => {
    const options = command.optsWithGlobals<CliOptions>();
    if (program.opts<{ version?: boolean }>().version && command !== program) {
      throw new CliInputError('--version is only available on the root command.');
    }
    if (
      !isRuntimeCommand(command) &&
      (options.context !== undefined || options.contextDir !== undefined)
    ) {
      throw new CliInputError('--context and --context-dir require a runtime command.');
    }
  });

  const group = (name: string, description: string) => {
    const command = program.command(name).description(description);
    command.action(() => command.outputHelp());
    return command;
  };
  const daemon = group('daemon', 'Run the runtime daemon directly.');
  const runtime = group('runtime', 'Start, stop, and inspect a runtime context.');
  const scene = group('scene', 'Inspect, capture, restore, and render simulator state.');
  const param = group('param', 'Inspect and update simulator parameters.');
  const action = group('action', 'Discover and dispatch simulator actions.');
  const run = group('run', 'Control bounded simulator runs.');
  const chart = group('chart', 'Inspect chart data.');
  const asset = group('asset', 'List simulator assets.');
  const stream = group('stream', 'Stream runtime events.');
  const skills = group(
    'skills',
    'List and install version-matched offline agent skills.',
  ).addHelpText(
    'after',
    '\nInstalls are offline and non-interactive. Defaults: project scope, current directory, codex.\nConflicts preserve existing content; --force replaces with a backup. Re-run after CLI upgrades.',
  );

  const serve = daemon.command('serve').description('Serve the runtime in the foreground.');
  addOptions(serve, startupOptions());
  handle(serve, startForegroundDaemon);
  const up = runtime
    .command('up')
    .description('Start the runtime and optionally connect to a simulator.');
  addOptions(up, [...startupOptions(), new Option('--foreground', 'Run in the foreground.')]);
  handle(up, (options) =>
    options.foreground ? startForegroundDaemon(options) : startBackgroundDaemon(options),
  );
  handle(runtime.command('down').description('Stop the runtime.'), stopDaemon);
  handle(runtime.command('status').description('Report runtime status.'), printStatus);
  handle(runtime.command('logs').description('Read runtime logs.'), printLogs);
  handle(
    runtime
      .command('render-trigger')
      .description('Read or set automatic rendering.')
      .addArgument(
        new Argument('[mode]', 'Render trigger mode.').choices(['manual', 'action-result']),
      ),
    async (options, rest) => {
      const { baseUrl } = await requireRuntime(options);
      const trigger = rest[0];
      if (!trigger) {
        printJson(options, await requestJson(baseUrl, '/v1/runtime/status'));
        return;
      }
      printJson(
        options,
        await requestJson(baseUrl, '/v1/runtime/render-trigger', {
          method: 'POST',
          body: JSON.stringify({ trigger }),
        }),
      );
    },
  );
  const sceneInspect = scene.command('inspect').description('Inspect the current scene.');
  addOptions(sceneInspect, [jsonOption('--query <json>', 'Bounded scene query.', 'object')]);
  handle(sceneInspect, async (options) => {
    const query = options.query === undefined ? undefined : parseQuery(options.query);
    const { baseUrl } = await requireRuntime(options);
    printJson(
      query ? { outputVersion: '1' } : options,
      await requestJson(
        baseUrl,
        query ? '/v1/scene/query' : '/v1/scene',
        query ? { method: 'POST', body: JSON.stringify(query) } : undefined,
      ),
    );
  });
  const monitor = group('monitor', 'Query current monitor values and metadata.');
  for (const verb of ['list', 'get <id>']) {
    const command = monitor.command(verb);
    addOptions(command, [
      jsonOption('--fields <json>', 'Selected field paths.', 'array'),
      numericOption('--limit <n>', 'Page size.', 'integer'),
      new Option('--cursor <json>', 'Continue a query at the same revision.'),
    ]);
    handle(command, async (options, [id]) => {
      const query = parseQuery({
        selector: { kind: 'monitor', ...(id ? { id } : {}) },
        fields: options.fields,
        limit: options.limit,
        cursor: options.cursor,
      });
      const { baseUrl } = await requireRuntime(options);
      printJson(
        { outputVersion: '1' },
        await requestJson(baseUrl, '/v1/scene/query', {
          method: 'POST',
          body: JSON.stringify(query),
        }),
      );
    });
  }
  const agentInspect = group('agent', 'Inspect typed agent references.').command('inspect <id>');
  addOptions(agentInspect, [
    new Option('--env <id>', 'Environment ID.').makeOptionMandatory(),
    new Option('--layer <id>', 'Layer ID.').makeOptionMandatory(),
    new Option('--id-type <type>', 'Explicit agent ID type.')
      .choices(['string', 'number'])
      .makeOptionMandatory(),
    numericOption('--radius <number>', 'Neighbor radius.', 'positive'),
    jsonOption('--fields <json>', 'Selected field paths.', 'array'),
    new Option('--output <path>', 'Save the inspection screenshot.'),
  ]);
  handle(agentInspect, async (options, [id]) => {
    const agentId = options.idType === 'number' ? Number(id) : id;
    const ref = { environmentId: options.env!, layerId: options.layer!, agentId };
    const query = parseQuery({
      selector:
        options.radius === undefined
          ? { kind: 'agent', ref }
          : { kind: 'neighbors', ref, radius: options.radius },
      fields: options.fields,
    });
    const { baseUrl } = await requireRuntime(options);
    const result = await requestJson(baseUrl, '/v1/scene/query', {
      method: 'POST',
      body: JSON.stringify(query),
    });
    if (options.output) {
      const inspection = (await requestJson(baseUrl, '/v1/agents/inspect', {
        method: 'POST',
        body: JSON.stringify({ ref, radius: options.radius, render: true }),
      })) as { artifacts?: Array<{ data: string }> };
      if (!inspection.artifacts?.[0])
        throw new Error('Agent inspection has no renderable viewport.');
      await writeFile(options.output, Buffer.from(inspection.artifacts[0].data, 'base64'));
    }
    printJson({ outputVersion: '1' }, result);
  });
  handle(
    scene.command('snapshot').description('Read the current scene snapshot.'),
    async (options) => {
      const { baseUrl } = await requireRuntime(options);
      printJson(options, await requestJson(baseUrl, '/v1/scene/snapshot'));
    },
  );

  const sceneCapture = scene
    .command('capture')
    .description('Capture a restorable scene checkpoint.');
  addOptions(sceneCapture, [new Option('--output <path>', 'Write the capture to a JSON file.')]);
  handle(sceneCapture, async (options) => {
    const { baseUrl } = await requireRuntime(options);
    const result = (await requestJson(baseUrl, '/v1/scene/capture', { method: 'POST' })) as Record<
      string,
      unknown
    >;
    const status = (await requestJson(baseUrl, '/v1/runtime/status')) as {
      simulatorCapabilities?: string[];
    };
    const scene = status.simulatorCapabilities?.includes('scene.restore.projected')
      ? ((await requestJson(baseUrl, '/v1/scene/snapshot')) as {
          snapshot?: { metadata?: { time?: unknown } };
        })
      : undefined;
    const capturedTime = scene?.snapshot?.metadata?.time;
    const capture =
      typeof capturedTime === 'number' && Number.isFinite(capturedTime)
        ? { ...result, time: capturedTime }
        : result;
    const outputPath = options.output;
    if (outputPath) {
      await writeFile(outputPath, `${JSON.stringify(capture, null, 2)}\n`, 'utf8');
    }
    printJson(options, capture);
  });

  const sceneRestore = scene
    .command('restore')
    .description('Restore a checkpoint or projected scene state.');
  addOptions(sceneRestore, [
    new Option('--checkpoint <path>', 'Restore from a capture JSON file.'),
    numericOption('--time <number>', 'Override scene time.'),
    jsonOption('--parameters <json>', 'Projected parameter object.', 'object'),
    jsonOption('--envs <json>', 'Projected environment array.', 'array'),
    numericOption('--history-time <number>', 'Renderer-local chart boundary.'),
    jsonOption('--replacement-charts <json>', 'Saved renderer chart groups.', 'array'),
    new Option('--chart-policy <policy>', 'Chart restore policy.').choices([
      'preserve',
      'replace',
      'truncate',
    ]),
  ]);
  handle(sceneRestore, async (options) => {
    const checkpointPath = options.checkpoint;
    const input: Record<string, unknown> = {};
    let capturedTime: number | undefined;
    if (checkpointPath) {
      let parsedCheckpoint: unknown;
      try {
        parsedCheckpoint = JSON.parse(await readFile(checkpointPath, 'utf8'));
      } catch (error) {
        throw new Error(
          `Unable to read checkpoint file ${checkpointPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (
        typeof parsedCheckpoint !== 'object' ||
        parsedCheckpoint === null ||
        Array.isArray(parsedCheckpoint)
      ) {
        throw new Error('Checkpoint file must contain a JSON object.');
      }
      const record = parsedCheckpoint as Record<string, unknown>;
      input.checkpoint = record.checkpoint ?? record;
      if (typeof record.time === 'number' && Number.isFinite(record.time))
        capturedTime = record.time;
    }
    const time = options.time;
    if (time !== undefined || capturedTime !== undefined) input.time = time ?? capturedTime;
    const parameters = options.parameters;
    if (parameters !== undefined) input.parameters = parameters;
    const envs = options.envs;
    if (envs !== undefined) input.envs = envs;
    const chartPolicy = options.chartPolicy;
    if (chartPolicy !== undefined) input.chartPolicy = chartPolicy;
    if (options.historyTime !== undefined) input.historyTime = options.historyTime;
    if (options.replacementCharts !== undefined)
      input.replacementCharts = options.replacementCharts;
    if (Object.keys(input).length === 0) {
      throw new CliInputError(
        'No checkpoint or projected scene state was supplied. Use scene restore --help.',
      );
    }
    const { baseUrl } = await requireRuntime(options);
    printJson(
      options,
      await requestJson(baseUrl, '/v1/scene/restore', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    );
  });
  handle(
    scene.command('sync').description('Synchronize the scene with the simulator.'),
    async (options) => {
      const { baseUrl } = await requireRuntime(options);
      printJson(options, await requestJson(baseUrl, '/v1/runtime/sync', { method: 'POST' }));
    },
  );

  const sceneRender = scene
    .command('render [reason]')
    .description('Render environments or charts to image files.');
  addOptions(sceneRender, imageOptions());
  handle(sceneRender, async (options, rest) => {
    const { baseUrl } = await requireRuntime(options);
    const viewport = options.viewport;
    const envId = options.env;
    const chartId = options.chart;
    printJson(
      options,
      await requestJson(baseUrl, '/v1/scene/render', {
        method: 'POST',
        body: JSON.stringify({
          reason: rest[0] ?? 'manual',
          envId,
          chartId,
          width: options.width,
          height: options.height,
          format: options.format,
          quality: options.quality,
          backgroundColor: options.backgroundColor,
          outputPath: options.output,
          viewport,
        }),
      }),
    );
  });
  handle(param.command('list').description('List simulator parameters.'), async (options) => {
    const { baseUrl } = await requireRuntime(options);
    printJson(options, await requestJson(baseUrl, '/v1/params'));
  });
  handle(
    param
      .command('set <parameter-id> <json-value>')
      .description('Set a parameter to a JSON value or plain string.'),
    async (options, rest) => {
      const [parameterId, rawValue] = rest;
      if (!parameterId) throw new CliInputError('Parameter ID must not be empty.');
      const { baseUrl } = await requireRuntime(options);
      printJson(
        options,
        await requestJson(baseUrl, `/v1/params/${encodeURIComponent(parameterId)}`, {
          method: 'POST',
          body: JSON.stringify({ value: parseJsonValue(rawValue) }),
        }),
      );
    },
  );
  handle(action.command('list').description('List simulator actions.'), async (options) => {
    const { baseUrl } = await requireRuntime(options);
    printJson(options, await requestJson(baseUrl, '/v1/actions'));
  });
  const actionRun = action.command('run <action-id>').description('Dispatch one simulator action.');
  addOptions(actionRun, [
    new Option('--wait', 'Wait for action result and host barrier.'),
    numericOption(
      '--timeout-ms <ms>',
      'Wait deadline without cancellation; enables --wait.',
      'positive',
    ).implies({ wait: true }),
  ]);
  handle(actionRun, async (options, rest) => {
    const [actionId] = rest;
    if (!actionId) throw new CliInputError('Action ID must not be empty.');
    const { baseUrl } = await requireRuntime(options);
    const accepted = (await requestJson(baseUrl, `/v1/actions/${encodeURIComponent(actionId)}`, {
      method: 'POST',
      body: '{}',
    })) as { requestId: string };
    printJson(
      options,
      options.wait
        ? await requestWait(
            baseUrl,
            { requestId: accepted.requestId },
            { timeoutMs: options.timeoutMs },
          )
        : accepted,
    );
  });

  const runStart = run
    .command('start <action-id>')
    .description('Start a bounded run; requires --max-actions or --max-steps.');
  addOptions(runStart, [
    numericOption('--max-actions <count>', 'Positive completed-action limit.', 'integer').conflicts(
      'maxSteps',
    ),
    numericOption(
      '--max-steps <count>',
      'Deprecated public spelling of --max-actions.',
      'integer',
    ).conflicts('maxActions'),
    new Option('--stop-when <expression>', 'Stop condition expression.'),
    numericOption(
      '--max-wall-time-ms <ms>',
      'Positive wall-time limit in milliseconds.',
      'positive',
    ),
    new Option('--record', 'Record this run.').conflicts('collection'),
    new Option('--collection <file>', 'Strict trigger/storage collection config.').conflicts(
      'record',
    ),
    new Option('--store <directory>', 'New collection store directory.'),
    new Option('--wait', 'Wait for this run to settle or persist.'),
    new Option('--until <phase>', 'Wait phase (default: settled).')
      .choices(['settled', 'persisted'])
      .implies({ wait: true }),
    numericOption(
      '--timeout-ms <ms>',
      'Wait deadline without cancellation; enables --wait.',
      'positive',
    ).implies({ wait: true }),
  ]);
  runStart.hook('preAction', (_parent, command) => {
    const options = command.optsWithGlobals<CliOptions>();
    if (options.maxActions === undefined && options.maxSteps === undefined) {
      throw new CliInputError('run start requires --max-actions <n> (or --max-steps <n>).');
    }
    if (options.until === 'persisted' && !options.record && !options.collection)
      throw new CliInputError('--until persisted requires --record or --collection.');
    if (Boolean(options.collection) !== Boolean(options.store))
      throw new CliInputError('--collection and --store are required together.');
  });
  handle(runStart, async (options, rest) => {
    const [actionId] = rest;
    if (!actionId) throw new CliInputError('Action ID must not be empty.');
    const maxSteps = options.maxActions ?? options.maxSteps;
    let collection;
    if (options.collection) {
      try {
        collection = validateCollectionConfig(
          JSON.parse(await readFile(options.collection, 'utf8')),
        );
        if (options.stopWhen) compileRunCondition(options.stopWhen);
      } catch (error) {
        throw new CliInputError(String(error));
      }
    }
    const spec = {
      mode: 'bounded',
      actionId,
      maxSteps,
      stopWhen: options.stopWhen,
      maxWallTimeMs: options.maxWallTimeMs,
    };
    const { baseUrl } = await requireRuntime(options);
    const accepted = (await requestJson(baseUrl, collection ? '/v1/collections' : '/v1/runs', {
      method: 'POST',
      body: JSON.stringify(
        collection
          ? { spec, config: collection, output: options.store }
          : { ...spec, record: options.record === true },
      ),
    })) as { run: { id: string } };
    printJson(
      options,
      options.wait
        ? await requestWait(
            baseUrl,
            { runId: accepted.run.id },
            {
              until: options.until,
              timeoutMs: options.timeoutMs,
            },
          )
        : accepted,
    );
  });
  const runWait = run.command('wait <run-id>').description('Wait for a retained run by ID.');
  addOptions(runWait, [
    new Option('--until <phase>', 'Completion phase.').choices(['settled', 'persisted']),
    numericOption('--timeout-ms <ms>', 'Wait deadline without cancellation.', 'positive'),
  ]);
  handle(runWait, async (options, [id]) => {
    const { baseUrl } = await requireRuntime(options);
    printJson(
      { ...options, outputVersion: '1' },
      await requestWait(
        baseUrl,
        { runId: id },
        { until: options.until, timeoutMs: options.timeoutMs },
      ),
    );
  });
  const actionWait = action
    .command('wait <request-id>')
    .description('Wait for a retained action by ID.');
  addOptions(actionWait, [
    numericOption('--timeout-ms <ms>', 'Wait deadline without cancellation.', 'positive'),
  ]);
  handle(actionWait, async (options, [id]) => {
    const { baseUrl } = await requireRuntime(options);
    printJson(
      { ...options, outputVersion: '1' },
      await requestWait(baseUrl, { requestId: id }, { timeoutMs: options.timeoutMs }),
    );
  });
  handle(
    run.command('status').description('Report the current run and its settlement.'),
    async (options) => {
      const { baseUrl } = await requireRuntime(options);
      printJson(options, await requestJson(baseUrl, '/v1/runs'));
    },
  );
  handle(run.command('stop').description('Stop the current run.'), async (options) => {
    const { baseUrl } = await requireRuntime(options);
    printJson(options, await requestJson(baseUrl, '/v1/runs', { method: 'DELETE' }));
  });
  handle(chart.command('list').description('List charts.'), async (options) => {
    const { baseUrl } = await requireRuntime(options);
    printJson(options, await requestJson(baseUrl, '/v1/charts'));
  });
  handle(
    chart.command('get <chart-id>').description('Read a chart series.'),
    async (options, rest) => {
      const [chartId] = rest;
      if (!chartId) throw new CliInputError('Chart ID must not be empty.');
      const { baseUrl } = await requireRuntime(options);
      printJson(options, await requestJson(baseUrl, `/v1/charts/${encodeURIComponent(chartId)}`));
    },
  );
  handle(asset.command('list').description('List available assets.'), async (options) => {
    const { baseUrl } = await requireRuntime(options);
    printJson(options, await requestJson(baseUrl, '/v1/assets'));
  });

  handle(stream.command('events').description('Stream server-sent runtime events.'), streamEvents);
  const recording = group(
    'recording',
    'Record online runs and inspect or render saved recordings offline.',
  );
  const frame = group('frame', 'Save, restore and compare fixed frame evidence.');
  const recordingStart = recording
    .command('start')
    .description('Start a manual context recording.');
  addOptions(recordingStart, [
    numericOption('--max-frames <count>', 'Retained frame budget (default: 10000).', 'integer'),
    numericOption('--max-bytes <bytes>', 'Retained byte budget (default: 64 MiB).', 'positive'),
    numericOption('--max-duration-ms <ms>', 'Retained duration budget.', 'positive'),
    new Option('--retention <policy>', 'Retention policy (default: rolling).').choices([
      'rolling',
      'bounded',
    ]),
    new Option('--label <text>', 'Recording label.'),
  ]);
  handle(recordingStart, async (options) => {
    const { baseUrl } = await requireRuntime(options);
    printJson(
      { outputVersion: '1' },
      await requestJson(baseUrl, '/v1/recordings', {
        method: 'POST',
        body: JSON.stringify({
          maxSteps: options.maxFrames,
          maxBytes: options.maxBytes,
          maxDurationMs: options.maxDurationMs,
          ringBuffer: options.retention !== 'bounded',
          label: options.label,
        }),
      }),
    );
  });
  const recordingStop = recording
    .command('stop')
    .description('Close and persist the manual recording.');
  addOptions(recordingStop, [
    numericOption('--timeout-ms <ms>', 'Persistence wait deadline.', 'positive'),
  ]);
  handle(recordingStop, async (options) => {
    const { baseUrl } = await requireRuntime(options);
    printJson(
      { outputVersion: '1' },
      await requestJson(baseUrl, '/v1/recordings/stop', {
        method: 'POST',
        body: JSON.stringify({ timeoutMs: options.timeoutMs }),
      }),
    );
  });
  handle(
    recording.command('list').description('List retained context recordings and failures.'),
    async (options) => {
      const { baseUrl } = await requireRuntime(options);
      printJson({ outputVersion: '1' }, await requestJson(baseUrl, '/v1/recordings'));
    },
  );
  const recordingExport = recording
    .command('export <recording-id>')
    .description('Export a persisted context recording.');
  addOptions(recordingExport, [
    new Option('--output <path>', 'Recording output file.').makeOptionMandatory(),
  ]);
  handle(recordingExport, async (options, [id]) => {
    const { baseUrl } = await requireRuntime(options);
    printJson(
      { outputVersion: '1' },
      await requestJson(baseUrl, `/v1/recordings/${encodeURIComponent(id)}/export`, {
        method: 'POST',
        body: JSON.stringify({ output: options.output }),
      }),
    );
  });
  const recordingInfo = recording
    .command('info <file>')
    .description('Inspect format, retained range and resource completeness offline.');
  addOptions(recordingInfo, [
    new Option('--snapshot-id <id>', 'Select a recording in a project file.'),
  ]);
  handle(recordingInfo, async (options, [file]) => {
    if (await isRecordingStore(file)) {
      if (options.snapshotId) throw new CliInputError('--snapshot-id requires a project file.');
      printJson(
        { outputVersion: '1' },
        await withRecordingStore(file, async (reader) => ({
          ...reader.root,
          summary: await reader.summary(),
        })),
      );
      return;
    }
    const document = await readRecording(file, options.snapshotId);
    printJson(
      { outputVersion: '1' },
      {
        id: document.snapshot.metadata.id,
        modelIdentity: document.snapshot.metadata.model_identity,
        origin: document.origin,
        ...document.report,
      },
    );
  });
  for (const verb of ['seek', 'inspect', 'render', 'export-frame'] as const) {
    const command = recording
      .command(`${verb} <file>`)
      .description(`${verb} a saved recording at an explicit retained frame or model time.`);
    addOptions(command, selectionOptions());
    if (verb === 'inspect')
      addOptions(command, [jsonOption('--query <json>', 'Bounded historical query.', 'object')]);
    if (verb === 'render' || verb === 'export-frame')
      addOptions(command, imageOptions(verb === 'render'));
    command.hook('preAction', (_parent, target) => {
      const options = target.optsWithGlobals<CliOptions>();
      recordingSelection(options);
      if ((verb === 'render' || verb === 'export-frame') && !options.output)
        throw new CliInputError('--output is required.');
    });
    handle(command, async (options, [file]) => {
      const query = options.query === undefined ? undefined : parseQuery(options.query);
      const selection = recordingSelection(options);
      if (verb === 'render')
        printJson(
          { outputVersion: '1' },
          await renderRecordingFrame(
            file,
            selection,
            sceneRenderOptions(options),
            options.snapshotId,
          ),
        );
      else if (verb === 'export-frame')
        printJson(
          { outputVersion: '1' },
          await exportRecordingFrame(file, selection, options.output!, {
            snapshotId: options.snapshotId,
            envIds: options.env ? [options.env] : [],
            chartIds: options.chart ? [options.chart] : [],
            renderOptions: sceneRenderOptions(options),
          }),
        );
      else {
        const result =
          query || verb === 'seek'
            ? await inspectRecordingBoundary(file, selection, query, options.snapshotId)
            : await readRecordingBoundary(file, selection, options.snapshotId);
        printJson({ outputVersion: '1' }, result);
      }
    });
  }
  const recover = recording
    .command('recover <directory>')
    .description('Verify the committed prefix without dispatching simulator actions.');
  addOptions(recover, [
    new Option(
      '--rebuild-index',
      'Verify immutable segments and atomically rebuild the derived index.',
    ),
  ]);
  handle(recover, async (options, [path]) => {
    if (options.rebuildIndex) {
      const backend = new NodeRecordingStore(path);
      try {
        await rebuildRecordingStoreIndex(backend);
      } finally {
        backend.close();
      }
    }
    printJson({ outputVersion: '1' }, await withRecordingStore(path, (reader) => reader.recover()));
  });
  const exportRange = recording
    .command('export-range <directory>')
    .description('Stream a retained range into a new independent store.');
  addOptions(exportRange, [
    numericOption('--from <frame>', 'First frame.'),
    numericOption('--to <frame>', 'Last frame.'),
    new Option('--output <directory>', 'New output store.').makeOptionMandatory(),
  ]);
  handle(exportRange, async (options, [path]) => {
    if (
      options.from === undefined ||
      options.to === undefined ||
      options.from < 0 ||
      options.to < options.from
    )
      throw new CliInputError('Specify a valid --from/--to frame range.');
    await withRecordingStore(path, async (reader) => {
      if (
        !Number.isSafeInteger(options.from) ||
        !Number.isSafeInteger(options.to) ||
        options.from! < reader.root.firstFrame ||
        options.to! > reader.root.lastFrame
      )
        throw new CliInputError('Export range is outside retained boundaries.');
      const backend = new NodeRecordingStore(options.output!);
      const writer = await RecordingStoreWriter.create(backend, {
        id: crypto.randomUUID(),
        mode: 'full-history',
        modelIdentity: reader.root.modelIdentity,
      });
      try {
        await reader.exportRange(writer, options.from!, options.to!);
        await writer.close({
          derivedFrom: { recordingId: reader.root.id, from: options.from, to: options.to },
        });
      } catch (error) {
        writer.abort(error);
        await writer.close().catch(() => {});
        throw error;
      } finally {
        backend.close();
      }
      printJson(
        { outputVersion: '1' },
        { path: options.output, from: options.from, to: options.to },
      );
    });
  });
  const renderRange = recording
    .command('render-range <directory>')
    .description('Render a range using one bounded reader cache.');
  addOptions(renderRange, [
    numericOption('--from <frame>', 'First frame.'),
    numericOption('--to <frame>', 'Last frame.'),
    ...imageOptions(true),
  ]);
  handle(renderRange, async (options, [path]) => {
    if (options.from === undefined || options.to === undefined || !options.output)
      throw new CliInputError('--from, --to and --output directory are required.');
    const { mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { renderHistoricalFrame } = await import('./runtime/recording-files');
    const { fixedRenderRequest } = await import('./runtime/frame-files');
    let count = 0;
    await withRecordingStore(path, async (reader) => {
      for await (const captured of reader.range(options.from!, options.to!, {
        history: options.env ? 'active' : 'full',
      })) {
        const outputPath = join(options.output!, String(captured.source.frame), 'scene.png');
        await mkdir(join(outputPath, '..'), { recursive: true });
        await renderHistoricalFrame(
          fixedRenderRequest(
            captured.scene,
            { ...sceneRenderOptions(options), outputPath },
            'recording-range',
          ),
        );
        count++;
      }
    });
    printJson({ outputVersion: '1' }, { count, path: options.output });
  });
  const history = recording
    .command('monitor-history <file> <monitor-id>')
    .description('Sample recorded monitor boundaries or changes.');
  addOptions(history, [
    numericOption('--from <frame>', 'First frame.'),
    numericOption('--to <frame>', 'Last frame.'),
    new Option('--sampling <mode>', 'Boundary or change-point sampling.')
      .choices(['boundaries', 'changes'])
      .makeOptionMandatory(),
    jsonOption('--fields <json>', 'Selected paths.', 'array'),
    numericOption('--limit <n>', 'Page size.', 'integer'),
    numericOption('--after <frame>', 'Continue after frame.'),
    new Option('--snapshot-id <id>', 'Project recording ID.'),
  ]);
  handle(history, async (options, [file, monitorId]) => {
    if (options.from === undefined || options.to === undefined)
      throw new CliInputError('--from and --to are required.');
    if (await isRecordingStore(file)) {
      if (options.snapshotId) throw new CliInputError('--snapshot-id requires a project file.');
      parseQuery({ selector: { kind: 'monitor', id: monitorId }, fields: options.fields });
      printJson(
        { outputVersion: '1' },
        await monitorStoreHistory(file, {
          monitorId,
          from: options.from,
          to: options.to,
          sampling: options.sampling!,
          fields: options.fields,
          limit: options.limit,
          after: options.after,
        }),
      );
      return;
    }
    const document = await readRecording(file, options.snapshotId);
    try {
      printJson(
        { outputVersion: '1' },
        monitorHistory(document.snapshot, {
          monitorId,
          from: options.from,
          to: options.to,
          sampling: options.sampling!,
          fields: options.fields,
          limit: options.limit,
          after: options.after,
        }),
      );
    } catch (error) {
      throw new ArtifactInputError(error);
    }
  });
  for (const [parent, recordingFiles] of [
    [frame, false],
    [recording, true],
  ] as const) {
    const command = parent
      .command('diff <left> <right>')
      .description('Compare fixed boundaries with an explicit field/tolerance policy.');
    addOptions(command, [
      new Option('--policy <file>', 'Comparison policy JSON file.'),
      numericOption('--limit <n>', 'Maximum reported differences.', 'integer'),
      numericOption('--offset <n>', 'Continue at a difference offset.'),
    ]);
    if (recordingFiles)
      addOptions(command, [
        numericOption('--left-frame <index>', 'Left retained frame.').makeOptionMandatory(),
        numericOption('--right-frame <index>', 'Right retained frame.').makeOptionMandatory(),
      ]);
    handle(command, async (options, [left, right]) => {
      if (
        (options.limit !== undefined && options.limit > 10000) ||
        (options.offset !== undefined &&
          (!Number.isSafeInteger(options.offset) || options.offset < 0)) ||
        (recordingFiles &&
          ![options.leftFrame, options.rightFrame].every(
            (frame) => Number.isSafeInteger(frame) && frame! >= 0,
          ))
      )
        throw new CliInputError('Invalid diff page/frame selector.');
      let policy;
      try {
        policy = ComparisonPolicySchema.parse(
          options.policy ? JSON.parse(await readFile(options.policy, 'utf8')) : {},
        );
      } catch (error) {
        throw new ArtifactInputError(error);
      }
      const a = recordingFiles
        ? await readRecordingBoundary(left, { frame: options.leftFrame! })
        : await readCapturedFrame(left);
      const b = recordingFiles
        ? await readRecordingBoundary(right, { frame: options.rightFrame! })
        : await readCapturedFrame(right);
      printJson(
        { outputVersion: '1' },
        {
          ...diffCapturedFrames(a.frame, b.frame, policy, {
            limit: options.limit,
            offset: options.offset,
          }),
          ...('position' in a ? { leftPosition: a.position } : {}),
          ...('position' in b ? { rightPosition: b.position } : {}),
        },
      );
    });
  }
  const frameSave = frame
    .command('save')
    .description('Save a fixed online frame and optional images into an evidence directory.');
  addOptions(frameSave, [
    ...imageOptions(false),
    new Option('--checkpoint <policy>', 'Checkpoint capture policy (default: none).').choices([
      'none',
      'if-supported',
      'required',
    ]),
    numericOption('--timeout-ms <ms>', 'Capture wait deadline.', 'positive'),
  ]);
  frameSave.hook('preAction', (_parent, command) => {
    if (!command.opts<CliOptions>().output) throw new CliInputError('--output is required.');
  });
  handle(frameSave, async (options) => {
    const { baseUrl } = await requireRuntime(options);
    printJson(
      { outputVersion: '1' },
      await requestJson(baseUrl, '/v1/frames', {
        method: 'POST',
        body: JSON.stringify({
          output: options.output,
          checkpoint: options.checkpoint,
          envIds: options.env ? [options.env] : [],
          chartIds: options.chart ? [options.chart] : [],
          renderOptions: sceneRenderOptions(options, false),
          timeoutMs: options.timeoutMs,
        }),
      }),
    );
  });
  const frameRestore = frame
    .command('restore <directory>')
    .description('Validate and restore model state and renderer history from fixed evidence.');
  addOptions(frameRestore, [
    new Option('--mode <mode>', 'Explicit restore method.')
      .choices(['checkpoint', 'projected'])
      .makeOptionMandatory(),
    new Option('--history <policy>', 'Renderer chart policy (default: replace).').choices([
      'preserve',
      'replace',
      'truncate',
    ]),
    numericOption('--history-time <number>', 'Explicit truncate boundary.'),
    numericOption('--timeout-ms <ms>', 'Restore wait deadline.', 'positive'),
  ]);
  handle(frameRestore, async (options, [directory]) => {
    const { baseUrl } = await requireRuntime(options);
    printJson(
      { outputVersion: '1' },
      await requestJson(baseUrl, '/v1/frames/restore', {
        method: 'POST',
        body: JSON.stringify({
          directory,
          mode: options.mode,
          chartPolicy: options.history,
          historyTime: options.historyTime,
          timeoutMs: options.timeoutMs,
        }),
      }),
    );
  });
  handle(
    frame
      .command('compare <left> <right>')
      .description('Compare saved scenes/charts and opaque checkpoint encodings offline.'),
    async (_options, [left, right]) => {
      const [a, b] = await Promise.all([readCapturedFrame(left), readCapturedFrame(right)]);
      printJson(
        { outputVersion: '1' },
        { left: a.frame.source, right: b.frame.source, ...compareCapturedFrames(a.frame, b.frame) },
      );
    },
  );
  const skillOptions = () => [
    new Option('--scope <scope>', 'Installation scope (default: project).').choices([
      'project',
      'user',
    ]),
    new Option('--agent <agent>', 'Target agent (default: codex).').choices([
      'codex',
      'claude-code',
      'universal',
    ]),
    new Option('--project-dir <path>', 'Target project directory (default: current directory).'),
  ];
  const skillList = skills
    .command('list')
    .description('List bundled skills and their destination.');
  addOptions(skillList, skillOptions());
  const skillInstall = skills
    .command('install [name]')
    .description('Install one bundled skill or all bundled skills.');
  addOptions(skillInstall, [
    ...skillOptions(),
    new Option('--all', 'Install all bundled skills.'),
    new Option('--force', 'Back up and replace conflicting skill content.'),
  ]);
  skills.hook('preAction', (_parent, command) => {
    const options = command.optsWithGlobals<CliOptions>();
    if (options.scope === 'user' && options.projectDir !== undefined) {
      throw new CliInputError('--project-dir cannot be combined with --scope user.');
    }
  });
  handle(skillList, async (options) => printJson(options, await listSkills(options)));
  skillInstall.hook('preAction', (_parent, command) => {
    const options = command.optsWithGlobals<CliOptions>();
    const [name] = command.processedArgs;
    if (Boolean(options.all) === (name !== undefined)) {
      throw new CliInputError('skills install requires one skill name or --all. Use skills list.');
    }
  });
  handle(skillInstall, async (options, [name]) => {
    printJson(options, await installBundledSkills(name, options));
  });
  return program;
}

function handle(
  command: Command,
  handler: (options: CliOptions, args: string[]) => void | Promise<void>,
): void {
  command.action(() => handler(command.optsWithGlobals<CliOptions>(), command.processedArgs));
}

function isRuntimeCommand(command: Command): boolean {
  return (
    Boolean(command.parent) &&
    command.name() !== 'skills' &&
    command.parent?.name() !== 'skills' &&
    !(
      command.parent?.name() === 'recording' &&
      [
        'info',
        'seek',
        'inspect',
        'render',
        'export-frame',
        'monitor-history',
        'diff',
        'recover',
        'export-range',
        'render-range',
      ].includes(command.name())
    ) &&
    !(command.parent?.name() === 'frame' && ['compare', 'diff'].includes(command.name()))
  );
}

export class CliRequestError extends Error {
  readonly category: string;
  readonly exitCode: number;
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    const record = body as {
      error?: string | { message?: string; category?: string };
      category?: string;
    };
    super(
      typeof record?.error === 'string'
        ? record.error
        : (record?.error?.message ?? `Request failed with status ${status}`),
    );
    this.category =
      record?.category ??
      (record?.error && typeof record.error === 'object' ? record.error.category : undefined) ??
      (status === 400
        ? 'input_error'
        : /timed out|disconnect/i.test(this.message)
          ? 'result_unknown'
          : 'execution_failed');
    this.exitCode =
      {
        input_error: 2,
        execution_failed: 3,
        result_unknown: 4,
        render_failed: 5,
        persistence_failed: 6,
      }[this.category] ?? 3;
  }
}

class CliWaitError extends Error {
  readonly category: string;
  readonly exitCode: number;
  readonly data: Record<string, unknown>;
  readonly correlationId: string;

  constructor(cause: unknown, identity: { requestId: string } | { runId: string }) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const [kind, id] = Object.entries(identity)[0];
    super(`${message} (${kind}: ${id})`, { cause });
    this.correlationId = id;
    // The dispatch already succeeded. A transport failure during the wait cannot
    // determine its outcome; the same ID can still be waited on without dispatch.
    const classification =
      cause instanceof CliRequestError
        ? classifyCliError(cause)
        : { category: 'result_unknown', exitCode: 4 };
    this.category = classification.category;
    this.exitCode = classification.exitCode;
    const body = cause instanceof CliRequestError ? cause.body : undefined;
    this.data = {
      ...(body && typeof body === 'object' && !Array.isArray(body) ? body : {}),
      ...identity,
    };
  }
}

function printJson(options: Pick<CliOptions, 'outputVersion'>, data: unknown): void {
  if (options.outputVersion !== '1') {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  const record = data as {
    requestId?: string;
    request_id?: string;
    action?: { requestId?: string };
    run?: { id?: string };
  } | null;
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      ok: true,
      data,
      correlationId:
        record?.requestId ?? record?.request_id ?? record?.action?.requestId ?? record?.run?.id,
    }),
  );
}

function emitText(options: Pick<CliOptions, 'outputVersion'>, value: string): void {
  if (options.outputVersion === '1') printJson(options, value);
  else console.log(value);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  // Select the error transport even when parsing fails before reaching this option.
  const terminator = argv.indexOf('--');
  const optionArgs = terminator < 0 ? argv : argv.slice(0, terminator);
  const implicitMachineOutput = usesMachineOutputByDefault(optionArgs);
  const output: Pick<CliOptions, 'outputVersion'> = {
    outputVersion:
      implicitMachineOutput ||
      optionArgs.some(
        (token, index) =>
          token === '--output-version=1' ||
          (token === '--output-version' && optionArgs[index + 1] === '1'),
      )
        ? '1'
        : undefined,
  };
  // Commander can emit help in several chunks (including addHelpText). Flush it
  // as one response so machine clients always receive exactly one envelope.
  let commandOutput = '';
  try {
    await createProgram((text) => {
      commandOutput += text;
    }).parseAsync(argv, { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError && cause.code === 'commander.helpDisplayed') {
      emitText(output, commandOutput.trimEnd());
      return;
    }
    const error =
      cause instanceof CommanderError
        ? new CliInputError(
            cause.message.replace(/^error: /, '') +
              (cause.code === 'commander.unknownOption' && /'--root-dir(?:=|')/.test(cause.message)
                ? ' Use --context-dir.'
                : ''),
          )
        : cause;
    if (output.outputVersion === '1') {
      const category = classifyCliError(error).category;
      console.log(
        JSON.stringify({
          schemaVersion: 1,
          ok: false,
          error: { category, message: error instanceof Error ? error.message : String(error) },
          ...(error instanceof CliRequestError ? { data: error.body } : {}),
          ...(error instanceof CliWaitError
            ? { data: error.data, correlationId: error.correlationId }
            : {}),
          ...(error instanceof DaemonStartupError ? { data: error.diagnostics } : {}),
        }),
      );
    }
    throw error;
  }
  if (commandOutput) emitText(output, commandOutput.trimEnd());
}

export function classifyCliError(error: unknown): { category: string; exitCode: number } {
  if (error instanceof DaemonStartupError) {
    if (error.diagnostics.phase !== 'readiness')
      return { category: 'execution_failed', exitCode: 3 };
    return classifyCliError(error.cause);
  }
  if (
    error instanceof CliInputError ||
    error instanceof CliRequestError ||
    error instanceof CliWaitError ||
    error instanceof SkillPersistenceError ||
    error instanceof FrameSaveError ||
    error instanceof ArtifactInputError
  )
    return { category: error.category, exitCode: error.exitCode };
  if (error instanceof RenderBatchError)
    return {
      category: error.errors.some((failure) => failure.code === 'persistence_failed')
        ? 'persistence_failed'
        : 'render_failed',
      exitCode: error.errors.some((failure) => failure.code === 'persistence_failed') ? 6 : 5,
    };
  if (isFileSystemFailure(error)) return { category: 'persistence_failed', exitCode: 6 };
  if (/timed out|disconnect/i.test(error instanceof Error ? error.message : String(error)))
    return { category: 'result_unknown', exitCode: 4 };
  return { category: 'execution_failed', exitCode: 3 };
}

function recordingSelection(options: CliOptions): RecordingSelection {
  if (options.frame !== undefined && options.time === undefined && !options.match)
    return { frame: options.frame };
  if (options.frame === undefined && options.time !== undefined && options.match)
    return { time: options.time, match: options.match };
  throw new CliInputError('Specify --frame or both --time and --match.');
}

function sceneRenderOptions(options: CliOptions, includeTarget = true): SceneRenderOptions {
  return {
    ...(includeTarget
      ? { envId: options.env, chartId: options.chart, outputPath: options.output }
      : {}),
    width: options.width,
    height: options.height,
    viewport: options.viewport,
    format: options.format,
    quality: options.quality,
    backgroundColor: options.backgroundColor,
  };
}

function usesMachineOutputByDefault(argv: string[]): boolean {
  const commands: string[] = [];
  for (let index = 0; index < argv.length && commands.length < 2; index++) {
    const token = argv[index];
    if (['--context', '--context-dir', '--output-version'].includes(token)) {
      index++;
      continue;
    }
    if (token.startsWith('-')) continue;
    commands.push(token);
  }
  return (
    ['recording', 'frame'].includes(commands[0]) ||
    (['run', 'action'].includes(commands[0]) && commands[1] === 'wait')
  );
}

function parseQuery(input: unknown): ScenarioQuery {
  const parsed = ScenarioQuerySchema.safeParse(input);
  if (!parsed.success) throw new CliInputError(parsed.error.message);
  return parsed.data;
}
