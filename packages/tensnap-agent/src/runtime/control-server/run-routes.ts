import type { Hono } from 'hono';
import type { BoundedRunSpec } from '@tensnap/core/runtime';
import type { AgentRuntime } from '../AgentRuntime';
import { validateFields, invalid } from './validation';
import { readJsonObject } from './json-body';

/** Shared bounded-run API for automation clients and the CLI. */
export function registerRunRoutes(app: Hono, runtime: AgentRuntime): void {
  app.get('/v1/runs/:runId', (c) => {
    const run = runtime.getRun(c.req.param('runId'));
    return run
      ? c.json({ run })
      : c.json({ error: 'Unknown or expired run ID.', category: 'input_error' }, 404);
  });
  app.get('/v1/runs', (c) => c.json({ run: runtime.getRun() }));

  app.post('/v1/runs', async (c) => {
    const body = await readJsonObject<BoundedRunSpec>(c.req);
    const { record, ...spec } = body;
    validateFields(
      spec,
      {
        mode: ['bounded'],
        actionId: 'string',
        maxSteps: 'integer',
        stopWhen: 'string',
        maxWallTimeMs: 'positive',
      },
      ['mode', 'actionId', 'maxSteps'],
    );
    if (record !== undefined && typeof record !== 'boolean') {
      if (!record || typeof record !== 'object' || Array.isArray(record))
        invalid('record must be a boolean or options object.');
      validateFields(record, {
        maxSteps: 'integer',
        maxBytes: 'positive',
        maxDurationMs: 'positive',
        ringBuffer: 'boolean',
        keyframeEvery: 'integer',
        id: 'string',
        label: 'string',
        timestamp: 'number',
        layerCodecs: 'object',
        modelIdentity: 'object',
        checkpoint: 'object',
        legacyCreateReplacement: 'boolean',
      });
    }
    try {
      return c.json(
        { run: runtime.startRun({ ...spec, record: (record as unknown) === true ? {} : record }) },
        202,
      );
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.delete('/v1/runs', (c) => c.json({ run: runtime.stopRun() }));
}
