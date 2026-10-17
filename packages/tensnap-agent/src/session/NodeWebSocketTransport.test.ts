import { normalizeWebSocketData } from '@tensnap/network/node';
import WebSocket, { WebSocketServer } from 'ws';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { listenIPServers, closeIPServers } from '@tensnap/network/node';
import { describe, expect, it, vi } from 'vitest';
import {
  encodeProtocolMessage,
  decodeProtocolMessage,
  ProtocolCodec,
  type AnyProtocolMessage,
  type ProtocolValidationLevel,
} from '@tensnap/protocol';
import { NodeWebSocketTransport } from './NodeWebSocketTransport';

describe('NodeWebSocketTransport', () => {
  it('ignores old socket events after reconnecting during shutdown', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const transport = new NodeWebSocketTransport(`ws://127.0.0.1:${address.port}`, 'json');
    const message = vi.fn();
    transport.on('message', message);
    let old: WebSocket | undefined;
    try {
      await transport.connect();
      old = (transport as unknown as { socket: WebSocket }).socket;
      vi.spyOn(old, 'close').mockImplementation(() => {});
      transport.disconnect();
      await transport.connect();
      old.emit('message', Buffer.from('{"type":"metadata_update","payload":{"time":1}}'), false);
      old.emit('close');
      expect(transport.connectionState).toBe('open');
      expect(message).not.toHaveBeenCalled();
      transport.send({ type: 'param_change', payload: { id: 'speed', value: 1 } });
    } finally {
      old?.terminate();
      transport.destroy();
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('cleans a cancelled handshake and allows a fresh connection attempt', async () => {
    const transport = new NodeWebSocketTransport('ws://127.0.0.1:1');
    const controller = new AbortController();
    controller.abort();
    await expect(transport.connect(controller.signal)).rejects.toThrow(/aborted/);
    expect(transport.connectionState).toBe('closed');
    transport.destroy();
  });
  it('restores the closed state if socket construction rejects the URL', async () => {
    const transport = new NodeWebSocketTransport('ftp://127.0.0.1');
    await expect(transport.connect()).rejects.toThrow();
    expect(transport.connectionState).toBe('closed');
    transport.destroy();
  });

  for (const family of ['ipv4', 'ipv6'] as const)
    it(`forces ${family} for a localhost hostname`, async () => {
      const listeners = await listenIPServers(createServer, { host: 'localhost', port: 0 });
      const ws = new WebSocketServer({ noServer: true });
      const connected: string[] = [];
      for (const listener of listeners)
        listener.on('upgrade', (request, socket, head) => {
          connected.push((listener.address() as AddressInfo).family);
          ws.handleUpgrade(request, socket, head, (client) =>
            ws.emit('connection', client, request),
          );
        });
      const port = (listeners[0].address() as AddressInfo).port;
      const transport = new NodeWebSocketTransport(`ws://localhost:${port}`, 'json', {
        ip_family: family,
      });
      try {
        if (
          !listeners.some(
            (listener) =>
              (listener.address() as AddressInfo).family === (family === 'ipv4' ? 'IPv4' : 'IPv6'),
          )
        ) {
          await expect(transport.connect()).rejects.toThrow();
        } else {
          await transport.connect();
          expect(connected).toEqual([family === 'ipv4' ? 'IPv4' : 'IPv6']);
        }
      } finally {
        transport.destroy();
        for (const client of ws.clients) client.terminate();
        await new Promise<void>((resolve) => ws.close(() => resolve()));
        await closeIPServers(listeners);
      }
    });

  it('rejects conflicting literals before opening a socket', async () => {
    const transport = new NodeWebSocketTransport('ws://127.0.0.1:1', 'json', { ip_family: 'ipv6' });
    await expect(transport.connect()).rejects.toThrow(/conflicts/);
    expect(transport.connectionState).toBe('closed');
  });

  it.each(['json', 'msgpack'] as const)(
    'preserves current validation policy across successive %s frames',
    (encoding) => {
      const policy: {
        serverMessages: ProtocolValidationLevel;
        clientMessages: ProtocolValidationLevel;
      } = { serverMessages: 'off', clientMessages: 'off' };
      const transport = new NodeWebSocketTransport('ws://test', encoding, policy);
      const error = vi.fn();
      const message = vi.fn();
      const send = vi.fn();
      const codec = new ProtocolCodec();
      transport.on('error', error);
      transport.on('message', message);
      // Supply an open socket without introducing network timing into this test.
      Object.assign(transport, { socket: { send }, state: 'open' });
      const receive = (frame: string | Uint8Array) =>
        (transport as unknown as { handleMessage(data: string | Uint8Array): void }).handleMessage(
          frame,
        );
      const valid: AnyProtocolMessage = { type: 'metadata_update', payload: { time: 7 } };
      const invalid = {
        type: 'metadata_update',
        payload: { time: 'invalid' },
      } as unknown as AnyProtocolMessage;
      receive(codec.encode(invalid, encoding));
      expect(message).toHaveBeenCalledTimes(1);
      policy.serverMessages = 'error';
      receive(codec.encode(invalid, encoding));
      receive(codec.encode(valid, encoding));
      expect(error).toHaveBeenCalledTimes(1);
      expect(message).toHaveBeenCalledTimes(2);
      expect(message).toHaveBeenLastCalledWith(valid);

      for (const request_id of ['first', 'second']) {
        transport.send({ type: 'action_invoke', payload: { id: 'step', request_id } });
      }
      policy.clientMessages = 'error';
      expect(() =>
        transport.send({ type: 'action_invoke', payload: { id: 'step', request_id: '' } }),
      ).toThrow(/validation/i);
      for (const [index, request_id] of ['first', 'second'].entries()) {
        expect(codec.decode(send.mock.calls[index]![0])).toEqual({
          type: 'action_invoke',
          payload: { id: 'step', request_id },
        });
      }
      expect(send).toHaveBeenCalledTimes(2);
    },
  );

  it('normalizes JSON text frames delivered as buffers into strings', () => {
    const payload: AnyProtocolMessage = {
      type: 'metadata_update',
      payload: { time: 7 },
    };

    const normalized = normalizeWebSocketData(Buffer.from(JSON.stringify(payload), 'utf8'), false);

    expect(typeof normalized).toBe('string');
    expect(decodeProtocolMessage(normalized)).toEqual(payload);
  });

  it('keeps binary msgpack frames as bytes', () => {
    const payload: AnyProtocolMessage = {
      type: 'metadata_update',
      payload: { time: 9 },
    };
    const encoded = encodeProtocolMessage(payload, 'msgpack') as Uint8Array;

    const normalized = normalizeWebSocketData(Buffer.from(encoded), true);

    expect(normalized).toBeInstanceOf(Uint8Array);
    expect(decodeProtocolMessage(normalized)).toEqual(payload);
  });

  it('emits one warning and continues for invalid inbound messages in warning mode', () => {
    const transport = new NodeWebSocketTransport('ws://test', 'json', {
      serverMessages: 'warning',
    });
    const warning = vi.fn();
    const message = vi.fn();
    transport.on('validation-warning', warning);
    transport.on('message', message);

    (transport as unknown as { handleMessage(data: string): void }).handleMessage(
      JSON.stringify({
        type: 'metadata_update',
        payload: { time: 'invalid' },
      }),
    );

    expect(warning).toHaveBeenCalledTimes(1);
    expect(message).toHaveBeenCalledTimes(1);
  });

  it('emits an error and rejects invalid inbound messages in error mode', () => {
    const transport = new NodeWebSocketTransport('ws://test', 'json', { serverMessages: 'error' });
    const error = vi.fn();
    const message = vi.fn();
    transport.on('error', error);
    transport.on('message', message);

    (transport as unknown as { handleMessage(data: string): void }).handleMessage(
      JSON.stringify({
        type: 'metadata_update',
        payload: { time: 'invalid' },
      }),
    );

    expect(error).toHaveBeenCalledTimes(1);
    expect(message).not.toHaveBeenCalled();
  });
});
