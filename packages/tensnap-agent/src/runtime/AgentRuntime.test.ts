import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { decodeProtocolMessage, encodeProtocolMessage } from '@tensnap/protocol';
import { AgentRuntime } from './AgentRuntime';
import { resolveRuntimeContextPaths } from './context';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('AgentRuntime checkpointing', () => {
  it('keeps protocol validation disabled by default and exposes explicit levels in status', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-validation-'));
    temporaryRoots.push(rootDir);
    const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
      clientMessageValidation: 'warning',
      serverMessageValidation: 'error',
    });
    await runtime.initialize();
    expect(runtime.getStatus()).toMatchObject({
      clientMessageValidation: 'warning',
      serverMessageValidation: 'error',
    });
    await runtime.stop();

    const defaultRoot = await mkdtemp(join(tmpdir(), 'tensnap-agent-validation-default-'));
    temporaryRoots.push(defaultRoot);
    const defaultRuntime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir: defaultRoot }));
    await defaultRuntime.initialize();
    expect(defaultRuntime.getStatus()).toMatchObject({
      clientMessageValidation: 'off',
      serverMessageValidation: 'off',
    });
    await defaultRuntime.stop();
  });

  it('publishes validation warnings to the runtime event stream and persistent log', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-validation-warning-'));
    temporaryRoots.push(rootDir);
    const context = resolveRuntimeContextPaths({ rootDir });
    const runtime = new AgentRuntime(context);
    const events: Array<{ type: string }> = [];
    runtime.on('event', (event) => events.push(event as { type: string }));
    await runtime.initialize();

    const renderer = (runtime as unknown as { renderer: EventTarget }).renderer;
    renderer.dispatchEvent(new CustomEvent('transport:validation-warning', {
      detail: {
        level: 'warning',
        direction: 'simulator-to-renderer',
        message: 'invalid monitor payload',
        issues: [],
      },
    }));

    await vi.waitFor(async () => {
      expect(await readFile(context.logFile, 'utf8')).toContain('Protocol validation warning.');
    });
    expect(events).toContainEqual(expect.objectContaining({ type: 'transport.validation-warning' }));
    await runtime.stop();
  });

  it('does not dump or write a checkpoint for every live tick', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-checkpoint-'));
    temporaryRoots.push(rootDir);
    const writes: unknown[] = [];
    const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
      checkpointIntervalMs: 1_000,
      checkpointWriter: async (_context, snapshot) => { writes.push(snapshot); },
    });
    await runtime.initialize();
    const renderer = (runtime as unknown as { renderer: { scenario: { dump: () => unknown }; handleIncoming: (message: unknown) => void } }).renderer;
    renderer.handleIncoming({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'test-binding', version: '0.3.0' },
        model: { id: 'test-model' },
        instance_id: 'test-instance',
        capabilities: [],
      },
    });
    const dump = vi.spyOn(renderer.scenario, 'dump');

    for (let tick = 1; tick <= 100; tick += 1) {
      renderer.handleIncoming({ type: 'metadata_update', payload: { tick } });
    }

    expect(dump).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    await runtime.stop();

    expect(dump).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(1);
    expect((writes[0] as { metadata: { tick: number } }).metadata.tick).toBe(100);
  });

  it('waits for simulator_info before issuing the initial state sync', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-connect-'));
    temporaryRoots.push(rootDir);
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP WebSocket test address.');
    let stateSyncReceived = false;
    server.on('connection', (socket) => {
      setTimeout(() => {
        socket.send(encodeProtocolMessage({
          type: 'simulator_info',
          payload: {
            protocol_version: '0.3',
            binding: { name: 'test-binding', version: '0.3.0' },
            model: { id: 'test-model' },
            instance_id: 'test-instance',
            capabilities: [],
          },
        }, 'json'));
      }, 0);
      socket.on('message', (raw) => {
        const message = decodeProtocolMessage(raw.toString());
        if (message.type !== 'state_sync') return;
        stateSyncReceived = true;
        socket.send(encodeProtocolMessage({
          type: 'state_sync_begin',
          payload: {
            request_id: message.payload.request_id,
            model_id: 'test-model',
            instance_id: 'test-instance',
            mode: 'replace',
          },
        }, 'json'));
        socket.send(encodeProtocolMessage({
          type: 'state_sync_end',
          payload: { request_id: message.payload.request_id, state_revision: '1' },
        }, 'json'));
      });
    });

    const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), { encoding: 'json' });
    await runtime.initialize();
    try {
      await runtime.connect({ simulatorUrl: `ws://127.0.0.1:${address.port}`, encoding: 'json' });
      await runtime.waitUntilReady(1_000);
      expect(stateSyncReceived).toBe(true);
      expect(runtime.getStatus().phase).toBe('ready');
    } finally {
      await runtime.stop();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

describe('AgentRuntime rendering', () => {
  it('disambiguates an untargeted output path across painters', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-render-'));
    temporaryRoots.push(rootDir);
    const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }));
    await runtime.initialize();
    const outputPaths: string[] = [];
    runtime.registerPainter({
      id: 'environment',
      async render(request) {
        outputPaths.push(request.options.outputPath!);
        return [];
      },
    });
    runtime.registerPainter({
      id: 'chart',
      async render(request) {
        outputPaths.push(request.options.outputPath!);
        return [];
      },
    });

    await runtime.requestRender({ outputPath: join(rootDir, 'scene.png') });
    expect(outputPaths).toEqual([
      join(rootDir, 'scene-environment.png'),
      join(rootDir, 'scene-chart.png'),
    ]);
    await expect(runtime.requestRender({ envId: 'main', chartId: 'population' }))
      .rejects.toThrow(/either an environment or a chart/);
    await runtime.stop();
  });
});
