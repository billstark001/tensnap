import type { Hono } from 'hono';
import type { RecordingOptions } from '@tensnap/core/snapshot';
import type { AgentRuntime } from '../AgentRuntime';
import { readJsonObject } from './json-body';
import { invalid, validateFields } from './validation';
import { FrameSaveError } from '../frame-errors';

export function registerArtifactRoutes(app: Hono, runtime: AgentRuntime): void {
  app.get('/v1/recordings', async (c) => c.json({ recordings: await runtime.listRecordings() }));
  app.post('/v1/recordings', async (c) => {
    const { recordingFormat, ...body } = await readJsonObject<
      RecordingOptions & { recordingFormat?: 'json' | 'msgpack' }
    >(c.req, { optional: true });
    validateFields({ recordingFormat }, { recordingFormat: ['json', 'msgpack'] });
    validateFields(body, {
      maxSteps: 'integer',
      maxBytes: 'positive',
      maxDurationMs: 'positive',
      ringBuffer: 'boolean',
      keyframeEvery: 'integer',
      label: 'string',
    });
    return c.json({ recording: runtime.startRecording(body, recordingFormat) }, 202);
  });
  app.post('/v1/recordings/stop', async (c) => {
    const body = await readJsonObject<{ timeoutMs?: number }>(c.req, { optional: true });
    validateFields(body, { timeoutMs: 'positive' });
    const recording = await runtime.stopRecording(body.timeoutMs, c.req.raw.signal);
    return recording.status === 'failed'
      ? c.json({ recording, error: recording.error, category: 'persistence_failed' }, 422)
      : c.json({ recording });
  });
  app.post('/v1/recordings/:id/export', async (c) => {
    const body = await readJsonObject<{ output: string; recordingFormat?: 'json' | 'msgpack' }>(
      c.req,
    );
    validateFields(body, { output: 'string', recordingFormat: ['json', 'msgpack'] }, ['output']);
    return c.json({
      recording: await runtime.exportRecording(
        c.req.param('id'),
        body.output,
        body.recordingFormat,
      ),
    });
  });
  app.post('/v1/frames', async (c) => {
    const body = await readJsonObject<
      Parameters<AgentRuntime['saveFrame']>[1] & { output: string }
    >(c.req);
    validateFields(
      body,
      {
        output: 'string',
        checkpoint: ['none', 'if-supported', 'required'],
        recordingFormat: ['json', 'msgpack'],
        envIds: 'array',
        chartIds: 'array',
        renderOptions: 'object',
        timeoutMs: 'positive',
      },
      ['output'],
    );
    for (const ids of [body.envIds, body.chartIds])
      if (ids && ids.some((id) => typeof id !== 'string' || !id.trim()))
        invalid('Render target IDs must be nonempty strings.');
    if (body.renderOptions)
      validateFields(body.renderOptions, {
        layerOverrides: 'object',
        layoutTicks: 'number',
        width: 'integer',
        height: 'integer',
        backgroundColor: 'string',
        format: ['png', 'jpeg'],
        quality: 'number',
        viewport: 'object',
      });
    if (
      body.renderOptions?.quality !== undefined &&
      (body.renderOptions.quality < 0 || body.renderOptions.quality > 1)
    )
      invalid('quality must be between 0 and 1.');
    if (body.renderOptions?.viewport)
      validateFields(
        body.renderOptions.viewport,
        { x: 'number', y: 'number', width: 'positive', height: 'positive' },
        ['x', 'y', 'width', 'height'],
      );
    try {
      return c.json(await runtime.saveFrame(body.output, body));
    } catch (error) {
      if (!(error instanceof FrameSaveError)) throw error;
      return c.json(
        {
          error: error.message,
          category: error.category,
          partialDirectory: error.partialDirectory,
          artifacts: error.artifacts.map(({ data: _data, ...artifact }) => artifact),
        },
        422,
      );
    }
  });
  app.post('/v1/frames/restore', async (c) => {
    const body = await readJsonObject<{
      directory: string;
      mode: 'checkpoint' | 'projected';
      chartPolicy?: 'preserve' | 'replace' | 'truncate';
      historyTime?: number;
      timeoutMs?: number;
    }>(c.req);
    validateFields(
      body,
      {
        directory: 'string',
        mode: ['checkpoint', 'projected'],
        chartPolicy: ['preserve', 'replace', 'truncate'],
        historyTime: 'number',
        timeoutMs: 'positive',
      },
      ['directory', 'mode'],
    );
    const result = await runtime.restoreFrame(body.directory, body, c.req.raw.signal);
    return result.modelStatus === 'restored'
      ? c.json(result)
      : c.json(
          {
            ...result,
            error: result.error ?? 'Model restore failed.',
            category: result.stateKnown ? 'execution_failed' : 'result_unknown',
          },
          422,
        );
  });
}
