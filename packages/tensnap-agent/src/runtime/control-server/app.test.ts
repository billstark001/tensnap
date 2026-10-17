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
