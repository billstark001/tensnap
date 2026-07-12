// #region Imports
import type { Hono } from 'hono';
import type { AgentRuntime } from '../AgentRuntime';

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

  app.get('/v1/scene/snapshot', (c) => {
    return c.json(runtime.inspectSnapshot());
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
      artifacts: artifacts.map((artifact) => ({
        ...artifact,
        data: artifact.data ? Buffer.from(artifact.data).toString('base64') : undefined,
        dataEncoding: artifact.data ? 'base64' : undefined,
      })),
    });
  });

  app.post('/v1/scene/render', async (c) => {
    const body = await c.req.json<{
      reason?: string;
      envId?: string;
      width?: number;
      height?: number;
      viewport?: { x: number; y: number; width: number; height: number };
      format?: 'png' | 'jpeg';
      quality?: number;
      backgroundColor?: string;
      outputPath?: string;
      persist?: boolean;
      includeData?: boolean;
    }>();

    const artifacts = await runtime.requestRender(
      {
        envId: body.envId,
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

    return c.json({ artifacts });
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

    const body = await c.req.json<{ value: unknown }>();
    await runtime.setParameter(parameterId, body.value);
    return c.json({ parameterId, accepted: true }, 202);
  });

  app.get('/v1/actions', (c) => {
    return c.json(runtime.listActions());
  });

  app.post('/v1/actions/:actionId', async (c) => {
    const actionId = c.req.param('actionId');
    if (!actionId) {
      return c.json({ error: 'Missing action ID.' }, 404);
    }

    await runtime.runAction(actionId);
    return c.json({ actionId, accepted: true }, 202);
  });
}

// #endregion
