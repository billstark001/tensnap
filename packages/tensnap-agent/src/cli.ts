#!/usr/bin/env -S node --import tsx

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  AgentRuntime,
  NodeCanvasEnvironmentPainter,
  resolveRuntimeContextPaths,
  RuntimeControlServer,
} from './index';
import {
  isProcessAlive,
  readRuntimeControl,
  type RuntimeContextPaths,
} from './runtime/context';
import type { ProtocolEncoding } from '@tensnap/core/protocol';
import type { RenderTriggerMode } from './types';

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

const DEFAULT_RUNTIME_READY_TIMEOUT_MS = 10000;

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    index += 1;
  }

  return { positional, flags };
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
  if (Number.isNaN(parsedValue)) {
    throw new Error(`Flag --${key} must be a valid number.`);
  }
  return parsedValue;
}

function parseJsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function parseViewportFlag(raw?: string): { x: number; y: number; width: number; height: number } | undefined {
  if (!raw) {
    return undefined;
  }

  const value = parseJsonValue(raw);
  if (
    typeof value === 'object'
    && value !== null
    && typeof (value as Record<string, unknown>).x === 'number'
    && typeof (value as Record<string, unknown>).y === 'number'
    && typeof (value as Record<string, unknown>).width === 'number'
    && typeof (value as Record<string, unknown>).height === 'number'
  ) {
    return value as { x: number; y: number; width: number; height: number };
  }

  throw new Error('Flag --viewport must be a JSON object: {"x":0,"y":0,"width":10,"height":10}.');
}

function buildBaseUrl(control: { host: string; controlPort: number | null }): string {
  if (!control.controlPort) {
    throw new Error('Runtime control port is not available.');
  }
  return `http://${control.host}:${control.controlPort}`;
}

async function resolveRunningRuntime(context: RuntimeContextPaths): Promise<{ baseUrl: string } | null> {
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
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function waitForDaemon(context: RuntimeContextPaths, timeoutMs = 5000): Promise<{ baseUrl: string }> {
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

  const runtime = new AgentRuntime(context, {
    host: getStringFlag(parsed, 'host'),
    controlPort: getStringFlag(parsed, 'port') ? Number(getStringFlag(parsed, 'port')) : undefined,
    encoding: (getStringFlag(parsed, 'encoding') as ProtocolEncoding | undefined) ?? 'msgpack',
    render: {
      trigger: (getStringFlag(parsed, 'render-trigger') as RenderTriggerMode | undefined) ?? 'manual',
    },
  });
  await runtime.initialize();
  runtime.registerPainter(
    new NodeCanvasEnvironmentPainter({
      capturesDir: context.capturesDir,
      defaultFormat: 'png',
    }),
  );

  const server = new RuntimeControlServer(runtime, {
    host: getStringFlag(parsed, 'host'),
    port: getStringFlag(parsed, 'port') ? Number(getStringFlag(parsed, 'port')) : undefined,
  });
  const address = await server.listen();

  const simulatorUrl = getStringFlag(parsed, 'simulator-url');
  if (simulatorUrl) {
    await runtime.connect({
      simulatorUrl,
      encoding: (getStringFlag(parsed, 'encoding') as ProtocolEncoding | undefined) ?? 'msgpack',
    });
    await runtime.waitUntilReady(DEFAULT_RUNTIME_READY_TIMEOUT_MS);
  }

  console.log(JSON.stringify({
    status: runtime.getStatus(),
    control: address,
  }, null, 2));

  const shutdown = async (): Promise<void> => {
    await runtime.stop();
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

async function startBackgroundDaemon(parsed: ParsedArgs): Promise<void> {
  const context = resolveRuntimeContextPaths({
    contextName: getStringFlag(parsed, 'context'),
    rootDir: getStringFlag(parsed, 'context-dir'),
  });

  const running = await resolveRunningRuntime(context);
  if (running) {
    console.log(JSON.stringify(await requestJson(running.baseUrl, '/v1/runtime/status'), null, 2));
    return;
  }

  const scriptPath = fileURLToPath(import.meta.url);
  const childArgs = [
    ...process.execArgv,
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
  if (simulatorUrl) {
    childArgs.push('--simulator-url', simulatorUrl);
  }

  const host = getStringFlag(parsed, 'host');
  if (host) {
    childArgs.push('--host', host);
  }

  const port = getStringFlag(parsed, 'port');
  if (port) {
    childArgs.push('--port', port);
  }

  const encoding = getStringFlag(parsed, 'encoding');
  if (encoding) {
    childArgs.push('--encoding', encoding);
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
  console.log(JSON.stringify(await requestJson(ready.baseUrl, '/v1/runtime/status'), null, 2));
}

async function stopDaemon(parsed: ParsedArgs): Promise<void> {
  const context = resolveRuntimeContextPaths({
    contextName: getStringFlag(parsed, 'context'),
    rootDir: getStringFlag(parsed, 'context-dir'),
  });
  const running = await resolveRunningRuntime(context);
  if (running) {
    await requestJson(running.baseUrl, '/v1/runtime/stop', { method: 'POST' });
    return;
  }

  const control = await readRuntimeControl(context);
  if (control?.pid && isProcessAlive(control.pid)) {
    process.kill(control.pid, 'SIGTERM');
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
    console.log(JSON.stringify(await requestJson(running.baseUrl, '/v1/runtime/status'), null, 2));
    return;
  }

  const control = await readRuntimeControl(context);
  console.log(JSON.stringify(control ?? { context: context.contextName, running: false }, null, 2));
}

async function printLogs(parsed: ParsedArgs): Promise<void> {
  const context = resolveRuntimeContextPaths({
    contextName: getStringFlag(parsed, 'context'),
    rootDir: getStringFlag(parsed, 'context-dir'),
  });
  try {
    const raw = await readFile(context.logFile, 'utf8');
    console.log(raw);
  } catch {
    console.log('');
  }
}

async function requireRuntime(parsed: ParsedArgs): Promise<{ context: RuntimeContextPaths; baseUrl: string }> {
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
      console.log(JSON.stringify(JSON.parse(data), null, 2));
    }
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const [group, command, ...rest] = parsed.positional;

  if (group === 'daemon' && command === 'serve') {
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
      console.log(JSON.stringify(await requestJson(baseUrl, '/v1/runtime/status'), null, 2));
      return;
    }
    console.log(JSON.stringify(
      await requestJson(baseUrl, '/v1/runtime/render-trigger', {
        method: 'POST',
        body: JSON.stringify({ trigger }),
      }),
      null,
      2,
    ));
    return;
  }

  if (group === 'scene' && command === 'inspect') {
    const { baseUrl } = await requireRuntime(parsed);
    console.log(JSON.stringify(await requestJson(baseUrl, '/v1/scene'), null, 2));
    return;
  }

  if (group === 'scene' && command === 'snapshot') {
    const { baseUrl } = await requireRuntime(parsed);
    console.log(JSON.stringify(await requestJson(baseUrl, '/v1/scene/snapshot'), null, 2));
    return;
  }

  if (group === 'scene' && command === 'sync') {
    const { baseUrl } = await requireRuntime(parsed);
    console.log(JSON.stringify(await requestJson(baseUrl, '/v1/runtime/sync', { method: 'POST' }), null, 2));
    return;
  }

  if (group === 'scene' && ['start', 'step', 'reset'].includes(command ?? '')) {
    const { baseUrl } = await requireRuntime(parsed);
    console.log(JSON.stringify(
      await requestJson(baseUrl, `/v1/scene/actions/${command}`, {
        method: 'POST',
        body: JSON.stringify({ continuous: parsed.flags.continuous === true }),
      }),
      null,
      2,
    ));
    return;
  }

  if (group === 'scene' && command === 'render') {
    const { baseUrl } = await requireRuntime(parsed);
    const viewport = parseViewportFlag(getStringFlag(parsed, 'viewport'));
    console.log(JSON.stringify(
      await requestJson(baseUrl, '/v1/scene/render', {
        method: 'POST',
        body: JSON.stringify({
          reason: rest[0] ?? 'manual',
          envId: getStringFlag(parsed, 'env'),
          width: getNumberFlag(parsed, 'width'),
          height: getNumberFlag(parsed, 'height'),
          format: getStringFlag(parsed, 'format'),
          quality: getNumberFlag(parsed, 'quality'),
          outputPath: getStringFlag(parsed, 'output'),
          viewport,
        }),
      }),
      null,
      2,
    ));
    return;
  }

  if (group === 'param' && command === 'list') {
    const { baseUrl } = await requireRuntime(parsed);
    console.log(JSON.stringify(await requestJson(baseUrl, '/v1/params'), null, 2));
    return;
  }

  if (group === 'param' && command === 'set') {
    const [parameterId, rawValue] = rest;
    if (!parameterId || rawValue === undefined) {
      throw new Error('Usage: tensnap-agent param set <parameter-id> <json-value>');
    }
    const { baseUrl } = await requireRuntime(parsed);
    console.log(JSON.stringify(
      await requestJson(baseUrl, `/v1/params/${encodeURIComponent(parameterId)}`, {
        method: 'POST',
        body: JSON.stringify({ value: parseJsonValue(rawValue) }),
      }),
      null,
      2,
    ));
    return;
  }

  if (group === 'action' && command === 'list') {
    const { baseUrl } = await requireRuntime(parsed);
    console.log(JSON.stringify(await requestJson(baseUrl, '/v1/actions'), null, 2));
    return;
  }

  if (group === 'action' && command === 'run') {
    const [actionId] = rest;
    if (!actionId) {
      throw new Error('Usage: tensnap-agent action run <action-id> [--continuous]');
    }
    const { baseUrl } = await requireRuntime(parsed);
    console.log(JSON.stringify(
      await requestJson(baseUrl, `/v1/actions/${encodeURIComponent(actionId)}`, {
        method: 'POST',
        body: JSON.stringify({ continuous: parsed.flags.continuous === true }),
      }),
      null,
      2,
    ));
    return;
  }

  if (group === 'chart' && command === 'list') {
    const { baseUrl } = await requireRuntime(parsed);
    console.log(JSON.stringify(await requestJson(baseUrl, '/v1/charts'), null, 2));
    return;
  }

  if (group === 'chart' && command === 'get') {
    const [chartId] = rest;
    if (!chartId) {
      throw new Error('Usage: tensnap-agent chart get <chart-id>');
    }
    const { baseUrl } = await requireRuntime(parsed);
    console.log(JSON.stringify(await requestJson(baseUrl, `/v1/charts/${encodeURIComponent(chartId)}`), null, 2));
    return;
  }

  if (group === 'asset' && command === 'list') {
    const { baseUrl } = await requireRuntime(parsed);
    console.log(JSON.stringify(await requestJson(baseUrl, '/v1/assets'), null, 2));
    return;
  }

  if (group === 'wait' && command === 'action-end') {
    const [actionId] = rest;
    const { baseUrl } = await requireRuntime(parsed);
    console.log(JSON.stringify(
      await requestJson(baseUrl, '/v1/wait/action-end', {
        method: 'POST',
        body: JSON.stringify({
          id: actionId,
          timeoutMs: getNumberFlag(parsed, 'timeout-ms'),
        }),
      }),
      null,
      2,
    ));
    return;
  }

  if (group === 'wait' && command === 'time') {
    const [rawTime] = rest;
    if (rawTime === undefined) {
      throw new Error('Usage: tensnap-agent wait time <time> [--comparison <op>] [--timeout-ms <ms>]');
    }
    const time = Number(rawTime);
    if (Number.isNaN(time)) {
      throw new Error('Time must be a valid number.');
    }
    const { baseUrl } = await requireRuntime(parsed);
    console.log(JSON.stringify(
      await requestJson(baseUrl, '/v1/wait/time', {
        method: 'POST',
        body: JSON.stringify({
          time,
          comparison: getStringFlag(parsed, 'comparison'),
          timeoutMs: getNumberFlag(parsed, 'timeout-ms'),
        }),
      }),
      null,
      2,
    ));
    return;
  }

  if (group === 'wait' && command === 'chart') {
    const [chartId, rawValue] = rest;
    if (!chartId || rawValue === undefined) {
      throw new Error('Usage: tensnap-agent wait chart <chart-id> <value> [--comparison <op>] [--at-time <time>] [--timeout-ms <ms>]');
    }
    const value = Number(rawValue);
    if (Number.isNaN(value)) {
      throw new Error('Chart wait value must be a valid number.');
    }
    const { baseUrl } = await requireRuntime(parsed);
    console.log(JSON.stringify(
      await requestJson(baseUrl, '/v1/wait/chart', {
        method: 'POST',
        body: JSON.stringify({
          id: chartId,
          value,
          comparison: getStringFlag(parsed, 'comparison'),
          atTime: getNumberFlag(parsed, 'at-time'),
          timeoutMs: getNumberFlag(parsed, 'timeout-ms'),
        }),
      }),
      null,
      2,
    ));
    return;
  }

  if (group === 'wait' && command === 'metadata') {
    const [path, rawValue] = rest;
    if (!path) {
      throw new Error('Usage: tensnap-agent wait metadata <path> [json-value] [--comparison <op>] [--timeout-ms <ms>]');
    }
    const { baseUrl } = await requireRuntime(parsed);
    console.log(JSON.stringify(
      await requestJson(baseUrl, '/v1/wait/metadata', {
        method: 'POST',
        body: JSON.stringify({
          path,
          value: rawValue === undefined ? undefined : parseJsonValue(rawValue),
          comparison: getStringFlag(parsed, 'comparison'),
          timeoutMs: getNumberFlag(parsed, 'timeout-ms'),
        }),
      }),
      null,
      2,
    ));
    return;
  }

  if (group === 'experiment' && command === 'run') {
    const rawSpec = rest.join(' ').trim();
    if (!rawSpec) {
      throw new Error('Usage: tensnap-agent experiment run <json-spec>');
    }
    const spec = parseJsonValue(rawSpec);
    if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
      throw new Error('Experiment spec must be a JSON object.');
    }
    const { baseUrl } = await requireRuntime(parsed);
    console.log(JSON.stringify(
      await requestJson(baseUrl, '/v1/experiment/run', {
        method: 'POST',
        body: JSON.stringify(spec),
      }),
      null,
      2,
    ));
    return;
  }

  if (group === 'stream' && command === 'events') {
    await streamEvents(parsed);
    return;
  }

  console.log([
    'Usage:',
    '  tensnap-agent runtime up --simulator-url ws://127.0.0.1:8765',
    '  tensnap-agent runtime status',
    '  tensnap-agent runtime render-trigger manual|action-end',
    '  tensnap-agent scene inspect',
    '  tensnap-agent scene snapshot',
    '  tensnap-agent scene start|step|reset',
    '  tensnap-agent scene render [reason] [--env <env-id>] [--width <px>] [--height <px>] [--viewport <json>] [--output <path>]',
    '  tensnap-agent param list',
    '  tensnap-agent param set <parameter-id> <json-value>',
    '  tensnap-agent action list',
    '  tensnap-agent action run <action-id> [--continuous]',
    '  tensnap-agent chart list',
    '  tensnap-agent chart get <chart-id>',
    '  tensnap-agent asset list',
    '  tensnap-agent wait action-end [action-id] [--timeout-ms <ms>]',
    '  tensnap-agent wait time <time> [--comparison <op>] [--timeout-ms <ms>]',
    '  tensnap-agent wait chart <chart-id> <value> [--comparison <op>] [--at-time <time>] [--timeout-ms <ms>]',
    '  tensnap-agent wait metadata <path> [json-value] [--comparison <op>] [--timeout-ms <ms>]',
    '  tensnap-agent experiment run <json-spec>',
    '  tensnap-agent stream events',
  ].join('\n'));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});