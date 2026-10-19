import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { decodeProtocolMessage, encodeProtocolMessage } from '@tensnap/protocol';
import { RenderPersistenceError } from './painter';
import { AgentRuntime } from './AgentRuntime';
import { resolveRuntimeContextPaths } from './context';
import type { RendererSession, RendererClient } from '@tensnap/core/runtime';
import { readCapturedFrame } from './frame-files';

const temporaryRoots: string[] = [];

it('lists live recordings without copying their payloads and tolerates malformed external filenames', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-recording-catalog-'));
  temporaryRoots.push(rootDir);
  const context = resolveRuntimeContextPaths({ rootDir });
  const runtime = new AgentRuntime(context);
  await runtime.initialize();
  const internal = runtime as unknown as {
    renderer: RendererSession;
    recordingCompletionByRun: Map<string, Promise<void>>;
  };
  try {
    await mkdir(context.recordingsDir, { recursive: true });
    await writeFile(join(context.recordingsDir, 'malformed%.tensnap-recording.json'), '{}');
    internal.renderer.startRecording({ id: 'active', maxSteps: 10, ringBuffer: true });
    internal.renderer.recorder.recordMessage({ type: 'metadata_update', payload: { time: 1 } });
    internal.renderer.recorder.recordMessage({
      type: 'action_result',
      payload: { id: 'step', request_id: 'catalog-step' },
    });
    const copy = vi.spyOn(internal.renderer.recorder, 'current', 'get').mockImplementation(() => {
      throw new Error('Catalog copied full history');
    });
    const entries = await runtime.listRecordings();
    expect(entries).toMatchObject([
      {
        id: 'active',
        status: 'recording',
        report: { frameCount: 1, lastFrame: 1, resourcesComplete: true },
      },
    ]);
    entries[0].report!.retention!.maxFrames = 99;
    expect((await runtime.listRecordings())[0].report?.retention?.maxFrames).toBe(10);
    copy.mockRestore();
    internal.renderer.stopRecording();
    await vi.waitFor(() => {
      expect(internal.recordingCompletionByRun.size).toBe(0);
    });
    const persisted = await runtime.listRecordings();
    expect(persisted[0].error).toBeUndefined();
    expect(persisted).toMatchObject([{ id: 'active', status: 'persisted' }]);
  } finally {
    await runtime.stop();
  }
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
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
    renderer.dispatchEvent(
      new CustomEvent('transport:validation-warning', {
        detail: {
          level: 'warning',
          direction: 'simulator-to-renderer',
          message: 'invalid monitor payload',
          issues: [],
        },
      }),
    );

    await vi.waitFor(async () => {
      expect(await readFile(context.logFile, 'utf8')).toContain('Protocol validation warning.');
    });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'transport.validation-warning' }),
    );
    await runtime.stop();
  });

  it('does not dump or write a checkpoint for every live tick', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-checkpoint-'));
    temporaryRoots.push(rootDir);
    const writes: unknown[] = [];
    const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
      checkpointIntervalMs: 1_000,
      checkpointWriter: async (_context, snapshot) => {
        writes.push(snapshot);
      },
    });
    await runtime.initialize();
    const renderer = (
      runtime as unknown as {
        renderer: { scenario: { dump: () => unknown }; handleIncoming: (message: unknown) => void };
      }
    ).renderer;
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
    if (!address || typeof address === 'string')
      throw new Error('Expected a TCP WebSocket test address.');
    let stateSyncReceived = false;
    server.on('connection', (socket) => {
      setTimeout(() => {
        socket.send(
          encodeProtocolMessage(
            {
              type: 'simulator_info',
              payload: {
                protocol_version: '0.3',
                binding: { name: 'test-binding', version: '0.3.0' },
                model: { id: 'test-model' },
                instance_id: 'test-instance',
                capabilities: [],
              },
            },
            'json',
          ),
        );
      }, 0);
      socket.on('message', (raw) => {
        const message = decodeProtocolMessage(raw.toString());
        if (message.type !== 'state_sync') return;
        stateSyncReceived = true;
        socket.send(
          encodeProtocolMessage(
            {
              type: 'state_sync_begin',
              payload: {
                request_id: message.payload.request_id,
                model_id: 'test-model',
                instance_id: 'test-instance',
                mode: 'replace',
              },
            },
            'json',
          ),
        );
        socket.send(
          encodeProtocolMessage(
            {
              type: 'state_sync_end',
              payload: { request_id: message.payload.request_id, state_revision: '1' },
            },
            'json',
          ),
        );
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
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

describe('AgentRuntime action lifecycle', () => {
  it('dispatches a second CLI action after the first result without a painter', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-actions-'));
    temporaryRoots.push(rootDir);
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected a TCP WebSocket test address.');
    const requestIds: string[] = [];
    server.on('connection', (socket) => {
      socket.send(
        encodeProtocolMessage(
          {
            type: 'simulator_info',
            payload: {
              protocol_version: '0.3',
              binding: { name: 'test-binding', version: '0.3.0' },
              model: { id: 'test-model' },
              instance_id: 'test-instance',
              capabilities: [],
            },
          },
          'json',
        ),
      );
      socket.on('message', (raw) => {
        const message = decodeProtocolMessage(raw.toString());
        if (message.type === 'state_sync') {
          socket.send(
            encodeProtocolMessage(
              {
                type: 'state_sync_begin',
                payload: {
                  request_id: message.payload.request_id,
                  model_id: 'test-model',
                  instance_id: 'test-instance',
                  mode: 'replace',
                },
              },
              'json',
            ),
          );
          socket.send(
            encodeProtocolMessage(
              {
                type: 'state_sync_end',
                payload: {
                  request_id: message.payload.request_id,
                  state_revision: '1',
                },
              },
              'json',
            ),
          );
        }
        if (message.type === 'action_invoke') {
          requestIds.push(message.payload.request_id);
          socket.send(
            encodeProtocolMessage(
              {
                type: 'action_result',
                payload: {
                  id: message.payload.id,
                  request_id: message.payload.request_id,
                },
              },
              'json',
            ),
          );
        }
      });
    });

    const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), { encoding: 'json' });
    await runtime.initialize();
    try {
      await runtime.connect({ simulatorUrl: `ws://127.0.0.1:${address.port}`, encoding: 'json' });
      await runtime.waitUntilReady(1_000);
      await runtime.runAction('step');
      await vi.waitFor(() => expect(requestIds).toHaveLength(1));
      await runtime.runAction('step');
      await vi.waitFor(() => expect(requestIds).toHaveLength(2));
      expect(requestIds[1]).not.toBe(requestIds[0]);
    } finally {
      await runtime.stop();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('waits for the headless painter before scheduling the next action', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-render-barrier-'));
    temporaryRoots.push(rootDir);
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected a TCP WebSocket test address.');
    const requestIds: string[] = [];
    server.on('connection', (socket) => {
      socket.send(
        encodeProtocolMessage(
          {
            type: 'simulator_info',
            payload: {
              protocol_version: '0.3',
              binding: { name: 'test-binding', version: '0.3.0' },
              model: { id: 'test-model' },
              instance_id: 'test-instance',
              capabilities: [],
            },
          },
          'json',
        ),
      );
      socket.on('message', (raw) => {
        const message = decodeProtocolMessage(raw.toString());
        if (message.type === 'state_sync') {
          socket.send(
            encodeProtocolMessage(
              {
                type: 'state_sync_begin',
                payload: {
                  request_id: message.payload.request_id,
                  model_id: 'test-model',
                  instance_id: 'test-instance',
                  mode: 'replace',
                },
              },
              'json',
            ),
          );
          socket.send(
            encodeProtocolMessage(
              {
                type: 'state_sync_end',
                payload: {
                  request_id: message.payload.request_id,
                  state_revision: '1',
                },
              },
              'json',
            ),
          );
        }
        if (message.type === 'action_invoke') {
          requestIds.push(message.payload.request_id);
          socket.send(
            encodeProtocolMessage(
              {
                type: 'action_result',
                payload: {
                  id: message.payload.id,
                  request_id: message.payload.request_id,
                },
              },
              'json',
            ),
          );
        }
      });
    });

    let releasePainter = () => {};
    const painterGate = new Promise<void>((resolve) => {
      releasePainter = resolve;
    });
    const painterStarted = vi.fn();
    const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
      encoding: 'json',
      render: { trigger: 'action-result' },
      checkpointWriter: async () => {},
    });
    runtime.registerPainter({
      id: 'slow',
      async render() {
        painterStarted();
        await painterGate;
        return [{ painterId: 'slow', kind: 'environment', path: '/test-artifact.png' }];
      },
    });
    await runtime.initialize();
    try {
      await runtime.connect({ simulatorUrl: `ws://127.0.0.1:${address.port}`, encoding: 'json' });
      await runtime.waitUntilReady(1_000);
      runtime.startRun({ mode: 'bounded', actionId: 'step', maxSteps: 2 });
      await vi.waitFor(() => expect(painterStarted).toHaveBeenCalledTimes(1));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(requestIds).toHaveLength(1);
      releasePainter();
      await vi.waitFor(() => expect(requestIds).toHaveLength(2));
    } finally {
      releasePainter();
      await runtime.stop();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
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
        return [{ painterId: 'test', kind: 'environment', path: request.options.outputPath }];
      },
    });
    runtime.registerPainter({
      id: 'chart',
      async render(request) {
        outputPaths.push(request.options.outputPath!);
        return [{ painterId: 'test', kind: 'environment', path: request.options.outputPath }];
      },
    });

    await runtime.requestRender({ outputPath: join(rootDir, 'scene.png') });
    expect(outputPaths).toEqual([
      join(rootDir, 'scene-environment.png'),
      join(rootDir, 'scene-chart.png'),
    ]);
    await expect(runtime.requestRender({ envId: 'main', chartId: 'population' })).rejects.toThrow(
      /either an environment or a chart/,
    );
    await runtime.stop();
  });
});

it('reports empty rendering and preserves successful artifacts in a failed painter batch', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-failures-'));
  temporaryRoots.push(rootDir);
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }));
  await runtime.initialize();
  await expect(runtime.requestRender()).rejects.toMatchObject({
    errors: [{ code: 'render_missing' }],
  });
  runtime.registerPainter({
    id: 'good',
    render: async () => [{ painterId: 'good', kind: 'chart', path: '/tmp/good.png' }],
  });
  runtime.registerPainter({
    id: 'bad',
    render: async () => {
      throw new RenderPersistenceError(new Error('disk full'));
    },
  });
  await expect(runtime.requestRender()).rejects.toMatchObject({
    artifacts: [{ path: '/tmp/good.png' }],
    errors: [{ painterId: 'bad', code: 'persistence_failed', message: 'disk full' }],
  });
  await runtime.stop();
});

it.each([false, true])(
  'associates recording persistence with the settled run (failure=%s)',
  async (failure) => {
    const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-recording-'));
    temporaryRoots.push(rootDir);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
      recordingWriter: async () => {
        await gate;
        if (failure) throw new Error('recording disk full');
        return '/test/recording.snapshot.json';
      },
    });
    await runtime.initialize();
    const renderer = (runtime as unknown as { renderer: RendererSession }).renderer;
    renderer.attachTransport({
      connectionId: 'test',
      transportKind: 'inmemory',
      encoding: 'json',
      connectionState: 'open',
      isConnected: true,
      connect: async () => {},
      disconnect() {},
      destroy() {},
      on() {},
      off() {},
      send(message) {
        if (message.type === 'action_invoke') {
          const payload = message.payload as { id: string; request_id: string };
          renderer.handleIncoming({
            type: 'action_result',
            payload: { id: payload.id, request_id: payload.request_id },
          });
        }
      },
    });
    renderer.handleIncoming({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'test', version: '1' },
        model: { id: 'test' },
        instance_id: 'test',
        capabilities: [],
      },
    });
    const run = runtime.startRun({ mode: 'bounded', actionId: 'step', maxSteps: 1, record: {} });
    await renderer.run.waitForSettled(run.id);
    expect(runtime.getRun(run.id)).toMatchObject({
      settled: true,
      recording: { status: 'pending' },
    });
    release();
    await vi.waitFor(() =>
      expect(runtime.getRun(run.id)).toMatchObject({
        recording: failure
          ? { status: 'failed', error: 'recording disk full' }
          : { status: 'persisted', path: '/test/recording.snapshot.json' },
      }),
    );
    await runtime.stop();
  },
);

it('preserves rendered artifacts when the required scene checkpoint cannot be written', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-scene-write-'));
  temporaryRoots.push(rootDir);
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
    checkpointWriter: async () => {
      throw new Error('checkpoint write failed');
    },
  });
  await runtime.initialize();
  runtime.registerPainter({
    id: 'good',
    render: async () => [{ painterId: 'good', kind: 'chart', path: '/tmp/chart.png' }],
  });
  await expect(runtime.requestRender()).rejects.toMatchObject({
    artifacts: [{ path: '/tmp/chart.png' }],
    errors: [
      {
        painterId: 'scene-checkpoint',
        code: 'persistence_failed',
        message: 'checkpoint write failed',
      },
    ],
  });
  await runtime.stop();
});

function attachReviewTransport(runtime: AgentRuntime) {
  const renderer = (runtime as unknown as { renderer: RendererSession }).renderer;
  let dispatched = 0;
  const client = (runtime as unknown as { client: RendererClient }).client;
  client.attachTransport({
    connectionId: 'review',
    transportKind: 'inmemory',
    encoding: 'json',
    connectionState: 'open',
    isConnected: true,
    connect: async () => {},
    disconnect() {},
    destroy() {},
    on() {},
    off() {},
    send(message) {
      if (message.type === 'action_invoke') {
        dispatched++;
        const payload = message.payload as { id: string; request_id: string };
        renderer.handleIncoming({ type: 'metadata_update', payload: { time: dispatched } });
        renderer.handleIncoming({
          type: 'action_result',
          payload: { id: payload.id, request_id: payload.request_id },
        });
      }
    },
  });
  renderer.handleIncoming({
    type: 'simulator_info',
    payload: {
      protocol_version: '0.3',
      binding: { name: 'test', version: '1' },
      model: { id: 'test' },
      instance_id: 'test',
      capabilities: [],
    },
  });
  return {
    renderer,
    get dispatched() {
      return dispatched;
    },
  };
}

it('captures and checkpoints a settled scene only once while its writer is slow', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-settled-once-'));
  temporaryRoots.push(rootDir);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: unknown[] = [];
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
    checkpointWriter: async (_context, snapshot) => {
      writes.push(snapshot);
      await gate;
    },
  });
  await runtime.initialize();
  const { renderer } = attachReviewTransport(runtime);
  const dump = vi.spyOn(renderer.scenario, 'dump');
  try {
    const run = runtime.startRun({ mode: 'bounded', actionId: 'step', maxSteps: 1 });
    await renderer.run.waitForSettled(run.id);
    expect(dump).toHaveBeenCalledTimes(1);
    release();
    await runtime.stop();
    expect(writes).toHaveLength(1);
  } finally {
    release();
    await runtime.stop();
  }
});

it.each([false, true])(
  'bounds pending recordings and permits retry after write completion (failure=%s)',
  async (failure) => {
    const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-recording-backpressure-'));
    temporaryRoots.push(rootDir);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;
    const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
      recordingWriter: async () => {
        await gate;
        if (++writes === 1 && failure) throw new Error('recording write failed');
        return '/test/archive.json';
      },
      checkpointWriter: async () => {},
    });
    await runtime.initialize();
    const transport = attachReviewTransport(runtime);
    const spec = { mode: 'bounded', actionId: 'step', maxSteps: 1, record: {} } as const;
    try {
      const first = runtime.startRun(spec);
      await transport.renderer.run.waitForSettled(first.id);
      expect(runtime.getRun(first.id)?.recording?.status).toBe('pending');
      expect(() => runtime.startRun(spec)).toThrow(/recording.*persist|pending recording/i);
      expect(transport.dispatched).toBe(1);
      const unrecorded = runtime.startRun({ mode: 'bounded', actionId: 'step', maxSteps: 1 });
      await transport.renderer.run.waitForSettled(unrecorded.id);
      let next: ReturnType<AgentRuntime['startRun']> | undefined;
      let callbackError: unknown;
      runtime.on('event', (event) => {
        if (event.type === 'recording.persistence' && event.data.runId === first.id) {
          try {
            next = runtime.startRun(spec);
          } catch (error) {
            callbackError = error;
          }
        }
      });
      release();
      await vi.waitFor(() => {
        expect(callbackError).toBeUndefined();
        expect(next).toBeDefined();
      });
      await transport.renderer.run.waitForSettled(next!.id);
      expect(transport.dispatched).toBe(3);
    } finally {
      release();
      await runtime.stop();
    }
  },
);

it.each([false, true])(
  'does not checkpoint a late render snapshot as newer scene state (newer render=%s)',
  async (newerRender) => {
    const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-render-revision-'));
    temporaryRoots.push(rootDir);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const savedTimes: unknown[] = [];
    const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
      checkpointWriter: async (_context, snapshot) => {
        savedTimes.push(snapshot.metadata.time);
      },
    });
    await runtime.initialize();
    const { renderer } = attachReviewTransport(runtime);
    const renderedTimes: unknown[] = [];
    runtime.registerPainter({
      id: 'delayed',
      render: async (request) => {
        renderedTimes.push(request.snapshot.metadata.time);
        if (request.reason === 'older') await gate;
        return [
          {
            painterId: 'delayed',
            kind: 'chart',
            path: '/test.png',
            metadata: { time: request.snapshot.metadata.time },
          },
        ];
      },
    });
    try {
      renderer.handleIncoming({ type: 'metadata_update', payload: { time: 1 } });
      const older = runtime.requestRender({}, 'older');
      renderer.handleIncoming({ type: 'metadata_update', payload: { time: 2 } });
      if (newerRender) await runtime.requestRender({}, 'newer');
      release();
      expect((await older)[0]?.metadata?.time).toBe(1);
      expect(renderedTimes[0]).toBe(1);
      expect(savedTimes.at(-1)).toBe(2);
      expect(runtime.getStatus().sceneDirty).toBe(false);
    } finally {
      release();
      await runtime.stop();
    }
  },
);

it('disconnects the simulator before awaiting slow final scene persistence', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-disconnect-first-'));
  temporaryRoots.push(rootDir);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
    checkpointWriter: async () => {
      await gate;
    },
  });
  await runtime.initialize();
  const { renderer } = attachReviewTransport(runtime);
  renderer.handleIncoming({ type: 'metadata_update', payload: { time: 1 } });
  const disconnecting = runtime.disconnect();
  try {
    expect(renderer.isConnected).toBe(false);
  } finally {
    release();
    await disconnecting;
    await runtime.stop();
  }
});

it('propagates a joined checkpoint failure and allows a clean shutdown retry', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-checkpoint-retry-'));
  temporaryRoots.push(rootDir);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writing = new Promise<void>((resolve) => {
    started = resolve;
  });
  let attempts = 0;
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
    checkpointWriter: async () => {
      attempts++;
      if (attempts === 1) {
        started();
        await gate;
        throw new Error('disk full');
      }
    },
  });
  await runtime.initialize();
  const { renderer } = attachReviewTransport(runtime);
  runtime.registerPainter({
    id: 'test',
    render: async () => [{ painterId: 'test', kind: 'chart', path: '/test.png' }],
  });
  renderer.handleIncoming({ type: 'metadata_update', payload: { time: 1 } });
  const rendering = expect(runtime.requestRender()).rejects.toMatchObject({
    artifacts: [{ path: '/test.png' }],
    errors: [{ code: 'persistence_failed' }],
  });
  await writing;
  const disconnected = expect(runtime.disconnect()).rejects.toThrow('disk full');
  try {
    expect(renderer.isConnected).toBe(false);
    release();
    await Promise.all([rendering, disconnected]);
    expect(runtime.getStatus().sceneDirty).toBe(true);
    await runtime.stop();
    expect(attempts).toBe(2);
    expect(runtime.getStatus().sceneDirty).toBe(false);
  } finally {
    release();
    await runtime.stop();
  }
});

it('returns runtime status with independently owned mutable fields', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-status-ownership-'));
  temporaryRoots.push(rootDir);
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }));
  await runtime.initialize();
  runtime.registerPainter({ id: 'test', render: async () => [] });
  try {
    const status = runtime.getStatus();
    status.render.trigger = 'action-result';
    status.render.backgroundColor = '#ffffff';
    status.painters.push('injected');
    expect(runtime.getStatus()).toMatchObject({
      render: { trigger: 'manual', backgroundColor: '#000000' },
      painters: ['test'],
    });
  } finally {
    await runtime.stop();
  }
});

it('captures viewport values before a render awaits a painter', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-render-ownership-'));
  temporaryRoots.push(rootDir);
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
    checkpointWriter: async () => {},
  });
  await runtime.initialize();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let renderedViewport: unknown;
  const events: unknown[] = [];
  runtime.on('event', (event) => {
    if (event.type === 'render.requested') events.push(event.data);
  });
  runtime.registerPainter({
    id: 'delayed',
    render: async (request) => {
      await gate;
      renderedViewport = { ...request.options.viewport };
      return [{ painterId: 'delayed', kind: 'environment' }];
    },
  });
  const viewport = { x: 1, y: 2, width: 3, height: 4 };
  const options = { viewport, envId: 'main', outputPath: '/original.png' };
  const rendering = runtime.requestRender(options);
  viewport.x = 99;
  options.envId = 'changed';
  options.outputPath = '/changed.png';
  try {
    release();
    await rendering;
    expect(renderedViewport).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(events).toContainEqual(
      expect.objectContaining({ envId: 'main', outputPath: '/original.png' }),
    );
  } finally {
    release();
    await runtime.stop();
  }
});

it('owns inspection render input without dumping the unrelated live scene', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-inspection-ownership-'));
  temporaryRoots.push(rootDir);
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }));
  await runtime.initialize();
  const { renderer } = attachReviewTransport(runtime);
  renderer.handleIncoming({ type: 'metadata_update', payload: { time: 1 } });
  renderer.handleIncoming({ type: 'env_create', payload: { id: 'main', type: '2d' } });
  renderer.handleIncoming({
    type: 'env_layer_create',
    payload: { env_id: 'main', layer_id: 'agents', layer_type: 'agent' },
  });
  renderer.handleIncoming({
    type: 'item_create',
    payload: { env_id: 'main', layer_id: 'agents', items: [{ id: 'a', x: 1, y: 2 }] },
  });
  const inspection = runtime.inspectAgent({
    environmentId: 'main',
    layerId: 'agents',
    agentId: 'a',
  });
  if (!inspection || inspection.kind === 'none' || !inspection.renderSnapshot)
    throw new Error('Expected a renderable inspection.');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured: unknown;
  runtime.registerPainter({
    id: 'test',
    render: async (request) => {
      await gate;
      captured = request.snapshot.metadata.time;
      return [{ painterId: 'test', kind: 'environment' }];
    },
  });
  const dump = vi.spyOn(renderer.scenario, 'dump');
  try {
    const rendering = runtime.renderAgentInspection(inspection);
    inspection.renderSnapshot.metadata.time = 99;
    release();
    await rendering;
    expect(captured).toBe(1);
    expect(dump).not.toHaveBeenCalled();
  } finally {
    release();
    dump.mockRestore();
    await runtime.stop();
  }
});

it('reports background status and log write failures without rejecting unobserved promises', async () => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-background-writes-'));
  temporaryRoots.push(rootDir);
  const context = resolveRuntimeContextPaths({ rootDir });
  const runtime = new AgentRuntime(context, { checkpointWriter: async () => {} });
  await runtime.initialize();
  const { renderer } = attachReviewTransport(runtime);
  const events: string[] = [];
  runtime.on('event', (event) => events.push(event.type));
  await rm(context.logsDir, { recursive: true });
  await writeFile(context.logsDir, 'blocker');
  try {
    runtime.registerPainter({ id: 'test', render: async () => [] });
    const run = runtime.startRun({ mode: 'bounded', actionId: 'step', maxSteps: 1 });
    await renderer.run.waitForSettled(run.id);
    await vi.waitFor(() => {
      expect(events).toContain('runtime.status-write-failed');
      expect(events).toContain('runtime.log-write-failed');
    });
    expect(runtime.getRun(run.id)?.settled).toBe(true);
  } finally {
    await rm(context.logsDir, { force: true });
    await mkdir(context.logsDir);
    await runtime.stop();
  }
});

it('reports background state-sync checkpoint failure and retains the committed scene for retry', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-sync-checkpoint-failure-'));
  temporaryRoots.push(rootDir);
  let attempts = 0;
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
    checkpointWriter: async () => {
      if (++attempts === 1) throw new Error('checkpoint disk full');
    },
  });
  await runtime.initialize();
  const { renderer } = attachReviewTransport(runtime);
  const failures: unknown[] = [];
  runtime.on('event', (event) => {
    if (event.type === 'scene.persistence-failed') failures.push(event.data);
  });
  try {
    const requestId = renderer.requestStateSync();
    renderer.handleIncoming({
      type: 'state_sync_begin',
      payload: { request_id: requestId, model_id: 'test', instance_id: 'test', mode: 'replace' },
    });
    renderer.handleIncoming({ type: 'metadata_update', payload: { time: 42 } });
    renderer.handleIncoming({
      type: 'state_sync_end',
      payload: { request_id: requestId, state_revision: '42' },
    });
    await vi.waitFor(() =>
      expect(failures).toContainEqual(
        expect.objectContaining({ error: expect.stringContaining('checkpoint disk full') }),
      ),
    );
    expect(runtime.inspectScene().time).toBe(42);
    expect(runtime.getStatus().sceneDirty).toBe(true);
    await runtime.stop();
    expect(runtime.getStatus().sceneDirty).toBe(false);
  } finally {
    await runtime.stop();
  }
});

it('reports a background screenshot response failure after its transport becomes unavailable', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-screenshot-response-failure-'));
  temporaryRoots.push(rootDir);
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
    checkpointWriter: async () => {},
  });
  await runtime.initialize();
  const { renderer } = attachReviewTransport(runtime);
  const failures: unknown[] = [];
  runtime.on('event', (event) => {
    if (event.type === 'render.screenshot-failed') failures.push(event.data);
  });
  runtime.registerPainter({
    id: 'test',
    render: async () => [{ painterId: 'test', kind: 'environment', data: new Uint8Array([1, 2]) }],
  });
  renderer.attachedTransport!.send = () => {
    throw new Error('transport closed');
  };
  try {
    renderer.handleIncoming({
      type: 'screenshot_request',
      payload: { request_id: 'screenshot-1' },
    });
    await vi.waitFor(() =>
      expect(failures).toContainEqual({ requestId: 'screenshot-1', error: 'transport closed' }),
    );
  } finally {
    await runtime.stop();
  }
});

it('captures connection options before awaiting status persistence', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-connect-ownership-'));
  temporaryRoots.push(rootDir);
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server.');
  server.on('connection', (socket) =>
    socket.send(
      JSON.stringify({
        type: 'simulator_info',
        payload: {
          protocol_version: '0.3',
          binding: { name: 'test', version: '1' },
          model: { id: 'test' },
          instance_id: 'test',
          capabilities: [],
        },
      }),
    ),
  );
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }));
  await runtime.initialize();
  const simulatorUrl = `ws://127.0.0.1:${address.port}`;
  const options = { simulatorUrl, encoding: 'json' as const };
  const connecting = runtime.connect(options);
  options.simulatorUrl = 'invalid-url-after-call';
  try {
    await expect(connecting).resolves.toMatchObject({ simulatorUrl, isConnected: true });
  } finally {
    await runtime.stop();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it.each(['status-write', 'handshake'] as const)(
  'cancels a connection during %s without attaching it after disconnect returns',
  async (stage) => {
    const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-connect-cancel-'));
    temporaryRoots.push(rootDir);
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server.');
    const handshake = JSON.stringify({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'test', version: '1' },
        model: { id: 'test' },
        instance_id: 'test',
        capabilities: [],
      },
    });
    let connectedSocket: WebSocket | undefined;
    let accepted!: () => void;
    const acceptedConnection = new Promise<void>((resolve) => {
      accepted = resolve;
    });
    server.on('connection', (socket) => {
      connectedSocket = socket;
      accepted();
      if (stage === 'status-write') socket.send(handshake);
    });
    const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }));
    await runtime.initialize();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const status = runtime as unknown as { persistStatus(): Promise<void> };
    const writer =
      stage === 'status-write'
        ? vi.spyOn(status, 'persistStatus').mockReturnValue(gate)
        : undefined;
    const result = runtime
      .connect({ simulatorUrl: `ws://127.0.0.1:${address.port}`, encoding: 'json' })
      .then(
        () => 'connected',
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
    try {
      if (stage === 'handshake') await acceptedConnection;
      await runtime.disconnect();
      release();
      if (connectedSocket?.readyState === 1 && stage === 'handshake')
        connectedSocket.send(handshake);
      expect(await result).toMatch(/cancel/i);
      expect(runtime.getStatus()).toMatchObject({ isConnected: false, phase: 'idle' });
      if (stage === 'status-write') expect(connectedSocket).toBeUndefined();
    } finally {
      release();
      writer?.mockRestore();
      await runtime.stop();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);

it('retains action and run settlements by ID across subsequent operations', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-waits-'));
  temporaryRoots.push(rootDir);
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
    checkpointWriter: async () => {},
  });
  await runtime.initialize();
  attachReviewTransport(runtime);
  try {
    const requestId = await runtime.runAction('step');
    expect(await runtime.waitAction(requestId)).toMatchObject({
      requestId,
      status: 'succeeded',
      settled: true,
    });
    const first = runtime.startRun({ mode: 'bounded', actionId: 'step', maxSteps: 1 });
    await runtime.waitRun(first.id);
    const second = runtime.startRun({ mode: 'bounded', actionId: 'step', maxSteps: 1 });
    expect((await runtime.waitRun(first.id)).id).toBe(first.id);
    await runtime.waitRun(second.id);
    expect((await runtime.waitAction(requestId)).requestId).toBe(requestId);
    await expect(runtime.waitAction('unknown')).rejects.toThrow(/Unknown/);
  } finally {
    await runtime.stop();
  }
});

it('returns independent settlements to concurrent waiters and event observers', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-action-ownership-'));
  temporaryRoots.push(rootDir);
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
    render: { trigger: 'action-result' },
    checkpointWriter: async () => {},
  });
  await runtime.initialize();
  attachReviewTransport(runtime);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  runtime.registerPainter({
    id: 'gate',
    render: async () => {
      await gate;
      return [{ painterId: 'gate', kind: 'environment' }];
    },
  });
  runtime.on('event', (event) => {
    if (event.type === 'action.settled') event.data.result.id = 'observer-mutation';
  });
  try {
    const requestId = await runtime.runAction('step');
    const first = runtime.waitAction(requestId);
    const second = runtime.waitAction(requestId);
    release();
    const [left, right] = await Promise.all([first, second]);
    expect(left.result?.id).toBe('step');
    left.result!.id = 'caller-mutation';
    expect(right.result?.id).toBe('step');
    expect(runtime.getAction(requestId)?.result?.id).toBe('step');
  } finally {
    release();
    await runtime.stop();
  }
});

it('keeps callable recording policies out of serializable owned status', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-recording-options-'));
  temporaryRoots.push(rootDir);
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }));
  await runtime.initialize();
  const { renderer } = attachReviewTransport(runtime);
  try {
    const options = {
      id: 'custom-policy',
      layerCodecs: { agents: 'delta' as const },
      layerCodecImplementations: { delta: { id: 'delta' as const, retainItemDelta: () => true } },
    };
    expect(() => runtime.startRecording({ id: 'custom-policy', maxBytes: 1 }, 'msgpack')).toThrow();
    const status = runtime.startRecording(options);
    expect(status.format).toBe('json');
    expect(status.options).not.toHaveProperty('layerCodecImplementations');
    expect(renderer.recorder.active).toBe(true);
    status.options!.layerCodecs!.agents = 'keyframe';
    expect((await runtime.listRecordings())[0].options?.layerCodecs?.agents).toBe('delta');
    expect(options.layerCodecs.agents).toBe('delta');
    expect((await runtime.stopRecording()).status).toBe('persisted');
  } finally {
    await runtime.stop();
  }
});

it('owns frame API options before capture and file reads suspend', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-frame-options-'));
  temporaryRoots.push(rootDir);
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
    checkpointWriter: async () => {},
  });
  await runtime.initialize();
  const { renderer } = attachReviewTransport(runtime);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const capture = renderer.captureFrame.bind(renderer);
  vi.spyOn(renderer, 'captureFrame').mockImplementation(async (...args) => {
    const frame = await capture(...args);
    await gate;
    return frame;
  });
  runtime.registerPainter({
    id: 'fixed',
    render: async () => [{ painterId: 'fixed', kind: 'environment', data: Uint8Array.of(1) }],
  });
  try {
    const options = {
      envIds: ['world'],
      renderOptions: { viewport: { x: 1, y: 2, width: 640, height: 480 } },
    };
    const directory = join(rootDir, 'saved');
    const saving = runtime.saveFrame(directory, options);
    options.envIds[0] = 'changed';
    options.renderOptions.viewport.x = 99;
    release();
    await saving;
    const manifest = (await readCapturedFrame(directory)).manifest;
    expect(manifest.artifacts[0].path).toBe('environment-world.png');
    expect(manifest.renderOptions.viewport).toMatchObject({ x: 1 });
    const restore = vi
      .spyOn(renderer, 'restoreFrame')
      .mockResolvedValue({ modelStatus: 'restored', historyStatus: 'restored', stateKnown: true });
    const settings = { mode: 'projected' as 'projected' | 'checkpoint', historyTime: 8 };
    const restoring = runtime.restoreFrame(directory, settings);
    settings.mode = 'checkpoint';
    settings.historyTime = 99;
    await restoring;
    expect(restore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: 'projected', historyTime: 8 }),
    );
  } finally {
    release();
    vi.restoreAllMocks();
    await runtime.stop();
  }
});

it('a persistence wait timeout leaves the run and recording intact for a later wait', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-persist-wait-'));
  temporaryRoots.push(rootDir);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
    checkpointWriter: async () => {},
    recordingWriter: async () => {
      await gate;
      return '/fixture/recording';
    },
  });
  await runtime.initialize();
  attachReviewTransport(runtime);
  try {
    const run = runtime.startRun({ mode: 'bounded', actionId: 'step', maxSteps: 1, record: {} });
    await expect(runtime.waitRun(run.id, 'persisted', 5)).rejects.toThrow(/Timed out/);
    expect(runtime.getRun(run.id)?.recording?.status).toBe('pending');
    release();
    expect((await runtime.waitRun(run.id, 'persisted')).recording?.status).toBe('persisted');
  } finally {
    release();
    await runtime.stop();
  }
});

it('discovers MessagePack recordings and preserves JSON as the default export format', async () => {
  const { Scenario } = await import('@tensnap/core/scenario');
  const { createSingleSnapshot } = await import('@tensnap/core/snapshot');
  const { encodeRecordingFile, decodeRecordingFile } = await import('@tensnap/core/persistence');
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-binary-recordings-'));
  temporaryRoots.push(rootDir);
  const context = resolveRuntimeContextPaths({ rootDir });
  const runtime = new AgentRuntime(context);
  await runtime.initialize();
  try {
    await mkdir(context.recordingsDir, { recursive: true });
    await writeFile(
      join(context.recordingsDir, 'binary.tensnap-recording.msgpack'),
      encodeRecordingFile(createSingleSnapshot(new Scenario().dump(), { id: 'binary' }), {
        format: 'msgpack',
      }),
    );
    expect(await runtime.listRecordings()).toMatchObject([{ id: 'binary', status: 'persisted' }]);
    const json = join(rootDir, 'default.json');
    const binary = join(rootDir, 'export.msgpack');
    await runtime.exportRecording('binary', json);
    await runtime.exportRecording('binary', binary, 'msgpack');
    expect((await readFile(json, 'utf8')).startsWith('{')).toBe(true);
    expect((await readFile(binary))[0]).not.toBe(123);
    expect(decodeRecordingFile(await readFile(binary)).snapshot.metadata.id).toBe('binary');
  } finally {
    await runtime.stop();
  }
});

it('restores recording admission across restarts and preserves existing bytes for both formats', async () => {
  const { decodeRecordingFile } = await import('@tensnap/core/persistence');
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-recording-restart-'));
  temporaryRoots.push(rootDir);
  const context = resolveRuntimeContextPaths({ rootDir });
  const first = new AgentRuntime(context);
  await first.initialize();
  attachReviewTransport(first);
  first.startRecording({ id: 'same/id' }, 'msgpack');
  const saved = await first.stopRecording();
  const original = await readFile(saved.path!);
  await first.stop();
  const second = new AgentRuntime(context);
  await second.initialize();
  attachReviewTransport(second);
  try {
    for (const format of ['json', 'msgpack'] as const) {
      expect(() => second.startRecording({ id: 'same/id' }, format)).toThrow('ID already exists');
      expect(() =>
        second.startRun(
          { mode: 'bounded', actionId: 'step', maxSteps: 1, record: { id: 'same/id' } },
          format,
        ),
      ).toThrow('ID already exists');
    }
    expect(await readFile(saved.path!)).toEqual(original);
    expect(decodeRecordingFile(original).snapshot.metadata.id).toBe('same/id');
  } finally {
    await second.stop();
  }
});

it('does not change the active recording format when recorded-run admission fails', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-recording-admission-'));
  temporaryRoots.push(rootDir);
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }));
  await runtime.initialize();
  attachReviewTransport(runtime);
  try {
    runtime.startRecording({ id: 'active' }, 'msgpack');
    expect(() =>
      runtime.startRun(
        { mode: 'bounded', actionId: 'step', maxSteps: 1, record: { id: 'active' } },
        'msgpack',
      ),
    ).toThrow('already active');
    const result = await runtime.stopRecording();
    expect(result.path).toMatch(/\.msgpack$/);
    expect((await readFile(result.path!))[0]).not.toBe(123);
  } finally {
    await runtime.stop();
  }
});

it('settles manual actions, finalizes recordings and joins repeated shutdowns', async () => {
  const { decodeRecordingFile } = await import('@tensnap/core/persistence');
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-recording-stop-'));
  temporaryRoots.push(rootDir);
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }));
  await runtime.initialize();
  const { renderer } = attachReviewTransport(runtime);
  runtime.startRecording({ id: 'shutdown' }, 'msgpack');
  await runtime.runAction('step');
  const stop = runtime.stop();
  expect(runtime.stop()).toBe(stop);
  expect(() => runtime.startRecording()).toThrow('shutting down');
  await stop;
  expect(renderer.recorder.active).toBe(false);
  const entry = (await runtime.listRecordings()).find((entry) => entry.id === 'shutdown')!;
  expect(entry.error).toBeUndefined();
  expect(entry.status).toBe('persisted');
  expect(decodeRecordingFile(await readFile(entry.path!)).snapshot.frames.length).toBeGreaterThan(
    0,
  );
});

it('finalizes on disconnect and still drains writes if checkpointing fails', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-recording-disconnect-'));
  temporaryRoots.push(rootDir);
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
    checkpointWriter: async () => {
      throw new Error('checkpoint failed');
    },
  });
  await runtime.initialize();
  const { renderer } = attachReviewTransport(runtime);
  runtime.startRecording({ id: 'disconnect' });
  renderer.handleIncoming({ type: 'metadata_update', payload: { time: 2 } });
  await expect(runtime.stop()).rejects.toThrow('checkpoint failed');
  expect(runtime.getStatus().phase).toBe('stopped');
  expect(renderer.recorder.active).toBe(false);
  expect(await runtime.listRecordings()).toMatchObject([{ id: 'disconnect', status: 'persisted' }]);
});

it('applies the same pending-write admission rule to manual and bounded recordings', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-recording-pending-'));
  temporaryRoots.push(rootDir);
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
    recordingWriter: async () => {
      await gate;
      return '/recording';
    },
  });
  await runtime.initialize();
  attachReviewTransport(runtime);
  try {
    runtime.startRecording({ id: 'manual' }, 'msgpack');
    const stopping = runtime.stopRecording();
    expect(() => runtime.startRecording({ id: 'next' })).toThrow('pending recording');
    expect(() =>
      runtime.startRun({ mode: 'bounded', actionId: 'step', maxSteps: 1, record: {} }),
    ).toThrow('pending recording');
    release();
    expect((await stopping).status).toBe('persisted');
  } finally {
    release();
    await runtime.stop();
  }
});
