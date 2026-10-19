import { ScenarioQuerySchema, AgentInspectionRequestSchema } from '@tensnap/core/scenario';
import { ScenarioSnapshotSchema } from '@tensnap/core/persistence';
// #region Imports
import type { Hono } from 'hono';
import { encodeBytesAsBase64, ProtocolValueSchema } from '@tensnap/protocol';
import type { RestoreChartPolicy } from '@tensnap/core/runtime';
import type { AgentRuntime } from '../AgentRuntime';
import { validateFields, invalid } from './validation';
import { RenderBatchError } from '../painter';
import { readJsonObject } from './json-body';
import type { RenderArtifact } from '../painter';
// #endregion

// #region Serialization

/** JSON has no byte-array primitive; use the same representation for every render route. */
export function serializeRenderArtifact(artifact: RenderArtifact) {
  const { data, ...metadata } = artifact;
  return {
    ...metadata,
    ...(data === undefined
      ? {}
      : { data: encodeBytesAsBase64(data), dataEncoding: 'base64' as const }),
  };
}

// #endregion

// #region Routes

export function registerSceneRoutes(app: Hono, runtime: AgentRuntime): void {
  app.get('/v1/scene', (c) => {
    return c.json({
      status: runtime.getStatus(),
      render: runtime.getRenderSettings(),
      painters: runtime.getPainterIds(),
      scene: runtime.inspectScene(),
    });
  });

  app.post('/v1/scene/query', async (c) => {
    const parsed = ScenarioQuerySchema.safeParse(await readJsonObject(c.req));
    if (!parsed.success) invalid(parsed.error.message);
    try {
      return c.json(runtime.queryScene(parsed.data));
    } catch (error) {
      invalid(error instanceof Error ? error.message : String(error));
    }
  });

  app.get('/v1/scene/snapshot', (c) => {
    return c.json(runtime.inspectSnapshot());
  });

  app.post('/v1/scene/capture', async (c) => {
    try {
      const result = await runtime.captureScene();
      return c.json({
        ...result,
        checkpoint: {
          ...result.checkpoint,
          data:
            typeof result.checkpoint.data === 'string'
              ? result.checkpoint.data
              : encodeBytesAsBase64(result.checkpoint.data),
        },
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });

  app.post('/v1/scene/restore', async (c) => {
    const body = await readJsonObject<Record<string, unknown>>(c.req);
    validateFields(body, {
      chartPolicy: ['preserve', 'replace', 'truncate'],
      historyTime: 'number',
      replacementCharts: 'array',
      checkpoint: 'object',
      time: 'number',
      parameters: 'object',
      envs: 'array',
      expected_instance_id: 'string',
      state_schema_version: 'string',
    });
    const chartPolicy = body.chartPolicy;
    if (
      body.replacementCharts !== undefined &&
      !ScenarioSnapshotSchema.shape.charts.safeParse(body.replacementCharts).success
    )
      invalid('replacementCharts must contain valid chart groups.');
    if (
      chartPolicy !== undefined &&
      chartPolicy !== 'preserve' &&
      chartPolicy !== 'replace' &&
      chartPolicy !== 'truncate'
    ) {
      return c.json({ error: 'chartPolicy must be preserve, replace, or truncate.' }, 400);
    }
    const { chartPolicy: _chartPolicy, historyTime, replacementCharts, ...input } = body;
    try {
      const result = await runtime.restoreScene(input, {
        chartPolicy: chartPolicy as RestoreChartPolicy | undefined,
        historyTime: historyTime as number | undefined,
        replacementCharts: replacementCharts as
          | import('@tensnap/core/chart').ChartGroup[]
          | undefined,
      });
      return c.json(result, result.status === 'ok' ? 200 : 409);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post('/v1/agents/inspect', async (c) => {
    const parsed = AgentInspectionRequestSchema.safeParse(await readJsonObject(c.req));
    if (!parsed.success) invalid(parsed.error.message);
    const { ref, radius, render } = parsed.data;
    const inspection = runtime.inspectAgent(ref, { radius });
    if (!inspection) return c.json({ found: false, ref });
    if (!render || inspection.kind === 'none') return c.json({ found: true, inspection });
    const artifacts = await runtime.renderAgentInspection(inspection, {
      format: 'png',
      includeData: true,
      persist: false,
    });
    return c.json({ found: true, inspection, artifacts: artifacts.map(serializeRenderArtifact) });
  });

  app.get('/v1/agents/:environmentId/:layerId/:agentId', async (c) => {
    const ref = runtime.findAgentRef(
      c.req.param('environmentId'),
      c.req.param('layerId'),
      c.req.param('agentId'),
    );
    if (!ref) {
      return c.json({ error: 'Unknown agent reference.' }, 404);
    }

    const rawRadius = c.req.query('radius');
    const radius = rawRadius === undefined ? undefined : Number(rawRadius);
    if (radius !== undefined && (!Number.isFinite(radius) || radius <= 0)) {
      return c.json({ error: 'radius must be a positive number.' }, 400);
    }

    const inspection = runtime.inspectAgent(ref, { radius });
    if (!inspection) {
      return c.json({ error: 'Agent no longer exists.' }, 404);
    }

    if (c.req.query('render') !== 'png' || inspection.kind === 'none') {
      return c.json({ inspection });
    }

    const width = c.req.query('width');
    const height = c.req.query('height');
    const artifacts = await runtime.renderAgentInspection(inspection, {
      format: 'png',
      width: width === undefined ? undefined : Number(width),
      height: height === undefined ? undefined : Number(height),
      includeData: true,
      persist: false,
    });
    return c.json({
      inspection,
      artifacts: artifacts.map(serializeRenderArtifact),
    });
  });

  app.post('/v1/scene/render', async (c) => {
    const body = await readJsonObject<{
      reason?: string;
      envId?: string;
      chartId?: string;
      width?: number;
      height?: number;
      viewport?: { x: number; y: number; width: number; height: number };
      format?: 'png' | 'jpeg';
      quality?: number;
      backgroundColor?: string;
      outputPath?: string;
      persist?: boolean;
      includeData?: boolean;
    }>(c.req);

    validateFields(body, {
      reason: 'string',
      envId: 'string',
      chartId: 'string',
      width: 'integer',
      height: 'integer',
      viewport: 'object',
      format: ['png', 'jpeg'],
      quality: 'number',
      backgroundColor: 'string',
      outputPath: 'string',
      persist: 'boolean',
      includeData: 'boolean',
    });
    if (body.quality !== undefined && (body.quality < 0 || body.quality > 1))
      invalid('quality must be between 0 and 1.');
    if (body.viewport)
      validateFields(
        body.viewport,
        { x: 'number', y: 'number', width: 'positive', height: 'positive' },
        ['x', 'y', 'width', 'height'],
      );
    if (body.envId && body.chartId) {
      return c.json({ error: 'envId and chartId are mutually exclusive.' }, 400);
    }

    try {
      const artifacts = await runtime.requestRender(
        {
          envId: body.envId,
          chartId: body.chartId,
          width: body.width,
          height: body.height,
          viewport: body.viewport,
          format: body.format,
          quality: body.quality,
          backgroundColor: body.backgroundColor,
          outputPath: body.outputPath,
          persist: body.persist,
          includeData: body.includeData,
        },
        body.reason ?? 'manual',
      );

      return c.json({ artifacts: artifacts.map(serializeRenderArtifact) });
    } catch (error) {
      if (!(error instanceof RenderBatchError)) throw error;
      const category = error.errors.some((failure) => failure.code === 'persistence_failed')
        ? 'persistence_failed'
        : 'render_failed';
      return c.json(
        {
          error: error.message,
          category,
          artifacts: error.artifacts.map(serializeRenderArtifact),
          errors: error.errors,
          partial: error.artifacts.length > 0,
        },
        422,
      );
    }
  });

  app.get('/v1/charts', (c) => {
    return c.json(runtime.listChartSeries());
  });

  app.get('/v1/charts/:chartId', (c) => {
    const chart = runtime.getChartSeries(c.req.param('chartId'));
    if (!chart) {
      return c.json({ error: 'Unknown chart ID.' }, 404);
    }
    return c.json(chart);
  });

  app.get('/v1/assets', (c) => {
    return c.json(runtime.listAssets());
  });

  app.get('/v1/params', (c) => {
    return c.json(runtime.listParameters());
  });

  app.post('/v1/params/:parameterId', async (c) => {
    const parameterId = c.req.param('parameterId');
    if (!parameterId) {
      return c.json({ error: 'Missing parameter ID.' }, 404);
    }

    const body = await readJsonObject<{ value: unknown }>(c.req);
    if (Object.keys(body).some((key) => key !== 'value')) invalid('Unknown parameter field.');
    const parsed = ProtocolValueSchema.safeParse(body.value);
    if (!parsed.success) {
      return c.json({ error: 'Parameter value is not a protocol value.' }, 400);
    }
    await runtime.setParameter(parameterId, parsed.data);
    return c.json({ parameterId, accepted: true }, 202);
  });

  app.get('/v1/actions', (c) => {
    return c.json(runtime.listActions());
  });

  app.get('/v1/action-results/:requestId', (c) => {
    const action = runtime.getAction(c.req.param('requestId'));
    return action
      ? c.json({ action })
      : c.json({ error: 'Unknown or expired action request ID.', category: 'input_error' }, 404);
  });
  app.post('/v1/action-results/:requestId/wait', async (c) => {
    const id = c.req.param('requestId');
    if (!runtime.getAction(id)) invalid('Unknown or expired action request ID.');
    const body = await readJsonObject<{ timeoutMs?: number }>(c.req, { optional: true });
    validateFields(body, { timeoutMs: 'positive' });
    const action = await runtime.waitAction(id, body.timeoutMs, c.req.raw.signal);
    const category = !action.stateKnown
      ? 'result_unknown'
      : action.renderStatus === 'failed'
        ? 'render_failed'
        : action.status === 'failed'
          ? 'execution_failed'
          : undefined;
    return category
      ? c.json(
          {
            action,
            error: action.error ?? action.result?.error?.message ?? 'Action failed.',
            category,
          },
          422,
        )
      : c.json({ action });
  });
  app.post('/v1/actions/:actionId', async (c) => {
    const actionId = c.req.param('actionId');
    if (!actionId) {
      return c.json({ error: 'Missing action ID.' }, 404);
    }

    validateFields(await readJsonObject(c.req, { optional: true }), {});
    const requestId = await runtime.runAction(actionId);
    return c.json({ actionId, requestId, accepted: true }, 202);
  });
}

// #endregion
