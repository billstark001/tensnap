import type { Hono } from 'hono';
import type { BoundedRunSpec } from '@tensnap/core/runtime';
import { isEncodedBinaryString } from '@tensnap/protocol';
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
      if (record.layerCodecs) {
        for (const codec of Object.values(record.layerCodecs)) {
          if (!['delta', 'keyframe', 'adaptive', 'derived'].includes(codec))
            invalid('record.layerCodecs values must be delta, keyframe, adaptive or derived.');
        }
      }
      if (record.modelIdentity) {
        validateFields(
          record.modelIdentity,
          { model_id: 'string', state_schema_version: 'string', instance_id: 'string' },
          ['model_id'],
        );
      }
      if (record.checkpoint) {
        const { data, ...metadata } = record.checkpoint;
        validateFields(
          metadata,
          { model_id: 'string', state_schema_version: 'string', encoding: 'string' },
          ['model_id', 'encoding'],
        );
        if (typeof data !== 'string' || !isEncodedBinaryString(data))
          invalid('record.checkpoint.data must be encoded binary data.');
      }
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
