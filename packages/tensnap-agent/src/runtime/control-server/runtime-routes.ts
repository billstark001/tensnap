// #region Imports
import { readFile } from 'node:fs/promises';
import type { Hono } from 'hono';
import type { AgentRuntime } from '../AgentRuntime';
import type { RenderTriggerMode, RuntimeEvent, RuntimeLogEntry } from '../../types';
import type { RuntimeSseBroker } from './sse-broker';

// #endregion

// #region Routes

export function registerRuntimeRoutes(
  app: Hono,
  runtime: AgentRuntime,
  broker: RuntimeSseBroker,
  onShutdownRequested: () => void,
): void {
  app.get('/health', (c) => {
    return c.json({ ok: true, status: runtime.getStatus() });
  });

  app.get('/v1/events', (c) => {
    const event: RuntimeEvent = {
      type: 'runtime.connected',
      at: new Date().toISOString(),
      data: runtime.getStatus(),
    };
    return broker.createResponse(event, c.req.raw.signal);
  });

  app.get('/v1/runtime/status', (c) => {
    return c.json(runtime.getStatus());
  });

  app.get('/v1/runtime/logs', async (c) => {
    let entries: RuntimeLogEntry[] = [];
    try {
      const raw = await readFile(runtime.context.logFile, 'utf8');
      entries = raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RuntimeLogEntry);
    } catch {
      entries = [];
    }
    return c.json(entries);
  });

  app.post('/v1/runtime/connect', async (c) => {
    const body = await c.req.json<{ simulatorUrl: string; encoding?: 'json' | 'msgpack' }>();
    return c.json(await runtime.connect(body));
  });

  app.post('/v1/runtime/wait-ready', async (c) => {
    const body = await c.req.json<{ timeoutMs?: number }>().catch(() => ({ timeoutMs: undefined }));
    return c.json(await runtime.waitUntilReady(body.timeoutMs));
  });

  app.post('/v1/runtime/disconnect', async (c) => {
    await runtime.disconnect();
    return c.json(runtime.getStatus());
  });

  app.post('/v1/runtime/stop', (c) => {
    setImmediate(onShutdownRequested);
    return c.json({ stopping: true }, 202);
  });

  app.post('/v1/runtime/sync', async (c) => {
    await runtime.syncScene();
    return c.json(runtime.getStatus());
  });

  app.post('/v1/runtime/render-trigger', async (c) => {
    const body = await c.req.json<{ trigger: RenderTriggerMode }>();
    return c.json(await runtime.setRenderTrigger(body.trigger));
  });
}

// #endregion