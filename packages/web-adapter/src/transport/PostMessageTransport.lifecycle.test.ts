import { describe, expect, it, vi } from 'vitest';
import type { PostMessageEndpoint } from '@tensnap/js/transport';
import { PostMessageTransport } from './PostMessageTransport';

function setup() {
  let receive: (message: unknown) => void = () => {};
  const endpoint: PostMessageEndpoint = {
    postMessage: vi.fn(),
    addMessageListener: (listener) => {
      receive = listener;
    },
    removeMessageListener: vi.fn(),
  };
  const transport = new PostMessageTransport({ endpoint, connectionId: 'test' });
  const open = () =>
    receive({
      source: '@tensnap/js',
      protocol: 'postmessage/v1',
      kind: 'connected',
      connectionId: 'test',
    });
  return { endpoint, transport, open };
}

describe('postMessage connection lifecycle', () => {
  it('waits for the same handshake on concurrent connect calls', async () => {
    const { endpoint, transport, open } = setup();
    const first = transport.connect();
    let secondOpened = false;
    const second = transport.connect().then(() => {
      secondOpened = true;
    });
    await Promise.resolve();
    expect(secondOpened).toBe(false);
    expect(endpoint.postMessage).toHaveBeenCalledTimes(1);
    open();
    await Promise.all([first, second]);
    expect(transport.isConnected).toBe(true);
    transport.destroy();
  });

  it.each(['disconnect', 'destroy'] as const)(
    'settles pending connections on %s and ignores stale opens',
    async (method) => {
      const { endpoint, transport, open } = setup();
      const pending = expect(transport.connect()).rejects.toThrow('closed before opening');
      transport[method]();
      await pending;
      open();
      expect(transport.isConnected).toBe(false);
      expect(transport.connectionState).toBe(method === 'destroy' ? 'destroyed' : 'closed');
      expect(endpoint.removeMessageListener).toHaveBeenCalled();
    },
  );

  it('cleans up a synchronously failed post and permits a later connection', async () => {
    const { endpoint, transport, open } = setup();
    vi.mocked(endpoint.postMessage).mockImplementationOnce(() => {
      throw new Error('post failed');
    });
    await expect(transport.connect()).rejects.toThrow('post failed');
    expect(transport.connectionState).toBe('closed');
    expect(endpoint.removeMessageListener).toHaveBeenCalledTimes(1);
    const next = transport.connect();
    open();
    await next;
    transport.destroy();
  });

  it('detaches the abort signal after opening', async () => {
    const { transport, open } = setup();
    const controller = new AbortController();
    const pending = transport.connect(controller.signal);
    open();
    await pending;
    controller.abort();
    expect(transport.isConnected).toBe(true);
    transport.destroy();
  });

  it('finishes cleanup even when posting a disconnect throws', async () => {
    const { endpoint, transport, open } = setup();
    const pending = transport.connect();
    open();
    await pending;
    vi.mocked(endpoint.postMessage).mockImplementationOnce(() => {
      throw new Error('post failed');
    });
    expect(() => transport.destroy()).toThrow('post failed');
    expect(transport.connectionState).toBe('destroyed');
    expect(endpoint.removeMessageListener).toHaveBeenCalled();
  });
});
