import { listenIPServers, closeIPServers, unavailableIPFamily } from '@tensnap/network/node';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from './AgentRuntime';
import { resolveRuntimeContextPaths } from './context';
import { RuntimeControlServer } from './control-server';

const tempDirs: string[] = [];

async function createRuntimeServer(
  options: {
    maxRunStepsPolicy?: number;
    checkpointIntervalMs?: number;
    capabilities?: string[];
    host?: string;
  } = {},
) {
  const { capabilities = [], host = '127.0.0.1', ...runtimeOptions } = options;
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-'));
  tempDirs.push(rootDir);
  const context = resolveRuntimeContextPaths({ rootDir, contextName: 'test-agent' });
  const runtime = new AgentRuntime(context, {
    controlPort: 0,
    encoding: 'json',
    ...runtimeOptions,
  });
  await runtime.initialize();
  const renderer = (runtime as any).renderer;
  renderer.handleIncoming({
    type: 'simulator_info',
    payload: {
      protocol_version: '0.3',
      binding: { name: 'test-binding', version: '0.3.0' },
      model: { id: 'test-model' },
      instance_id: 'test-instance',
      capabilities,
    },
  });
  const server = new RuntimeControlServer(runtime, { host, port: 0 });
  const address = await server.listen();
  return {
    runtime,
    server,
    renderer,
    baseUrl: `http://${address.host}:${address.port}`,
  };
}

function attachConnectedTransport(renderer: any, onSend?: (message: any) => void): any[] {
  const sent: any[] = [];
  renderer.attachTransport({
    connectionId: 'test://agent-runtime',
    transportKind: 'test',
    encoding: 'json',
    connectionState: 'open',
    isConnected: true,
    connect: async () => {},
    disconnect() {},
    destroy() {},
    on() {},
    off() {},
    send(message: any) {
      sent.push(message);
      onSend?.(message);
    },
  });
  return sent;
}

async function waitFor<T>(read: () => Promise<T | undefined>, timeoutMs = 1000): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for expected runtime state.');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('RuntimeControlServer', () => {
  it('shares startup and shutdown, and releases runtime subscriptions', async () => {
    const { runtime, server } = await createRuntimeServer();
    const count = runtime.listenerCount('event');
    expect(server.listen()).toBe(server.listen());
    const closing = server.close();
    expect(server.close()).toBe(closing);
    await closing;
    expect(runtime.listenerCount('event')).toBe(count - 1);
    await runtime.stop();
  });
  it('rolls back listeners and subscriptions if persisting the address fails', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-control-failure-'));
    tempDirs.push(rootDir);
    const runtime = new AgentRuntime(
      resolveRuntimeContextPaths({ rootDir, contextName: 'failure' }),
    );
    await runtime.initialize();
    const count = runtime.listenerCount('event');
    const persist = vi
      .spyOn(runtime, 'setControlAddress')
      .mockRejectedValue(new Error('disk failed'));
    const server = new RuntimeControlServer(runtime, { host: '127.0.0.1', port: 0 });
    try {
      await expect(server.listen()).rejects.toThrow('disk failed');
      expect(runtime.listenerCount('event')).toBe(count);
      const [host, port] = persist.mock.calls[0];
      const replacement = await listenIPServers(createServer, { host, port, ip_family: 'ipv4' });
      await closeIPServers(replacement);
    } finally {
      await server.close();
      await runtime.stop();
    }
  });
  it('keeps live state in memory and checkpoints dirty scenes at sync boundaries', async () => {
    const { runtime, server, renderer } = await createRuntimeServer({
      checkpointIntervalMs: 1_000,
    });
    try {
      attachConnectedTransport(renderer);
      renderer.requestStateSync('sync-1');
      renderer.handleIncoming({
        type: 'state_sync_begin',
        payload: {
          request_id: 'sync-1',
          model_id: 'test-model',
          instance_id: 'test-instance',
          mode: 'replace',
        },
      });
      renderer.handleIncoming({ type: 'metadata_update', payload: { time: 7 } });
      expect(runtime.getStatus()).toMatchObject({ sceneRevision: 0, sceneDirty: false });
      await expect(readFile(runtime.context.snapshotFile, 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });

      renderer.handleIncoming({
        type: 'state_sync_end',
        payload: { request_id: 'sync-1', state_revision: '1' },
      });
      const saved = await waitFor(async () => {
        try {
          // A renamed checkpoint is visible before the writer's asynchronous
          // temporary-file cleanup completes and clears sceneDirty.
          if (runtime.getStatus().sceneDirty) return undefined;
          return JSON.parse(await readFile(runtime.context.snapshotFile, 'utf8')) as {
            metadata: { time?: number };
          };
        } catch {
          return undefined;
        }
      });
      expect(saved.metadata.time).toBe(7);
      expect(runtime.getStatus().sceneDirty).toBe(false);
    } finally {
      await server.close();
      await runtime.stop();
    }
  });

  it('exposes raw snapshot, chart series, and asset summaries', async () => {
    const { runtime, server, renderer, baseUrl } = await createRuntimeServer();
    try {
      renderer.scenario.apply({ type: 'env_create', payload: { id: 'main', type: '2d' } });
      renderer.scenario.apply({
        type: 'env_layer_create',
        payload: {
          env_id: 'main',
          layer_id: 'agents',
          layer_type: 'agent',
          metadata: { width: 8, height: 6 },
        },
      });
      renderer.scenario.apply({
        type: 'item_create',
        payload: { env_id: 'main', layer_id: 'agents', items: [{ id: 'a1', x: 1, y: 2 }] },
      });
      renderer.scenario.apply({
        type: 'chart_create',
        payload: { id: 'alive', label: 'Alive', color: '#22c55e' },
      });
      renderer.scenario.apply({
        type: 'chart_update',
        payload: { updates: [{ id: 'alive', time: 1, value: 3 }] },
      });

      const snapshotResponse = await fetch(`${baseUrl}/v1/scene/snapshot`);
      const snapshotPayload = await snapshotResponse.json();
      expect(snapshotResponse.ok).toBe(true);
      expect(
        snapshotPayload.snapshot.environments[0].layers[0].storageSnapshot.agents,
      ).toHaveLength(1);
      expect((await (await fetch(`${baseUrl}/v1/charts`)).json())[0].points).toEqual([
        { time: 1, alive: 3 },
      ]);
    } finally {
      await server.close();
      await runtime.stop();
    }
  });

  it('captures and restores scenes through HTTP protocol endpoints', async () => {
    const { runtime, server, renderer, baseUrl } = await createRuntimeServer({
      capabilities: ['scene.restore.checkpoint', 'scene.restore.projected'],
    });
    try {
      attachConnectedTransport(renderer, (message) => {
        if (message.type === 'scene_capture') {
          renderer.handleIncoming({
            type: 'scene_capture_result',
            payload: {
              request_id: message.payload.request_id,
              model_id: 'test-model',
              checkpoint: { encoding: 'application/octet-stream', data: new Uint8Array([1, 2]) },
            },
          });
        }
        if (message.type === 'scene_restore') {
          renderer.handleIncoming({
            type: 'scene_restore_begin',
            payload: { request_id: message.payload.request_id },
          });
          renderer.handleIncoming({
            type: 'metadata_update',
            payload: { time: message.payload.time ?? 0 },
          });
          renderer.handleIncoming({
            type: 'scene_restore_end',
            payload: { request_id: message.payload.request_id, status: 'ok' },
          });
        }
      });

      const capture = await fetch(`${baseUrl}/v1/scene/capture`, { method: 'POST' });
      expect(capture.status).toBe(200);
      expect(await capture.json()).toMatchObject({
        model_id: 'test-model',
        checkpoint: { encoding: 'application/octet-stream', data: 'AQI=' },
      });

      const restore = await fetch(`${baseUrl}/v1/scene/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ time: 8 }),
      });
      expect(restore.status).toBe(200);
      expect(await restore.json()).toMatchObject({ status: 'ok' });
      expect(runtime.inspectScene().time).toBe(8);
    } finally {
      await server.close();
      await runtime.stop();
    }
  });

  it('reports unsupported checkpoint capture without sending control traffic', async () => {
    const { runtime, server, renderer, baseUrl } = await createRuntimeServer();
    try {
      const sent = attachConnectedTransport(renderer);
      const response = await fetch(`${baseUrl}/v1/scene/capture`, { method: 'POST' });
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/checkpoint scene capture/);
      expect(sent).toHaveLength(0);
    } finally {
      await server.close();
      await runtime.stop();
    }
  });

  it('inspects agents through the shared ScenarioInspector API', async () => {
    const { runtime, server, renderer, baseUrl } = await createRuntimeServer();
    try {
      renderer.scenario.apply({ type: 'env_create', payload: { id: 'world', type: '2d' } });
      renderer.scenario.apply({
        type: 'env_layer_create',
        payload: { env_id: 'world', layer_id: 'agents', layer_type: 'agent' },
      });
      renderer.scenario.apply({
        type: 'item_create',
        payload: {
          env_id: 'world',
          layer_id: 'agents',
          items: [
            { id: 1, x: 2, y: 3 },
            { id: 2, x: 4, y: 3 },
          ],
        },
      });

      const response = await fetch(`${baseUrl}/v1/agents/world/agents/1?radius=3`);
      expect(response.ok).toBe(true);
      expect((await response.json()).inspection).toMatchObject({
        kind: 'spatial',
        ref: { environmentId: 'world', layerId: 'agents', agentId: 1 },
        neighborCount: 1,
        viewport: { x: -0.5, y: 0.5, width: 6, height: 6 },
      });

      const missing = await fetch(`${baseUrl}/v1/agents/world/agents/missing`);
      expect(missing.status).toBe(404);
    } finally {
      await server.close();
      await runtime.stop();
    }
  });

  it('runs, reports, and stops bounded runs through /v1/runs', async () => {
    const { runtime, server, renderer, baseUrl } = await createRuntimeServer();
    const sent = attachConnectedTransport(renderer, (message) => {
      if (message.type !== 'action_invoke') return;
      setTimeout(() => {
        renderer.handleIncoming({
          type: 'action_result',
          payload: {
            id: message.payload.id,
            request_id: message.payload.request_id,
            should_continue: true,
          },
        });
      }, 0);
    });

    try {
      const start = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'bounded',
          actionId: 'step',
          maxSteps: 2,
          stopWhen: 'steps >= 2',
        }),
      });
      expect(start.status).toBe(202);
      expect((await start.json()).run).toMatchObject({ state: 'running', completedSteps: 0 });

      const stopped = await waitFor(async () => {
        const response = await fetch(`${baseUrl}/v1/runs`);
        const payload = await response.json();
        return payload.run?.state === 'stopped' ? payload.run : undefined;
      });
      expect(stopped).toMatchObject({
        completedSteps: 2,
        stopReason: 'condition',
        conditionValue: true,
      });
      expect(sent.filter((message) => message.type === 'action_invoke')).toHaveLength(2);

      const stoppedAgain = await fetch(`${baseUrl}/v1/runs`, { method: 'DELETE' });
      expect(stoppedAgain.ok).toBe(true);
      expect((await stoppedAgain.json()).run.stopReason).toBe('condition');
    } finally {
      await server.close();
      await runtime.stop();
    }
  });

  it('rejects runs without an explicit finite maximum step count', async () => {
    const { runtime, server, renderer, baseUrl } = await createRuntimeServer();
    attachConnectedTransport(renderer);
    try {
      const response = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'bounded', actionId: 'step' }),
      });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/maxSteps/);
    } finally {
      await server.close();
      await runtime.stop();
    }
  });

  it('applies the explicit runtime max-step policy to runs', async () => {
    const { runtime, server, renderer, baseUrl } = await createRuntimeServer({
      maxRunStepsPolicy: 2,
    });
    attachConnectedTransport(renderer);
    try {
      expect(runtime.getStatus().maxRunStepsPolicy).toBe(2);
      const response = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'bounded', actionId: 'step', maxSteps: 3 }),
      });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/2/);
    } finally {
      await server.close();
      await runtime.stop();
    }
  });
});

it('serves the same control runtime on both localhost families at port zero', async (context) => {
  try {
    await closeIPServers(
      await listenIPServers(createServer, { host: 'localhost', port: 0, ip_family: 'ipv6' }),
    );
  } catch (error) {
    if (unavailableIPFamily(error)) {
      context.skip();
      return;
    }
    throw error;
  }
  const { runtime, server, baseUrl } = await createRuntimeServer({ host: 'localhost' });
  try {
    const v4 = await fetch(`${baseUrl}/health`).then((response) => response.json());
    const v6Url = new URL(baseUrl);
    v6Url.hostname = '[::1]';
    const v6 = await fetch(`${v6Url.origin}/health`).then((response) => response.json());
    expect(v6).toEqual(v4);
    expect(v6.ok).toBe(true);
  } finally {
    await runtime.stop();
    await server.close();
  }
});

it('waits for collection persistence by run ID and rejects concurrent collection-start mutations', async () => {
  const { runtime, renderer, server, baseUrl } = await createRuntimeServer();
  attachConnectedTransport(renderer, (message) => {
    if (message.type === 'action_invoke')
      queueMicrotask(() => {
        renderer.handleIncoming({ type: 'metadata_update', payload: { time: 1 } });
        renderer.handleIncoming({
          type: 'action_result',
          payload: { id: message.payload.id, request_id: message.payload.request_id },
        });
      });
  });
  const config = {
    version: 1 as const,
    mode: 'full-history' as const,
    maxStoredBytes: 1024 * 1024,
    liveHistory: { chartPoints: 2, logs: 2 },
    rules: [],
    window: { before: 0, after: 0 },
    maxTriggers: 1,
    checkpoints: {
      policy: 'none' as const,
      onTrigger: false,
      maxCount: 0,
      maxBytes: 0,
      overflow: 'fail' as const,
    },
  };
  try {
    const output = join(tempDirs[tempDirs.length - 1], 'collected.store');
    const starting = runtime.startCollectedRun(
      { mode: 'bounded', actionId: 'step', maxSteps: 1 },
      config,
      output,
    );
    config.liveHistory.chartPoints = 999;
    await expect(runtime.runAction('other')).rejects.toThrow(/collection/);
    expect(() => runtime.startRun({ mode: 'bounded', actionId: 'other', maxSteps: 1 })).toThrow(
      /collection/,
    );
    const accepted = await starting;
    const response = await fetch(`${baseUrl}/v1/runs/${accepted.id}/wait`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ until: 'persisted', timeoutMs: 3000 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      run: {
        completedActions: 1,
        recording: { status: 'persisted' },
        collection: { committedFrame: 1, state: 'complete' },
      },
    });
  } finally {
    await server.close();
    await runtime.stop();
  }
});
