import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentRuntime } from './AgentRuntime';
import { resolveRuntimeContextPaths } from './context';
import { RuntimeControlServer } from './control-server';


const tempDirs: string[] = [];


function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}


async function createRuntimeServer() {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-'));
  tempDirs.push(rootDir);

  const context = resolveRuntimeContextPaths({ rootDir, contextName: 'test-agent' });
  const runtime = new AgentRuntime(context, { controlPort: 0, encoding: 'json' });
  await runtime.initialize();

  const server = new RuntimeControlServer(runtime, { host: '127.0.0.1', port: 0 });
  const address = await server.listen();
  const session = (runtime as any).session;

  return {
    runtime,
    server,
    session,
    baseUrl: `http://${address.host}:${address.port}`,
  };
}


function attachConnectedTransport(session: any, onSend?: (message: any) => void) {
  const sent: any[] = [];
  session.transport = {
    isConnected: true,
    destroy() {},
    disconnect() {},
    send(message: any) {
      sent.push(message);
      onSend?.(message);
    },
  };
  return sent;
}


function applySessionMessage(session: any, message: any): void {
  session.scenario.apply(message);
  session.emit('message', message);
}


afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});


describe('RuntimeControlServer', () => {
  it('exposes raw snapshot, chart series, and asset summaries', async () => {
    const { runtime, server, session, baseUrl } = await createRuntimeServer();

    try {
      session.scenario.apply({ type: 'env_create', payload: { id: 'main', type: '2d' } });
      session.scenario.apply({
        type: 'env_layer_create',
        payload: {
          env_id: 'main',
          layer_id: 'agents',
          layer_type: 'agent',
          data: { width: 8, height: 6 },
        },
      });
      session.scenario.apply({
        type: 'agent_create',
        payload: {
          env_id: 'main',
          layer_id: 'agents',
          agents: [{ id: 'a1', x: 1, y: 2 }],
        },
      });
      session.scenario.apply({
        type: 'chart_create',
        payload: { id: 'alive', label: 'Alive', color: '#22c55e' },
      });
      session.scenario.apply({
        type: 'chart_update',
        payload: { updates: [{ id: 'alive', time: 1, value: 3 }] },
      });
      session.scenario.apply({
        type: 'asset_meta',
        payload: {
          assets: [
            { id: 'config', hash: 'h1', mime: 'application/json', size: 11, label: 'Config' },
          ],
        },
      });
      session.scenario.apply({
        type: 'asset_data',
        payload: {
          id: 'config',
          hash: 'h1',
          mime: 'application/json',
          data: 'data:application/json;base64,eyJvayI6dHJ1ZX0=',
        },
      });
      await flushAsyncWork();

      const snapshotResponse = await fetch(`${baseUrl}/v1/scene/snapshot`);
      const snapshotPayload = await snapshotResponse.json();
      expect(snapshotResponse.ok).toBe(true);
      expect(snapshotPayload.snapshot.environments[0].id).toBe('main');
      expect(snapshotPayload.snapshot.environments[0].layers[0].storageSnapshot.agents).toHaveLength(1);
      expect(snapshotPayload.charts[0].id).toBe('alive');
      expect(snapshotPayload.assets[0].id).toBe('config');

      const chartsResponse = await fetch(`${baseUrl}/v1/charts`);
      const chartsPayload = await chartsResponse.json();
      expect(chartsResponse.ok).toBe(true);
      expect(chartsPayload).toEqual([
        {
          id: 'alive',
          metadata: { id: 'alive', label: 'Alive', color: '#22c55e' },
          points: [{ time: 1, alive: 3 }],
        },
      ]);

      const chartResponse = await fetch(`${baseUrl}/v1/charts/alive`);
      const chartPayload = await chartResponse.json();
      expect(chartResponse.ok).toBe(true);
      expect(chartPayload.id).toBe('alive');
      expect(chartPayload.points).toEqual([{ time: 1, alive: 3 }]);

      const assetsResponse = await fetch(`${baseUrl}/v1/assets`);
      const assetsPayload = await assetsResponse.json();
      expect(assetsResponse.ok).toBe(true);
      expect(assetsPayload).toEqual([
        {
          id: 'config',
          hash: 'h1',
          mime: 'application/json',
          size: 11,
          label: 'Config',
          resolved: true,
          valueType: 'string',
        },
      ]);
    } finally {
      await server.close();
      await runtime.stop();
    }
  });

  it('waits for a matching action_end payload', async () => {
    const { runtime, server, session, baseUrl } = await createRuntimeServer();
    attachConnectedTransport(session as any);

    try {
      const responsePromise = fetch(`${baseUrl}/v1/wait/action-end`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'step', timeoutMs: 1000 }),
      });

      setTimeout(() => {
        session.emit('action-end', { id: 'step', continue: true });
      }, 20);

      const response = await responsePromise;
      const payload = await response.json();
      expect(response.ok).toBe(true);
      expect(payload).toEqual({ id: 'step', continue: true });
    } finally {
      await server.close();
      await runtime.stop();
    }
  });

  it('waits for time, chart, and metadata conditions', async () => {
    const { runtime, server, session, baseUrl } = await createRuntimeServer();
    attachConnectedTransport(session as any);

    try {
      session.scenario.apply({
        type: 'chart_create',
        payload: { id: 'alive', label: 'Alive', color: '#22c55e' },
      });

      const timeResponsePromise = fetch(`${baseUrl}/v1/wait/time`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ time: 7, comparison: 'gte', timeoutMs: 1000 }),
      });
      setTimeout(() => {
        applySessionMessage(session as any, {
          type: 'metadata_update',
          payload: { time: 7 },
        });
      }, 20);
      const timeResponse = await timeResponsePromise;
      expect(timeResponse.ok).toBe(true);
      expect(await timeResponse.json()).toEqual({
        kind: 'time',
        comparison: 'gte',
        expectedTime: 7,
        actualTime: 7,
      });

      const chartResponsePromise = fetch(`${baseUrl}/v1/wait/chart`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'alive', value: 5, comparison: 'gte', timeoutMs: 1000 }),
      });
      setTimeout(() => {
        applySessionMessage(session as any, {
          type: 'chart_update',
          payload: { updates: [{ id: 'alive', time: 8, value: 5 }] },
        });
      }, 20);
      const chartResponse = await chartResponsePromise;
      expect(chartResponse.ok).toBe(true);
      expect(await chartResponse.json()).toEqual({
        kind: 'chart',
        id: 'alive',
        comparison: 'gte',
        expectedValue: 5,
        actualValue: 5,
      });

      const metadataResponsePromise = fetch(`${baseUrl}/v1/wait/metadata`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'phase', value: 'stable', timeoutMs: 1000 }),
      });
      setTimeout(() => {
        applySessionMessage(session as any, {
          type: 'metadata_update',
          payload: { phase: 'stable' },
        });
      }, 20);
      const metadataResponse = await metadataResponsePromise;
      expect(metadataResponse.ok).toBe(true);
      expect(await metadataResponse.json()).toEqual({
        kind: 'metadata',
        path: 'phase',
        comparison: 'eq',
        expectedValue: 'stable',
        actualValue: 'stable',
      });
    } finally {
      await server.close();
      await runtime.stop();
    }
  });

  it('runs experiment workflows with sequential waits and structured collection', async () => {
    const { runtime, server, session, baseUrl } = await createRuntimeServer();
    const sentMessages = attachConnectedTransport(session as any, (message) => {
      if (message.type !== 'action_start') {
        return;
      }

      if (message.payload.id === 'reset') {
        setTimeout(() => {
          session.emit('action-end', { id: 'reset', continue: true });
        }, 10);
        return;
      }

      if (message.payload.id === 'start') {
        setTimeout(() => {
          applySessionMessage(session as any, {
            type: 'metadata_update',
            payload: { time: 10, status: 'stable' },
          });
          applySessionMessage(session as any, {
            type: 'chart_update',
            payload: { updates: [{ id: 'alive', time: 10, value: 5 }] },
          });
          session.emit('action-end', { id: 'start', continue: false });
        }, 10);
      }
    });

    try {
      session.scenario.apply({
        type: 'chart_create',
        payload: { id: 'alive', label: 'Alive', color: '#22c55e' },
      });
      session.scenario.apply({ type: 'env_create', payload: { id: 'main', type: '2d' } });

      const response = await fetch(`${baseUrl}/v1/experiment/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: 'smoke-experiment',
          parameters: { speed: 2 },
          reset: true,
          action: { id: 'start' },
          waits: [
            { kind: 'time', time: 10, comparison: 'gte', timeoutMs: 1000 },
            { kind: 'metadata', path: 'status', value: 'stable', timeoutMs: 1000 },
            { kind: 'chart', id: 'alive', value: 5, comparison: 'gte', timeoutMs: 1000 },
          ],
          collect: { scene: true, snapshot: true },
        }),
      });
      const payload = await response.json();

      expect(response.ok).toBe(true);
      expect(payload.label).toBe('smoke-experiment');
      expect(payload.parametersApplied).toEqual([{ id: 'speed', value: 2 }]);
      expect(payload.waits).toEqual([
        { kind: 'action-end', payload: { id: 'reset', continue: true } },
        { kind: 'action-end', payload: { id: 'start', continue: false } },
        { kind: 'time', comparison: 'gte', expectedTime: 10, actualTime: 10 },
        {
          kind: 'metadata',
          path: 'status',
          comparison: 'eq',
          expectedValue: 'stable',
          actualValue: 'stable',
        },
        {
          kind: 'chart',
          id: 'alive',
          comparison: 'gte',
          expectedValue: 5,
          actualValue: 5,
        },
      ]);
      expect(payload.scene.metadata.status).toBe('stable');
      expect(payload.snapshot.snapshot.metadata.time).toBe(10);
      expect(payload.snapshot.charts[0].points).toEqual([{ time: 10, alive: 5 }]);
      expect(sentMessages.filter((message) => message.type === 'param_change')).toEqual([
        { type: 'param_change', payload: { id: 'speed', value: 2 } },
      ]);
      expect(sentMessages.filter((message) => message.type === 'action_start')).toEqual([
        { type: 'action_start', payload: { id: 'reset', continuous: undefined } },
        { type: 'action_start', payload: { id: 'start', continuous: undefined } },
      ]);
    } finally {
      await server.close();
      await runtime.stop();
    }
  });
});