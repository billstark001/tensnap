import { describe, expect, it, vi } from 'vitest';
import type { SimulatorToRendererMessage } from '@tensnap/protocol';
import { InMemoryTransport } from './InMemoryTransport';

describe('in-memory connection lifecycle', () => {
  it.each(['open', 'message'] as const)(
    'isolates exceptions in %s listeners during connect',
    async (event) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const transport = new InMemoryTransport({
        onConnect(send) {
          send({ type: 'metadata_update', payload: { time: 0 } });
        },
        onMessage() {},
        onDisconnect() {},
      });
      transport.on(event, () => {
        throw new Error('listener failed');
      });
      try {
        await expect(transport.connect()).resolves.toBeUndefined();
        expect(transport.isConnected).toBe(true);
        expect(log).toHaveBeenCalledTimes(1);
      } finally {
        transport.destroy();
        log.mockRestore();
      }
    },
  );

  it('does not run lifecycle callbacks when closed before initialization starts', async () => {
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    const transport = new InMemoryTransport({ onConnect, onDisconnect, onMessage() {} });
    const pending = expect(transport.connect()).rejects.toThrow('closed');
    transport.disconnect();
    await pending;
    expect(onConnect).not.toHaveBeenCalled();
    expect(onDisconnect).not.toHaveBeenCalled();
    transport.destroy();
  });

  it('reports asynchronous action failures through the error channel', async () => {
    const failure = new Error('action failed');
    const transport = new InMemoryTransport({
      onConnect() {},
      onMessage: async () => {
        throw failure;
      },
      onDisconnect() {},
    });
    const onError = vi.fn();
    transport.on('error', onError);
    await transport.connect();
    transport.send({ type: 'action_invoke', payload: { id: 'step', request_id: 'failed' } });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledExactlyOnceWith(failure));
    transport.destroy();
  });

  it.each(['disconnect', 'destroy', 'abort'] as const)(
    'settles a pending handshake on %s without reopening',
    async (method) => {
      let finish = () => {};
      const onConnect = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const onDisconnect = vi.fn();
      const transport = new InMemoryTransport({ onConnect, onMessage() {}, onDisconnect });
      const controller = new AbortController();
      const pending = expect(transport.connect(controller.signal)).rejects.toThrow(
        /closed|aborted/,
      );
      await Promise.resolve();
      if (method === 'abort') controller.abort();
      else transport[method]();
      await pending;
      finish();
      await Promise.resolve();
      await Promise.resolve();
      expect(transport.isConnected).toBe(false);
      expect(transport.connectionState).toBe(method === 'destroy' ? 'destroyed' : 'closed');
      expect(onDisconnect).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects failed initialization and allows retry', async () => {
    const onConnect = vi
      .fn()
      .mockRejectedValueOnce(new Error('initialization failed'))
      .mockResolvedValue(undefined);
    const transport = new InMemoryTransport({ onConnect, onMessage() {}, onDisconnect() {} });
    await expect(transport.connect()).rejects.toThrow('initialization failed');
    expect(transport.connectionState).toBe('closed');
    await transport.connect();
    expect(transport.isConnected).toBe(true);
    transport.destroy();
  });

  it('waits for initialization on concurrent calls and rejects callbacks from an older connection', async () => {
    let finish = () => {};
    const senders: Array<(message: SimulatorToRendererMessage) => void> = [];
    const onConnect = vi.fn((send) => {
      senders.push(send);
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const transport = new InMemoryTransport({ onConnect, onMessage() {}, onDisconnect() {} });
    const messages = vi.fn();
    transport.on('message', messages);
    const first = transport.connect();
    let secondOpened = false;
    const second = transport.connect().then(() => {
      secondOpened = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(secondOpened).toBe(false);
    expect(onConnect).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second]);
    transport.disconnect();
    const next = transport.connect();
    await Promise.resolve();
    finish();
    await next;
    senders[0]!({ type: 'metadata_update', payload: { time: 99 } });
    senders[1]!({ type: 'metadata_update', payload: { time: 1 } });
    expect(messages).toHaveBeenCalledExactlyOnceWith({
      type: 'metadata_update',
      payload: { time: 1 },
    });
    transport.destroy();
  });
});
