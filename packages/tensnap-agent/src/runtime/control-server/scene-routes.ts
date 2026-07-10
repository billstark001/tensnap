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
