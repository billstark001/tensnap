// #region Imports
import type { Hono } from 'hono';
import type { AgentRuntime } from '../AgentRuntime';

// #endregion

// #region Routes

export function registerWaitRoutes(app: Hono, runtime: AgentRuntime): void {
  app.post('/v1/wait/action-end', async (c) => {
    const body: { id?: string; timeoutMs?: number } = await c.req
      .json<{ id?: string; timeoutMs?: number }>()
      .catch(() => ({}));
    return c.json(
      await runtime.waitForActionEnd({
        id: body.id,
        timeoutMs: body.timeoutMs ?? 30_000,
      }),
    );
  });

  app.post('/v1/wait/time', async (c) => {
    const body = await c.req.json<{
      time: number;
      comparison?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
      timeoutMs?: number;
    }>();
    return c.json(
      await runtime.waitForTime({
        time: body.time,
        comparison: body.comparison,
        timeoutMs: body.timeoutMs ?? 30_000,
      }),
    );
  });

  app.post('/v1/wait/chart', async (c) => {
    const body = await c.req.json<{
      id: string;
      value: number;
      comparison?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
      atTime?: number;
      timeoutMs?: number;
    }>();
    return c.json(
      await runtime.waitForChart({
        id: body.id,
        value: body.value,
        comparison: body.comparison,
        atTime: body.atTime,
        timeoutMs: body.timeoutMs ?? 30_000,
      }),
    );
  });

  app.post('/v1/wait/metadata', async (c) => {
    const body = await c.req.json<{
      path: string;
      value?: unknown;
      comparison?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists';
      timeoutMs?: number;
    }>();
    return c.json(
      await runtime.waitForMetadata({
        path: body.path,
        value: body.value,
        comparison: body.comparison,
        timeoutMs: body.timeoutMs ?? 30_000,
      }),
    );
  });

  app.post('/v1/experiment/run', async (c) => {
    const body = await c.req.json<{
      label?: string;
      parameters?: Record<string, unknown>;
      reset?: boolean | { enabled?: boolean; actionId?: string; continuous?: boolean; timeoutMs?: number };
      action?: { id: string; continuous?: boolean; waitForEnd?: boolean; timeoutMs?: number };
      waits?: Array<
        | { kind: 'action-end'; id?: string; timeoutMs?: number }
        | { kind: 'time'; time: number; comparison?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; timeoutMs?: number }
        | { kind: 'chart'; id: string; value: number; comparison?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; atTime?: number; timeoutMs?: number }
        | { kind: 'metadata'; path: string; value?: unknown; comparison?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists'; timeoutMs?: number }
      >;
      render?: {
        reason?: string;
        envId?: string;
        width?: number;
        height?: number;
        viewport?: { x: number; y: number; width: number; height: number };
        format?: 'png' | 'jpeg';
        quality?: number;
        outputPath?: string;
        persist?: boolean;
        includeData?: boolean;
      } | null;
      collect?: { scene?: boolean; snapshot?: boolean };
    }>();
    return c.json(await runtime.runExperiment(body));
  });
}

// #endregion