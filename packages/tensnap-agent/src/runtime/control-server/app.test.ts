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
