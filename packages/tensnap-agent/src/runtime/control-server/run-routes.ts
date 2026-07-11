import type { Hono } from 'hono';
import type { BoundedRunSpec } from '@tensnap/core/runtime';
import type { AgentRuntime } from '../AgentRuntime';

/** Shared bounded-run API for automation clients and the CLI. */
export function registerRunRoutes(app: Hono, runtime: AgentRuntime): void {
  app.get('/v1/runs', (c) => c.json({ run: runtime.getRun() }));

  app.post('/v1/runs', async (c) => {
    const body = await c.req.json<BoundedRunSpec>();
    try {
      return c.json({ run: runtime.startRun(body) }, 202);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.delete('/v1/runs', (c) => c.json({ run: runtime.stopRun() }));
}
