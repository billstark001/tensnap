import { EventEmitter, once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { closeWebSocket, waitForWebSocketOpen, type NodeWebSocket } from './node';

class Socket extends EventEmitter implements NodeWebSocket {
  readyState = 0;
  close = vi.fn(() => {
    this.readyState = 3;
    this.emit('close');
  });
  terminate = vi.fn(() => {
    this.readyState = 3;
    this.emit('close');
  });
}

afterEach(() => vi.restoreAllMocks());
describe('Node WebSocket lifecycle', () => {
  it('cleans listeners after opening or failing before opening', async () => {
    for (const event of ['open', 'close', 'error'] as const) {
      const socket = new Socket();
      const pending = waitForWebSocketOpen(socket);
      const outcome =
        event === 'open'
          ? expect(pending).resolves.toBeUndefined()
          : expect(pending).rejects.toThrow();
      socket.emit(event, new Error('fixture'));
      await outcome;
      for (const type of ['open', 'close', 'error']) expect(socket.listenerCount(type)).toBe(0);
    }
  });
  it('handles already-open, already-closed and already-aborted sockets', async () => {
    const socket = new Socket();
    socket.readyState = 1;
    await waitForWebSocketOpen(socket);
    socket.readyState = 3;
    await expect(waitForWebSocketOpen(socket)).rejects.toThrow(/closed before opening/);
    const controller = new AbortController();
    controller.abort();
    await expect(waitForWebSocketOpen(socket, { signal: controller.signal })).rejects.toThrow(
      /aborted/,
    );
    expect(socket.eventNames()).toEqual([]);
  });
  it('removes abort listeners on success, cancellation and timeout without owning the socket', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const socket = new Socket();
    const pending = waitForWebSocketOpen(socket, { signal: controller.signal });
    const cancelled = expect(pending).rejects.toThrow(/aborted/);
    controller.abort();
    await cancelled;
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(socket.terminate).not.toHaveBeenCalled();
    await expect(waitForWebSocketOpen(socket, { timeoutMs: 1 })).rejects.toThrow(/timed out/);
    expect(socket.eventNames()).toEqual([]);
  });
  it('closes gracefully, terminates connecting sockets, and bounds a stalled close', async () => {
    const open = new Socket();
    open.readyState = 1;
    await closeWebSocket(open, { code: 1000, reason: 'done' });
    expect(open.close).toHaveBeenCalledWith(1000, 'done');
    expect(open.terminate).not.toHaveBeenCalled();
    const connecting = new Socket();
    await closeWebSocket(connecting);
    expect(connecting.terminate).toHaveBeenCalledOnce();
    const stalled = new Socket();
    stalled.readyState = 2;
    await closeWebSocket(stalled, { timeoutMs: 1 });
    expect(stalled.terminate).toHaveBeenCalledOnce();
    for (const socket of [open, connecting, stalled]) expect(socket.eventNames()).toEqual([]);
  });
  it('guards asynchronous termination errors and releases a stalled adapter', async () => {
    const socket = new Socket();
    socket.terminate.mockImplementation(() => {
      process.nextTick(() => {
        socket.emit('error', new Error('cancelled handshake'));
        socket.emit('error', new Error('late cancellation error'));
      });
    });
    await closeWebSocket(socket, { timeoutMs: 0 });
    expect(socket.terminate).toHaveBeenCalledOnce();
    expect(socket.eventNames()).toEqual([]);
  });
  it('releases listeners when graceful close and termination both throw', async () => {
    const socket = new Socket();
    socket.readyState = 1;
    socket.close.mockImplementation(() => {
      throw new Error('close failed');
    });
    socket.terminate.mockImplementation(() => {
      throw new Error('terminate failed');
    });
    await expect(closeWebSocket(socket)).rejects.toThrow('terminate failed');
    expect(socket.eventNames()).toEqual([]);
  });
  it('opens and closes a real socket, and safely cancels a pending handshake', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    const address = server.address();
    if (typeof address === 'string' || !address) throw Error('Expected an IP listener');
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
      await waitForWebSocketOpen(socket);
      await closeWebSocket(socket);
      const pending = new WebSocket(`ws://127.0.0.1:${address.port}`);
      await closeWebSocket(pending);
      expect(pending.readyState).toBe(WebSocket.CLOSED);
    } finally {
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
