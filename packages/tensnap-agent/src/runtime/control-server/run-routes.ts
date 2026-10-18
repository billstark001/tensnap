import { isFileSystemFailure } from '../artifact-errors';
import type { Hono } from 'hono';
import type { BoundedRunSpec, CollectionConfig } from '@tensnap/core/runtime';
import { isEncodedBinaryString } from '@tensnap/protocol';
import type { AgentRuntime } from '../AgentRuntime';
import { validateFields, invalid } from './validation';
import { readJsonObject } from './json-body';

/** Shared bounded-run API for automation clients and the CLI. */
export function registerRunRoutes(app: Hono, runtime: AgentRuntime): void {
  app.get('/v1/collections/:runId', (c) => {
    const collection = runtime.getCollection(c.req.param('runId'));
    return collection ? c.json({ collection }) : c.json({ error: 'Unknown collection.' }, 404);
  });
  app.post('/v1/collections', async (c) => {
    const body = await readJsonObject<{
      spec: BoundedRunSpec;
      config: CollectionConfig;
      output: string;
    }>(c.req);
    validateFields(body, { spec: 'object', config: 'object', output: 'string' }, [
      'spec',
      'config',
      'output',
    ]);
    validateFields(
      body.spec,
      {
        mode: ['bounded'],
        actionId: 'string',
        maxSteps: 'integer',
        stopWhen: 'string',
        maxWallTimeMs: 'positive',
      },
      ['mode', 'actionId', 'maxSteps'],
    );
    try {
      return c.json(
        { run: await runtime.startCollectedRun(body.spec, body.config, body.output) },
        202,
      );
    } catch (error) {
      if (isFileSystemFailure(error)) throw error;
      invalid(error instanceof Error ? error.message : String(error));
    }
  });
  app.post('/v1/runs/:runId/wait', async (c) => {
    const id = c.req.param('runId');
    if (!runtime.getRun(id)) invalid('Unknown or expired run ID.');
    const body = await readJsonObject<{ until?: 'settled' | 'persisted'; timeoutMs?: number }>(
      c.req,
      { optional: true },
    );
    validateFields(body, { until: ['settled', 'persisted'], timeoutMs: 'positive' });
    if (
      body.until === 'persisted' &&
      !runtime.getRun(id)?.spec.record &&
      !runtime.getCollection(id)
    )
      invalid('This run did not request recording persistence.');
    const run = await runtime.waitRun(id, body.until, body.timeoutMs, c.req.raw.signal);
    const category =
      run.recording?.status === 'failed'
        ? 'persistence_failed'
        : !run.stateKnown
          ? 'result_unknown'
          : run.primaryFailure === 'render-error'
            ? 'render_failed'
            : run.primaryFailure
              ? 'execution_failed'
              : undefined;
    return category
      ? c.json(
          {
            run,
            category,
            error:
              run.recording?.error ??
              run.renderError ??
              run.primaryFailure ??
              'Run state is unknown.',
          },
          422,
        )
      : c.json({ run });
  });
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
