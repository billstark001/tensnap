import { ArtifactInputError, isFileSystemFailure } from '../artifact-errors';
// #region Imports
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AgentRuntime } from '../AgentRuntime';
import { registerRuntimeRoutes } from './runtime-routes';
import { registerSceneRoutes } from './scene-routes';
import { registerArtifactRoutes } from './artifact-routes';
import { registerRunRoutes } from './run-routes';
import type { RuntimeSseBroker } from './sse-broker';
import { routePath } from 'hono/route';

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
  registerArtifactRoutes(app, runtime);

  app.options('*', (c) => c.body(null, 204));
  app.notFound((c) => c.text('Not found\n', 404));
  app.onError((error, c) => {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      error instanceof HTTPException
        ? error.status
        : error instanceof ArtifactInputError
          ? 400
          : 500;
    const payload = {} as Record<string, unknown>;
    if (routePath(c) === '/v1/runs/:runId/wait') payload.runId = c.req.param('runId');
    else if (routePath(c) === '/v1/action-results/:requestId/wait')
      payload.requestId = c.req.param('requestId');
    return c.json(
      {
        error: message,
        ...payload,
        category:
          status === 400
            ? 'input_error'
            : isFileSystemFailure(error)
              ? 'persistence_failed'
              : /timed out|disconnect/i.test(message)
                ? 'result_unknown'
                : 'execution_failed',
      },
      status,
    );
  });

  return app;
}

// #endregion
