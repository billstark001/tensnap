import { describe, expect, it, vi } from 'vitest';
import { RendererSession } from '@tensnap/core/runtime';
import { WebSocketManagerImpl } from './impl';

function browserSockets() {
  const sockets: MockSocket[] = [];
  class MockSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
    close = vi.fn(() => {
      this.readyState = 3;
    });
    constructor() {
      sockets.push(this);
    }
    open() {
      this.readyState = 1;
      this.onopen?.();
    }
  }
  vi.stubGlobal('WebSocket', MockSocket);
  return sockets;
}

describe('WebSocketManagerImpl', () => {
  it('rejects an already aborted attempt without allocating a socket', async () => {
    const sockets = browserSockets();
    const transport = new WebSocketManagerImpl(null, 'ws://localhost:8765');
    const controller = new AbortController();
    controller.abort();
    try {
      await expect(transport.connect(controller.signal)).rejects.toThrow(/aborted/);
      expect(sockets).toHaveLength(0);
    } finally {
      transport.destroy();
      vi.unstubAllGlobals();
    }
  });
  it('releases abort subscriptions and handlers when cancelling a pending handshake', async () => {
    const sockets = browserSockets();
    const transport = new WebSocketManagerImpl(null, 'ws://localhost:8765');
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    try {
      const pending = expect(transport.connect(controller.signal)).rejects.toThrow(/aborted/);
      controller.abort();
      await pending;
      expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(sockets[0].close).toHaveBeenCalledOnce();
      expect(sockets[0].onopen).toBeNull();
      expect(sockets[0].onclose).toBeNull();
      expect(transport.connectionState).toBe('closed');
    } finally {
      transport.destroy();
      vi.unstubAllGlobals();
    }
  });
  it('settles early close and removes its abort subscription', async () => {
    const sockets = browserSockets();
    const transport = new WebSocketManagerImpl(null, 'ws://localhost:8765');
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    try {
      const pending = expect(transport.connect(controller.signal)).rejects.toThrow(
        /closed before opening/,
      );
      sockets[0].onclose?.({ code: 1000, reason: '', wasClean: true });
      await pending;
      expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(transport.connectionState).toBe('closed');
    } finally {
      transport.destroy();
      vi.unstubAllGlobals();
    }
  });
  it('releases a replaced connection and ignores its delayed events', async () => {
    const sockets = browserSockets();
    const transport = new WebSocketManagerImpl(null, 'ws://localhost:8765', false, 'strict');
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    const messages = vi.fn();
    transport.on('message', messages);
    try {
      const first = expect(transport.connect(controller.signal)).rejects.toThrow(/aborted/);
      const oldClose = sockets[0].onclose;
      const oldMessage = sockets[0].onmessage;
      const second = transport.connect();
      sockets[1].open();
      await second;
      await first;
      oldClose?.({ code: 1006, reason: '', wasClean: false });
      oldMessage?.({ data: '{"type":"metadata_update","payload":{"time":1}}' });
      controller.abort();
      expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(sockets[0].close).toHaveBeenCalledOnce();
      expect(sockets[1].close).not.toHaveBeenCalled();
      expect(transport.connectionState).toBe('open');
      expect(transport.reconnectionInfo.isReconnecting).toBe(false);
      expect(messages).not.toHaveBeenCalled();
    } finally {
      transport.destroy();
      vi.unstubAllGlobals();
    }
  });
  it('enforces the family before opening a socket while retaining the original hostname', async () => {
    const transport = new WebSocketManagerImpl(
      null,
      'ws://localhost:8765/path',
      false,
      'auto',
      'ipv6',
    );
    expect(transport.connectionId).toBe('ws://localhost:8765/path');
    const create = vi.fn();
    vi.stubGlobal(
      'WebSocket',
      class {
        static OPEN = 1;
        readyState = 1;
        onopen?: () => void;
        constructor(url: string) {
          create(url);
          queueMicrotask(() => this.onopen?.());
        }
        close() {}
      },
    );
    try {
      await transport.connect();
      expect(create).toHaveBeenLastCalledWith('ws://[::1]:8765/path');
      transport.ip_family = 'ipv4';
      await transport.connect();
      expect(create).toHaveBeenLastCalledWith('ws://127.0.0.1:8765/path');
      for (const [url, family] of [
        ['ws://example.com:8765', 'ipv4'],
        ['ws://127.0.0.1:8765', 'ipv6'],
      ] as const) {
        const invalid = new WebSocketManagerImpl(null, url, false, 'auto', family);
        await expect(invalid.connect()).rejects.toThrow(/browser cannot force|conflicts/);
        invalid.destroy();
      }
      expect(create).toHaveBeenCalledTimes(2);
    } finally {
      transport.destroy();
      vi.unstubAllGlobals();
    }
  });
  it('fails a disconnected send so optimistic parameter state rolls back', () => {
    const transport = new WebSocketManagerImpl(null, 'ws://127.0.0.1:1');
    const session = new RendererSession();
    session.attachTransport(transport);
    session.handleIncoming({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'test', version: '0.3.0' },
        model: { id: 'test-model' },
        instance_id: 'test-instance',
        capabilities: [],
      },
    });
    session.scenario.apply({
      type: 'param_create',
      payload: {
        id: 'speed',
        type: 'number',
        label: 'Speed',
        value: 1,
      },
    });

    expect(() => session.setParameter('speed', 2)).toThrow(/not connected/);
    expect(session.scenario.parameters.get('speed')?.value).toBe(1);
    session.destroy();
  });
});
