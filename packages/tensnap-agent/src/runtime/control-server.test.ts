import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentRuntime } from './AgentRuntime';
import { resolveRuntimeContextPaths } from './context';
import { RuntimeControlServer } from './control-server';

const tempDirs: string[] = [];

async function createRuntimeServer(options: {
  maxRunStepsPolicy?: number;
  checkpointIntervalMs?: number;
  capabilities?: string[];
} = {}) {
  const { capabilities = [], ...runtimeOptions } = options;
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-'));
  tempDirs.push(rootDir);
  const context = resolveRuntimeContextPaths({ rootDir, contextName: 'test-agent' });
  const runtime = new AgentRuntime(context, { controlPort: 0, encoding: 'json', ...runtimeOptions });
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
  const server = new RuntimeControlServer(runtime, { host: '127.0.0.1', port: 0 });
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
  it('keeps live state in memory and checkpoints dirty scenes at sync boundaries', async () => {
    const { runtime, server, renderer } = await createRuntimeServer({ checkpointIntervalMs: 1_000 });
    try {
      attachConnectedTransport(renderer);
      renderer.requestStateSync('sync-1');
      renderer.handleIncoming({
        type: 'state_sync_begin',
        payload: { request_id: 'sync-1', model_id: 'test-model', instance_id: 'test-instance', mode: 'replace' },
      });
      renderer.handleIncoming({ type: 'metadata_update', payload: { time: 7 } });
      expect(runtime.getStatus()).toMatchObject({ sceneRevision: 0, sceneDirty: false });
      await expect(readFile(runtime.context.snapshotFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

      renderer.handleIncoming({ type: 'state_sync_end', payload: { request_id: 'sync-1', state_revision: '1' } });
      const saved = await waitFor(async () => {
        try {
          return JSON.parse(await readFile(runtime.context.snapshotFile, 'utf8')) as { metadata: { time?: number } };
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
        payload: { env_id: 'main', layer_id: 'agents', layer_type: 'agent', metadata: { width: 8, height: 6 } },
      });
      renderer.scenario.apply({
        type: 'item_create',
        payload: { env_id: 'main', layer_id: 'agents', items: [{ id: 'a1', x: 1, y: 2 }] },
      });
      renderer.scenario.apply({ type: 'chart_create', payload: { id: 'alive', label: 'Alive', color: '#22c55e' } });
      renderer.scenario.apply({ type: 'chart_update', payload: { updates: [{ id: 'alive', time: 1, value: 3 }] } });

      const snapshotResponse = await fetch(`${baseUrl}/v1/scene/snapshot`);
      const snapshotPayload = await snapshotResponse.json();
      expect(snapshotResponse.ok).toBe(true);
      expect(snapshotPayload.snapshot.environments[0].layers[0].storageSnapshot.agents).toHaveLength(1);
      expect((await (await fetch(`${baseUrl}/v1/charts`)).json())[0].points).toEqual([{ time: 1, alive: 3 }]);
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
          renderer.handleIncoming({ type: 'scene_restore_begin', payload: { request_id: message.payload.request_id } });
          renderer.handleIncoming({ type: 'metadata_update', payload: { time: message.payload.time ?? 0 } });
          renderer.handleIncoming({ type: 'scene_restore_end', payload: { request_id: message.payload.request_id, status: 'ok' } });
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
          env_id: 'world', layer_id: 'agents',
          items: [{ id: 1, x: 2, y: 3 }, { id: 2, x: 4, y: 3 }],
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
          payload: { id: message.payload.id, request_id: message.payload.request_id, should_continue: true },
        });
      }, 0);
    });

    try {
      const start = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'bounded', actionId: 'step', maxSteps: 2, stopWhen: 'steps >= 2' }),
      });
      expect(start.status).toBe(202);
      expect((await start.json()).run).toMatchObject({ state: 'running', completedSteps: 0 });

      const stopped = await waitFor(async () => {
        const response = await fetch(`${baseUrl}/v1/runs`);
        const payload = await response.json();
        return payload.run?.state === 'stopped' ? payload.run : undefined;
      });
      expect(stopped).toMatchObject({ completedSteps: 2, stopReason: 'condition', conditionValue: true });
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
    const { runtime, server, renderer, baseUrl } = await createRuntimeServer({ maxRunStepsPolicy: 2 });
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
