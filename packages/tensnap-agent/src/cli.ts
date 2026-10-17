import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  AgentRuntime,
  HeadlessEnvironmentPainter,
  HeadlessChartPainter,
  resolveRuntimeContextPaths,
  RuntimeControlServer,
} from './index';
import { isProcessAlive, readRuntimeControl, type RuntimeContextPaths } from './runtime/context';
import type { ProtocolEncoding, ProtocolValidationLevel } from '@tensnap/protocol';
import type { RenderTriggerMode } from './types';
import { parseIPFamily, listenerUrl } from '@tensnap/network';

import { parseArgs, CliInputError, type ParsedArgs } from './cli-arguments';

const DEFAULT_RUNTIME_READY_TIMEOUT_MS = 10000;

function getIPFamilyFlag(parsed: ParsedArgs) {
  if (parsed.flags['ip-family'] === true)
    throw new Error('--ip-family requires auto, ipv4, or ipv6.');
  return parseIPFamily(getStringFlag(parsed, 'ip-family'));
}

function getStringFlag(parsed: ParsedArgs, key: string): string | undefined {
  const value = parsed.flags[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumberFlag(parsed: ParsedArgs, key: string): number | undefined {
  const value = getStringFlag(parsed, key);
  if (value === undefined) {
    return undefined;
  }
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) {
    throw new Error(`Flag --${key} must be a finite number.`);
  }
  return parsedValue;
}

function getPortFlag(parsed: ParsedArgs): number | undefined {
  const port = getNumberFlag(parsed, 'port');
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    throw new Error('Flag --port must be an integer from 0 through 65535.');
  }
  return port;
}

function getValidationLevelFlag(
  parsed: ParsedArgs,
  key: string,
): ProtocolValidationLevel | undefined {
  const value = getStringFlag(parsed, key);
  if (value === undefined) return undefined;
  if (value === 'off' || value === 'warning' || value === 'error') return value;
  throw new Error(`Flag --${key} must be one of: off, warning, error.`);
}

function parseJsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function parseViewportFlag(
  raw?: string,
): { x: number; y: number; width: number; height: number } | undefined {
  if (!raw) {
    return undefined;
  }

  const value = parseJsonValue(raw);
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).x === 'number' &&
    typeof (value as Record<string, unknown>).y === 'number' &&
    typeof (value as Record<string, unknown>).width === 'number' &&
    typeof (value as Record<string, unknown>).height === 'number'
  ) {
    return value as { x: number; y: number; width: number; height: number };
  }

  throw new Error('Flag --viewport must be a JSON object: {"x":0,"y":0,"width":10,"height":10}.');
}

function getColorFlag(parsed: ParsedArgs, key: string): string | undefined {
  const value = getStringFlag(parsed, key)?.trim();
  return value ? value : undefined;
}

function buildBaseUrl(control: { host: string; controlPort: number | null }): string {
  if (!control.controlPort) {
    throw new Error('Runtime control port is not available.');
  }
  return listenerUrl({ address: control.host, port: control.controlPort }, 'http');
}

async function resolveRunningRuntime(
  context: RuntimeContextPaths,
): Promise<{ baseUrl: string } | null> {
  const control = await readRuntimeControl(context);
  if (!control?.controlPort) {
    return null;
  }

  try {
    const response = await fetch(`${buildBaseUrl(control)}/health`);
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

async function waitForDaemon(
  context: RuntimeContextPaths,
  timeoutMs = 5000,
): Promise<{ baseUrl: string }> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const running = await resolveRunningRuntime(context);
    if (running) {
      return running;
    }
    await delay(100);
  }

  throw new Error(`Timed out waiting for runtime daemon in context ${context.contextName}.`);
}

async function startForegroundDaemon(parsed: ParsedArgs): Promise<void> {
  const context = resolveRuntimeContextPaths({
    contextName: getStringFlag(parsed, 'context'),
    rootDir: getStringFlag(parsed, 'context-dir'),
  });
  const controlPort = getPortFlag(parsed);

  const runtime = new AgentRuntime(context, {
    ip_family: getIPFamilyFlag(parsed),
    host: getStringFlag(parsed, 'host'),
    controlPort,
    encoding: (getStringFlag(parsed, 'encoding') as ProtocolEncoding | undefined) ?? 'msgpack',
    clientMessageValidation: getValidationLevelFlag(parsed, 'client-message-validation'),
    serverMessageValidation: getValidationLevelFlag(parsed, 'server-message-validation'),
    maxRunStepsPolicy: getNumberFlag(parsed, 'max-steps-policy'),
    render: {
      trigger:
        (getStringFlag(parsed, 'render-trigger') as RenderTriggerMode | undefined) ?? 'manual',
      backgroundColor: getColorFlag(parsed, 'background-color'),
    },
  });
  await runtime.initialize();
  runtime.registerPainter(
    new HeadlessEnvironmentPainter({
      capturesDir: context.capturesDir,
      defaultFormat: 'png',
      backgroundColor: getColorFlag(parsed, 'background-color'),
    }),
  );
  runtime.registerPainter(
    new HeadlessChartPainter({
      capturesDir: context.capturesDir,
      defaultFormat: 'png',
    }),
  );

  const server = new RuntimeControlServer(runtime, {
    ip_family: getIPFamilyFlag(parsed),
    host: getStringFlag(parsed, 'host'),
    port: controlPort,
  });
  const address = await server.listen();

  const simulatorUrl = getStringFlag(parsed, 'simulator-url');
  if (simulatorUrl) {
    await runtime.connect({
      ip_family: getIPFamilyFlag(parsed),
      simulatorUrl,
      encoding: (getStringFlag(parsed, 'encoding') as ProtocolEncoding | undefined) ?? 'msgpack',
      clientMessageValidation: getValidationLevelFlag(parsed, 'client-message-validation'),
      serverMessageValidation: getValidationLevelFlag(parsed, 'server-message-validation'),
    });
    await runtime.waitUntilReady(DEFAULT_RUNTIME_READY_TIMEOUT_MS);
  }

  printJson(parsed, {
    status: runtime.getStatus(),
    control: address,
  });

  const shutdown = async (): Promise<void> => {
    await runtime.stop();
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

async function startBackgroundDaemon(parsed: ParsedArgs): Promise<void> {
  const ipFamily = getIPFamilyFlag(parsed);
  const port = getPortFlag(parsed);
  const context = resolveRuntimeContextPaths({
    contextName: getStringFlag(parsed, 'context'),
    rootDir: getStringFlag(parsed, 'context-dir'),
  });

  const running = await resolveRunningRuntime(context);
  if (running) {
    printJson(parsed, await requestJson(running.baseUrl, '/v1/runtime/status'));
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
    (getStringFlag(parsed, 'render-trigger') as RenderTriggerMode | undefined) ?? 'manual',
  ];

  const simulatorUrl = getStringFlag(parsed, 'simulator-url');
  childArgs.push('--ip-family', ipFamily);
  if (simulatorUrl) {
    childArgs.push('--simulator-url', simulatorUrl);
  }

  const host = getStringFlag(parsed, 'host');
  if (host) {
    childArgs.push('--host', host);
  }

  if (port !== undefined) {
    childArgs.push('--port', String(port));
  }

  const encoding = getStringFlag(parsed, 'encoding');
  if (encoding) {
    childArgs.push('--encoding', encoding);
  }

  const backgroundColor = getColorFlag(parsed, 'background-color');
  if (backgroundColor) {
    childArgs.push('--background-color', backgroundColor);
  }

  const maxStepsPolicy = getStringFlag(parsed, 'max-steps-policy');
  if (maxStepsPolicy) {
    childArgs.push('--max-steps-policy', maxStepsPolicy);
  }

  for (const key of ['client-message-validation', 'server-message-validation'] as const) {
    const level = getValidationLevelFlag(parsed, key);
    if (level !== undefined) childArgs.push(`--${key}`, level);
  }

  const child = spawn(process.execPath, childArgs, {
    cwd: context.cwd,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  const ready = await waitForDaemon(context);
  if (simulatorUrl) {
    await requestJson(ready.baseUrl, '/v1/runtime/wait-ready', {
      method: 'POST',
      body: JSON.stringify({ timeoutMs: DEFAULT_RUNTIME_READY_TIMEOUT_MS }),
    });
  }
  printJson(parsed, await requestJson(ready.baseUrl, '/v1/runtime/status'));
}

async function stopDaemon(parsed: ParsedArgs): Promise<void> {
  const context = resolveRuntimeContextPaths({
    contextName: getStringFlag(parsed, 'context'),
    rootDir: getStringFlag(parsed, 'context-dir'),
  });
  const running = await resolveRunningRuntime(context);
  if (running) {
    const result = await requestJson(running.baseUrl, '/v1/runtime/stop', { method: 'POST' });
    if (parsed.flags['output-version'] === '1') printJson(parsed, result);
    return;
  }

  const control = await readRuntimeControl(context);
  if (control?.pid && isProcessAlive(control.pid)) {
    process.kill(control.pid, 'SIGTERM');
    if (parsed.flags['output-version'] === '1') printJson(parsed, { stopping: true });
    return;
  }

  throw new Error(`No running daemon found for context ${context.contextName}.`);
}

async function printStatus(parsed: ParsedArgs): Promise<void> {
  const context = resolveRuntimeContextPaths({
    contextName: getStringFlag(parsed, 'context'),
    rootDir: getStringFlag(parsed, 'context-dir'),
  });
  const running = await resolveRunningRuntime(context);
  if (running) {
    printJson(parsed, await requestJson(running.baseUrl, '/v1/runtime/status'));
    return;
  }

  const control = await readRuntimeControl(context);
  printJson(parsed, control ?? { context: context.contextName, running: false });
}

async function printLogs(parsed: ParsedArgs): Promise<void> {
  const context = resolveRuntimeContextPaths({
    contextName: getStringFlag(parsed, 'context'),
    rootDir: getStringFlag(parsed, 'context-dir'),
  });
  try {
    const raw = await readFile(context.logFile, 'utf8');
    emitText(parsed, raw);
  } catch {
    emitText(parsed, '');
  }
}

async function requireRuntime(
  parsed: ParsedArgs,
): Promise<{ context: RuntimeContextPaths; baseUrl: string }> {
  const context = resolveRuntimeContextPaths({
    contextName: getStringFlag(parsed, 'context'),
    rootDir: getStringFlag(parsed, 'context-dir'),
  });
  const running = await resolveRunningRuntime(context);
  if (!running) {
    throw new Error(`No running daemon found for context ${context.contextName}.`);
  }
  return { context, baseUrl: running.baseUrl };
}

async function streamEvents(parsed: ParsedArgs): Promise<void> {
  const { baseUrl } = await requireRuntime(parsed);
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
      printJson(parsed, JSON.parse(data));
    }
  }
}

async function execute(parsed: ParsedArgs): Promise<void> {
  const [group, command, ...rest] = parsed.flags.help ? [] : parsed.positional;

  if (!parsed.flags.help && group === 'daemon' && command === 'serve') {
    await startForegroundDaemon(parsed);
    return;
  }

  if (group === 'runtime' && command === 'up') {
    if (parsed.flags.foreground) {
      await startForegroundDaemon(parsed);
      return;
    }
    await startBackgroundDaemon(parsed);
    return;
  }

  if (group === 'runtime' && command === 'down') {
    await stopDaemon(parsed);
    return;
  }

  if (group === 'runtime' && command === 'status') {
    await printStatus(parsed);
    return;
  }

  if (group === 'runtime' && command === 'logs') {
    await printLogs(parsed);
    return;
  }

  if (group === 'runtime' && command === 'render-trigger') {
    const { baseUrl } = await requireRuntime(parsed);
    const trigger = rest[0] as RenderTriggerMode | undefined;
    if (!trigger) {
      printJson(parsed, await requestJson(baseUrl, '/v1/runtime/status'));
      return;
    }
    printJson(
      parsed,
      await requestJson(baseUrl, '/v1/runtime/render-trigger', {
        method: 'POST',
        body: JSON.stringify({ trigger }),
      }),
    );
    return;
  }

  if (group === 'scene' && command === 'inspect') {
    const { baseUrl } = await requireRuntime(parsed);
    printJson(parsed, await requestJson(baseUrl, '/v1/scene'));
    return;
  }

  if (group === 'scene' && command === 'snapshot') {
    const { baseUrl } = await requireRuntime(parsed);
    printJson(parsed, await requestJson(baseUrl, '/v1/scene/snapshot'));
    return;
  }

  if (group === 'scene' && command === 'capture') {
    const { baseUrl } = await requireRuntime(parsed);
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
    const outputPath = getStringFlag(parsed, 'output');
    if (outputPath) {
      await writeFile(outputPath, `${JSON.stringify(capture, null, 2)}\n`, 'utf8');
    }
    printJson(parsed, capture);
    return;
  }

  if (group === 'scene' && command === 'restore') {
    const checkpointPath = getStringFlag(parsed, 'checkpoint');
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
    const time = getNumberFlag(parsed, 'time');
    if (time !== undefined || capturedTime !== undefined) input.time = time ?? capturedTime;
    const parameters = getStringFlag(parsed, 'parameters');
    if (parameters !== undefined) input.parameters = parseJsonValue(parameters);
    const envs = getStringFlag(parsed, 'envs');
    if (envs !== undefined) input.envs = parseJsonValue(envs);
    const chartPolicy = getStringFlag(parsed, 'chart-policy');
    if (chartPolicy !== undefined) input.chartPolicy = chartPolicy;
    if (Object.keys(input).length === 0) {
      throw new Error(
        'Usage: tensnap-agent scene restore --checkpoint <capture.json> [--time <n>] [--parameters <json>] [--envs <json>]',
      );
    }
    const { baseUrl } = await requireRuntime(parsed);
    printJson(
      parsed,
      await requestJson(baseUrl, '/v1/scene/restore', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    );
    return;
  }

  if (group === 'scene' && command === 'sync') {
    const { baseUrl } = await requireRuntime(parsed);
    printJson(parsed, await requestJson(baseUrl, '/v1/runtime/sync', { method: 'POST' }));
    return;
  }

  if (group === 'scene' && command === 'render') {
    const { baseUrl } = await requireRuntime(parsed);
    const viewport = parseViewportFlag(getStringFlag(parsed, 'viewport'));
    const envId = getStringFlag(parsed, 'env');
    const chartId = getStringFlag(parsed, 'chart');
    if (envId && chartId) {
      throw new Error('Flags --env and --chart are mutually exclusive.');
    }
    printJson(
      parsed,
      await requestJson(baseUrl, '/v1/scene/render', {
        method: 'POST',
        body: JSON.stringify({
          reason: rest[0] ?? 'manual',
          envId,
          chartId,
          width: getNumberFlag(parsed, 'width'),
          height: getNumberFlag(parsed, 'height'),
          format: getStringFlag(parsed, 'format'),
          quality: getNumberFlag(parsed, 'quality'),
          backgroundColor: getColorFlag(parsed, 'background-color'),
          outputPath: getStringFlag(parsed, 'output'),
          viewport,
        }),
      }),
    );
    return;
  }

  if (group === 'param' && command === 'list') {
    const { baseUrl } = await requireRuntime(parsed);
    printJson(parsed, await requestJson(baseUrl, '/v1/params'));
    return;
  }

  if (group === 'param' && command === 'set') {
    const [parameterId, rawValue] = rest;
    if (!parameterId || rawValue === undefined) {
      throw new Error('Usage: tensnap-agent param set <parameter-id> <json-value>');
    }
    const { baseUrl } = await requireRuntime(parsed);
    printJson(
      parsed,
      await requestJson(baseUrl, `/v1/params/${encodeURIComponent(parameterId)}`, {
        method: 'POST',
        body: JSON.stringify({ value: parseJsonValue(rawValue) }),
      }),
    );
    return;
  }

  if (group === 'action' && command === 'list') {
    const { baseUrl } = await requireRuntime(parsed);
    printJson(parsed, await requestJson(baseUrl, '/v1/actions'));
    return;
  }

  if (group === 'action' && command === 'run') {
    const [actionId] = rest;
    if (!actionId) {
      throw new Error('Usage: tensnap-agent action run <action-id>');
    }
    const { baseUrl } = await requireRuntime(parsed);
    printJson(
      parsed,
      await requestJson(baseUrl, `/v1/actions/${encodeURIComponent(actionId)}`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    return;
  }

  if (group === 'run' && command === 'start') {
    const [actionId] = rest;
    const maxSteps = getNumberFlag(parsed, 'max-actions') ?? getNumberFlag(parsed, 'max-steps');
    if (!actionId || maxSteps === undefined) {
      throw new Error(
        'Usage: tensnap-agent run start <action-id> --max-actions <n> [--stop-when <expr>] [--max-wall-time-ms <ms>]',
      );
    }
    const { baseUrl } = await requireRuntime(parsed);
    printJson(
      parsed,
      await requestJson(baseUrl, '/v1/runs', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'bounded',
          actionId,
          maxSteps,
          stopWhen: getStringFlag(parsed, 'stop-when'),
          maxWallTimeMs: getNumberFlag(parsed, 'max-wall-time-ms'),
          record: parsed.flags.record === true,
        }),
      }),
    );
    return;
  }

  if (group === 'run' && command === 'status') {
    const { baseUrl } = await requireRuntime(parsed);
    printJson(parsed, await requestJson(baseUrl, '/v1/runs'));
    return;
  }

  if (group === 'run' && command === 'stop') {
    const { baseUrl } = await requireRuntime(parsed);
    printJson(parsed, await requestJson(baseUrl, '/v1/runs', { method: 'DELETE' }));
    return;
  }

  if (group === 'chart' && command === 'list') {
    const { baseUrl } = await requireRuntime(parsed);
    printJson(parsed, await requestJson(baseUrl, '/v1/charts'));
    return;
  }

  if (group === 'chart' && command === 'get') {
    const [chartId] = rest;
    if (!chartId) {
      throw new Error('Usage: tensnap-agent chart get <chart-id>');
    }
    const { baseUrl } = await requireRuntime(parsed);
    printJson(parsed, await requestJson(baseUrl, `/v1/charts/${encodeURIComponent(chartId)}`));
    return;
  }

  if (group === 'asset' && command === 'list') {
    const { baseUrl } = await requireRuntime(parsed);
    printJson(parsed, await requestJson(baseUrl, '/v1/assets'));
    return;
  }

  if (group === 'stream' && command === 'events') {
    await streamEvents(parsed);
    return;
  }

  emitText(
    parsed,
    [
      'Usage:',
      '  Global: --context <name> --context-dir <path> --output-version 1',
      '  --max-steps remains a deprecated public spelling of --max-actions; do not combine them.',
      '  tensnap-agent runtime up --simulator-url ws://localhost:8765 [--ip-family auto|ipv4|ipv6] [--client-message-validation off|warning|error] [--server-message-validation off|warning|error] [--background-color <css-color>] [--max-steps-policy <n>]',
      '  tensnap-agent runtime status',
      '  tensnap-agent runtime render-trigger manual|action-result',
      '  tensnap-agent scene inspect',
      '  tensnap-agent scene snapshot',
      '  tensnap-agent scene capture [--output <capture.json>]',
      '  tensnap-agent scene restore --checkpoint <capture.json> [--time <n>] [--parameters <json>] [--envs <json>] [--chart-policy preserve|replace|truncate]',
      '  tensnap-agent scene render [reason] [--env <env-id> | --chart <chart-id>] [--width <px>] [--height <px>] [--viewport <json>] [--background-color <css-color>] [--output <path>]',
      '  tensnap-agent param list',
      '  tensnap-agent param set <parameter-id> <json-value>',
      '  tensnap-agent action list',
      '  tensnap-agent action run <action-id>',
      '  tensnap-agent run start <action-id> --max-actions <n> [--stop-when <expr>] [--max-wall-time-ms <ms>] [--record]',
      '  tensnap-agent run status',
      '  tensnap-agent run stop',
      '  tensnap-agent chart list',
      '  tensnap-agent chart get <chart-id>',
      '  tensnap-agent asset list',
      '  tensnap-agent stream events',
    ].join('\n'),
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

function printJson(parsed: ParsedArgs, data: unknown): void {
  if (parsed.flags['output-version'] !== '1') {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  const record = data as { requestId?: string; request_id?: string; run?: { id?: string } } | null;
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      ok: true,
      data,
      correlationId: record?.requestId ?? record?.request_id ?? record?.run?.id,
    }),
  );
}

function emitText(parsed: ParsedArgs, value: string): void {
  if (parsed.flags['output-version'] === '1') printJson(parsed, value);
  else console.log(value);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    await execute(parseArgs(argv));
  } catch (error) {
    if (
      (argv.includes('--output-version') && argv[argv.indexOf('--output-version') + 1] === '1') ||
      argv.includes('--output-version=1')
    ) {
      const category = classifyCliError(error).category;
      console.log(
        JSON.stringify({
          schemaVersion: 1,
          ok: false,
          error: { category, message: error instanceof Error ? error.message : String(error) },
          ...(error instanceof CliRequestError ? { data: error.body } : {}),
        }),
      );
    }
    throw error;
  }
}

export function classifyCliError(error: unknown): { category: string; exitCode: number } {
  if (error instanceof CliInputError || error instanceof CliRequestError)
    return { category: error.category, exitCode: error.exitCode };
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (
    code &&
    ['EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EISDIR', 'ENOTDIR', 'EROFS', 'EDQUOT'].includes(code)
  )
    return { category: 'persistence_failed', exitCode: 6 };
  if (/timed out|disconnect/i.test(error instanceof Error ? error.message : String(error)))
    return { category: 'result_unknown', exitCode: 4 };
  return { category: 'execution_failed', exitCode: 3 };
}
