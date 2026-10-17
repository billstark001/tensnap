import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { decodeProtocolMessage, encodeProtocolMessage } from '@tensnap/protocol';
import { RenderPersistenceError } from './painter';
import { AgentRuntime } from './AgentRuntime';
import { resolveRuntimeContextPaths } from './context';

const temporaryRoots: string[] = [];

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
    const renderer = (
      runtime as unknown as { renderer: import('@tensnap/core/runtime').RendererSession }
    ).renderer;
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
          renderer.handleIncoming({ type: 'action_result', payload });
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
  const renderer = (
    runtime as unknown as { renderer: import('@tensnap/core/runtime').RendererSession }
  ).renderer;
  let dispatched = 0;
  const client = (runtime as unknown as { client: import('@tensnap/core/runtime').RendererClient })
    .client;
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
        renderer.handleIncoming({ type: 'action_result', payload });
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
