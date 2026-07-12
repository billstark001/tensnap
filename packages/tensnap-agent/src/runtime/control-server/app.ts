// #region Imports
import { Hono } from 'hono';
import type { AgentRuntime } from '../AgentRuntime';
import { registerRuntimeRoutes } from './runtime-routes';
import { registerSceneRoutes } from './scene-routes';
import { registerRunRoutes } from './run-routes';
import type { RuntimeSseBroker } from './sse-broker';

// #endregion

// #region App

export function buildControlApp(
  runtime: AgentRuntime,
  broker: RuntimeSseBroker,
  onShutdownRequested: () => void,
): Hono {
  const app = new Hono();

  registerRuntimeRoutes(app, runtime, broker, onShutdownRequested);
  registerSceneRoutes(app, runtime);
  registerRunRoutes(app, runtime);

  app.options('*', (c) => c.body(null, 204));
  app.notFound((c) => c.text('Not found\n', 404));
  app.onError((error, c) => {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 500);
  });

  return app;
}

// #endregion
