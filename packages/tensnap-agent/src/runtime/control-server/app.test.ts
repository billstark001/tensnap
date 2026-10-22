import { describe, expect, it, vi } from 'vitest';
import type { AgentRuntime } from '../AgentRuntime';
import { buildControlApp } from './app';
import { RuntimeSseBroker } from './sse-broker';

describe('control API JSON envelopes', () => {
  it('encodes render bytes as base64 instead of JSON numeric object properties', async () => {
    const requestRender = vi.fn().mockResolvedValue([
      { painterId: 'test', kind: 'chart', mime: 'image/png', data: new Uint8Array([0, 128, 255]) },
      { painterId: 'empty', kind: 'chart', data: new Uint8Array() },
      { painterId: 'file', kind: 'environment', path: '/tmp/image.png' },
    ]);
    const app = buildControlApp(
      { requestRender } as unknown as AgentRuntime,
      new RuntimeSseBroker(),
      () => {},
    );
    const response = await app.request('/v1/scene/render', { method: 'POST', body: '{}' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      artifacts: [
        {
          painterId: 'test',
          kind: 'chart',
          mime: 'image/png',
          data: 'AID/',
          dataEncoding: 'base64',
        },
        { painterId: 'empty', kind: 'chart', data: '', dataEncoding: 'base64' },
        { painterId: 'file', kind: 'environment', path: '/tmp/image.png' },
      ],
    });
  });

  const routes = [
    '/v1/runs',
    '/v1/scene/restore',
    '/v1/scene/render',
    '/v1/params/speed',
    '/v1/runtime/connect',
    '/v1/runtime/render-trigger',
    '/v1/runtime/wait-ready',
  ];
  for (const route of routes) {
    it.each(['{', 'null', '[]', '42', '"text"'])(
      `rejects %s at ${route} as a client error`,
      async (body) => {
        const app = buildControlApp({} as AgentRuntime, new RuntimeSseBroker(), () => {});
        const response = await app.request(route, { method: 'POST', body });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: expect.stringContaining('JSON') });
      },
    );
  }

  it('keeps the wait-ready body optional', async () => {
    const waitUntilReady = vi.fn().mockResolvedValue({ phase: 'ready' });
    const app = buildControlApp(
      { waitUntilReady } as unknown as AgentRuntime,
      new RuntimeSseBroker(),
      () => {},
    );
    const response = await app.request('/v1/runtime/wait-ready', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(waitUntilReady).toHaveBeenCalledExactlyOnceWith(undefined);
  });
});

it.each([
  ['/v1/scene/render', { typo: true }],
  ['/v1/scene/render', { width: -1 }],
  ['/v1/scene/render', { includeData: 'yes' }],
  ['/v1/scene/render', { viewport: { x: 0, y: 0, width: 1, height: 0 } }],
  ['/v1/runs', { mode: 'bounded', actionId: 'step', maxSteps: 1, typo: true }],
  ['/v1/runs', { mode: 'bounded', actionId: 'step', maxSteps: 1, record: { ringBuffer: 'yes' } }],
  ['/v1/actions/step', { wait: true }],
  ['/v1/runtime/render-trigger', { trigger: 'action-end' }],
  ['/v1/runtime/wait-ready', { timeoutMs: -1 }],
  ['/v1/runtime/connect', { simulatorUrl: 'ws://localhost', encoding: 'invalid' }],
  ['/v1/runtime/connect', { simulatorUrl: 'invalid-url' }],
  ['/v1/runtime/connect', { simulatorUrl: 'https://example.com' }],
])('validates HTTP input before runtime work: %s %j', async (route, body) => {
  const app = buildControlApp({} as AgentRuntime, new RuntimeSseBroker(), () => {});
  const response = await app.request(route as string, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ category: 'input_error' });
});

it('returns partial render artifacts as a failed HTTP operation', async () => {
  const { RenderBatchError } = await import('../painter');
  const app = buildControlApp(
    {
      requestRender: async () => {
        throw new RenderBatchError(
          [{ painterId: 'good', kind: 'chart', data: new Uint8Array([1]) }],
          [
            {
              painterId: 'bad',
              targetId: 'missing',
              code: 'render_missing',
              message: 'Missing target',
            },
          ],
        );
      },
    } as unknown as AgentRuntime,
    new RuntimeSseBroker(),
    () => {},
  );
  const response = await app.request('/v1/scene/render', { method: 'POST', body: '{}' });
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({
    category: 'render_failed',
    partial: true,
    artifacts: [{ data: 'AQ==', dataEncoding: 'base64' }],
    errors: [{ targetId: 'missing' }],
  });
});

it.each([
  { layerCodecs: { agent: 'typo' } },
  { layerCodecs: { agent: { codec: 'delta' } } },
  { modelIdentity: {} },
  { modelIdentity: { model_id: 'test', extra: true } },
  { checkpoint: { model_id: 'test', encoding: 'opaque', data: { bytes: [1] } } },
  { checkpoint: { encoding: 'opaque', data: 'AQ==' } },
  { checkpoint: { model_id: 'test', encoding: 'opaque', data: 'not base64' } },
])('rejects malformed nested recording options before runtime dispatch: %j', async (record) => {
  const startRun = vi.fn().mockReturnValue({ id: 'unexpected' });
  const app = buildControlApp(
    { startRun } as unknown as AgentRuntime,
    new RuntimeSseBroker(),
    () => {},
  );
  const response = await app.request('/v1/runs', {
    method: 'POST',
    body: JSON.stringify({ mode: 'bounded', actionId: 'step', maxSteps: 1, record }),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ category: 'input_error' });
  expect(startRun).not.toHaveBeenCalled();
});

it.each([
  true,
  false,
  {
    layerCodecs: { agent: 'delta', edge: 'keyframe', trajectory: 'adaptive', grid: 'derived' },
    modelIdentity: { model_id: 'test', state_schema_version: '1', instance_id: 'test-instance' },
    checkpoint: { model_id: 'test', state_schema_version: '1', encoding: 'opaque', data: 'AQID' },
  },
])('accepts supported recording options: %j', async (record) => {
  const startRun = vi.fn().mockReturnValue({ id: 'accepted' });
  const app = buildControlApp(
    { startRun } as unknown as AgentRuntime,
    new RuntimeSseBroker(),
    () => {},
  );
  const response = await app.request('/v1/runs', {
    method: 'POST',
    body: JSON.stringify({ mode: 'bounded', actionId: 'step', maxSteps: 1, record }),
  });
  expect(response.status).toBe(202);
  expect(startRun).toHaveBeenCalledExactlyOnceWith(
    {
      mode: 'bounded',
      actionId: 'step',
      maxSteps: 1,
      record: record === true ? {} : record,
    },
    undefined,
  );
});

it('reports recording export filesystem failures as persistence errors', async () => {
  const runtime = {
    exportRecording: vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('No space'), { code: 'ENOSPC' })),
  } as unknown as AgentRuntime;
  const app = buildControlApp(runtime, new RuntimeSseBroker(), () => {});
  const response = await app.request('/v1/recordings/id/export', {
    method: 'POST',
    body: JSON.stringify({ output: '/full/recording.json' }),
  });
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ category: 'persistence_failed' });
});

it.each(['action', 'run'] as const)(
  'includes the %s ID in HTTP wait timeout errors',
  async (kind) => {
    const wait = vi
      .fn()
      .mockRejectedValue(new Error('Timed out waiting; operation was not cancelled.'));
    const app = buildControlApp(
      {
        getAction: () => ({}),
        getRun: () => ({}),
        waitAction: wait,
        waitRun: wait,
      } as unknown as AgentRuntime,
      new RuntimeSseBroker(),
      () => {},
    );
    const response = await app.request(
      `/v1/${kind === 'action' ? 'action-results' : 'runs'}/known%2Fid/wait`,
      { method: 'POST', body: '{}' },
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      category: 'result_unknown',
      [kind === 'action' ? 'requestId' : 'runId']: 'known/id',
    });
  },
);

it.each(['json', 'msgpack'])(
  'passes explicit recording format %s through the run API',
  async (recordingFormat) => {
    const startRun = vi.fn().mockReturnValue({ id: 'accepted' });
    const app = buildControlApp(
      { startRun } as unknown as AgentRuntime,
      new RuntimeSseBroker(),
      () => {},
    );
    const spec = { mode: 'bounded', actionId: 'step', maxSteps: 1, record: {} };
    const response = await app.request('/v1/runs', {
      method: 'POST',
      body: JSON.stringify({ ...spec, recordingFormat }),
    });
    expect(response.status).toBe(202);
    expect(startRun).toHaveBeenCalledExactlyOnceWith(spec, recordingFormat);
  },
);
it.each([
  { record: false, recordingFormat: 'msgpack' },
  { record: true, recordingFormat: 'gzip' },
])('rejects incompatible recording format options %j', async (options) => {
  const startRun = vi.fn();
  const app = buildControlApp(
    { startRun } as unknown as AgentRuntime,
    new RuntimeSseBroker(),
    () => {},
  );
  const response = await app.request('/v1/runs', {
    method: 'POST',
    body: JSON.stringify({ mode: 'bounded', actionId: 'step', maxSteps: 1, ...options }),
  });
  expect(response.status).toBe(400);
  expect(startRun).not.toHaveBeenCalled();
});

it('allows coordinate-preserving rendering and local presentation through the HTTP API', async () => {
  const requestRender = vi.fn().mockResolvedValue([]);
  const setPresentation = vi.fn().mockResolvedValue({ envId: 'world', overrides: {} });
  const app = buildControlApp(
    { requestRender, setPresentation } as unknown as AgentRuntime,
    new RuntimeSseBroker(),
    () => {},
  );
  const rendered = await app.request('/v1/scene/render', {
    method: 'POST',
    body: JSON.stringify({
      envId: 'world',
      layoutTicks: 0,
      layerOverrides: { edges: { link_distance: -1 } },
    }),
  });
  expect(rendered.status).toBe(200);
  expect(requestRender.mock.calls[0][0]).toMatchObject({
    layoutTicks: 0,
    layerOverrides: { edges: { link_distance: -1 } },
  });
  const configured = await app.request('/v1/scene/presentation/world', {
    method: 'PUT',
    body: JSON.stringify({ overrides: {} }),
  });
  expect(configured.status).toBe(200);
  expect(setPresentation).toHaveBeenCalledWith('world', {});
});
