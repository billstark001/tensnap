import { describe, expect, it, vi } from 'vitest';
import { SimulatorSession } from '../runtime';
import { createLinkedEndpoints } from './endpoints';
import { createPostMessageSimulatorHost } from './PostMessageTransportHost';

describe('postMessage negotiated connection identity', () => {
  it('detaches the session and closes its endpoint when model disconnect cleanup fails', async () => {
    const session = new SimulatorSession({
      simulatorInfo: {
        protocol_version: '0.3',
        binding: { name: 'test', version: '0.3.2' },
        model: { id: 'model' },
        instance_id: 'instance',
        capabilities: [],
      },
      onDisconnect() {
        throw new Error('cleanup failed');
      },
    });
    session.attach(() => {}, 'peer');
    await session.open('peer');
    const close = vi.fn();
    const endpoint = {
      postMessage() {},
      addMessageListener() {},
      removeMessageListener() {},
      close,
    };
    const host = createPostMessageSimulatorHost({ endpoint, session });
    await expect(host.destroy()).rejects.toThrow('cleanup failed');
    expect(session.isConnected).toBe(false);
    expect(session.connectionId).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
    await host.destroy();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('accepts the renderer ID with a default host and rejects stale peers after reconnect', async () => {
    const onActionInvoke = vi.fn();
    const session = new SimulatorSession({
      simulatorInfo: {
        protocol_version: '0.3',
        binding: { name: 'test', version: '0.3.2' },
        model: { id: 'model' },
        instance_id: 'instance',
        capabilities: [],
      },
      onActionInvoke,
    });
    const { renderer, simulator } = createLinkedEndpoints();
    const host = createPostMessageSimulatorHost({ endpoint: simulator, session });
    const base = { source: '@tensnap/js', protocol: 'postmessage/v1' } as const;
    const connect = async (connectionId: string) => {
      renderer.postMessage({ ...base, kind: 'connect', connectionId });
      await vi.waitFor(() => expect(session.connectionId).toBe(connectionId));
    };
    const invoke = (connectionId: string) =>
      renderer.postMessage({
        ...base,
        kind: 'renderer-message',
        connectionId,
        message: { type: 'action_invoke', payload: { id: 'step', request_id: connectionId } },
      });
    try {
      await connect('renderer-1');
      invoke('renderer-1');
      await vi.waitFor(() => expect(onActionInvoke).toHaveBeenCalledTimes(1));
      await connect('renderer-2');
      invoke('renderer-1');
      invoke('renderer-2');
      await vi.waitFor(() => expect(onActionInvoke).toHaveBeenCalledTimes(2));
      expect(onActionInvoke.mock.calls[1]![0]).toMatchObject({ request_id: 'renderer-2' });
    } finally {
      await host.destroy();
    }
  });

  it('addresses handler errors to the negotiated renderer rather than the host fallback ID', async () => {
    const session = new SimulatorSession({
      simulatorInfo: {
        protocol_version: '0.3',
        binding: { name: 'test', version: '0.3.2' },
        model: { id: 'model' },
        instance_id: 'instance',
        capabilities: [],
      },
      onActionInvoke() {
        throw new Error('action failed');
      },
    });
    const { renderer, simulator } = createLinkedEndpoints();
    const received = vi.fn();
    renderer.addMessageListener(received);
    const host = createPostMessageSimulatorHost({ endpoint: simulator, session });
    const base = {
      source: '@tensnap/js',
      protocol: 'postmessage/v1',
      connectionId: 'renderer',
    } as const;
    try {
      renderer.postMessage({ ...base, kind: 'connect' });
      await vi.waitFor(() => expect(session.isConnected).toBe(true));
      renderer.postMessage({
        ...base,
        kind: 'renderer-message',
        message: {
          type: 'action_invoke',
          payload: { id: 'step', request_id: 'request' },
        },
      });
      await vi.waitFor(() =>
        expect(received).toHaveBeenCalledWith({
          ...base,
          kind: 'error',
          error: { message: 'action failed' },
        }),
      );
    } finally {
      await host.destroy();
    }
  });
});
