import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentRuntime } from './AgentRuntime';
import { resolveRuntimeContextPaths } from './context';
import { RuntimeControlServer } from './control-server';

const tempDirs: string[] = [];

async function createRuntimeServer(options: { maxRunStepsPolicy?: number } = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-'));
  tempDirs.push(rootDir);
  const context = resolveRuntimeContextPaths({ rootDir, contextName: 'test-agent' });
  const runtime = new AgentRuntime(context, { controlPort: 0, encoding: 'json', ...options });
  await runtime.initialize();
  const server = new RuntimeControlServer(runtime, { host: '127.0.0.1', port: 0 });
  const address = await server.listen();
  return {
    runtime,
    server,
    renderer: (runtime as any).renderer,
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
  it('exposes raw snapshot, chart series, and asset summaries', async () => {
    const { runtime, server, renderer, baseUrl } = await createRuntimeServer();
    try {
      renderer.scenario.apply({ type: 'env_create', payload: { id: 'main', type: '2d' } });
      renderer.scenario.apply({
        type: 'env_layer_create',
        payload: { env_id: 'main', layer_id: 'agents', layer_type: 'agent', data: { width: 8, height: 6 } },
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

  it('runs, reports, and stops bounded runs through /v1/runs', async () => {
    const { runtime, server, renderer, baseUrl } = await createRuntimeServer();
    const sent = attachConnectedTransport(renderer, (message) => {
      if (message.type !== 'action_start') return;
      setTimeout(() => {
        renderer.handleIncoming({
          type: 'action_end',
          payload: { id: message.payload.id, tick_id: message.payload.tick_id, continue: true },
        });
      }, 0);
    });

    try {
      const start = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actionId: 'step', maxSteps: 2, stopWhen: 'steps >= 2' }),
      });
      expect(start.status).toBe(202);
      expect((await start.json()).run).toMatchObject({ state: 'running', completedSteps: 0 });

      const stopped = await waitFor(async () => {
        const response = await fetch(`${baseUrl}/v1/runs`);
        const payload = await response.json();
        return payload.run?.state === 'stopped' ? payload.run : undefined;
      });
      expect(stopped).toMatchObject({ completedSteps: 2, stopReason: 'condition', conditionValue: true });
      expect(sent.filter((message) => message.type === 'action_start')).toHaveLength(2);

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
        body: JSON.stringify({ actionId: 'step' }),
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
        body: JSON.stringify({ actionId: 'step', maxSteps: 3 }),
      });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/2/);
    } finally {
      await server.close();
      await runtime.stop();
    }
  });
});
