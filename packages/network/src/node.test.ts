import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, createConnection, type Server, type AddressInfo } from 'node:net';
import { once } from 'node:events';
import {
  closeIPServers,
  listenIPServers,
  unavailableIPFamily,
  normalizeWebSocketData,
  webSocketByteLength,
} from './node';

describe('IP-family listeners', () => {
  const active: Server[] = [];
  afterEach(async () => closeIPServers(active.splice(0)));
  const start = async (family: 'auto' | 'ipv4' | 'ipv6', port = 0) => {
    const listeners = await listenIPServers(
      () => createServer((socket) => socket.end('same service')),
      { host: 'localhost', port, ip_family: family },
    );
    active.push(...listeners);
    return listeners;
  };
  for (const family of ['ipv4', 'ipv6'] as const)
    it(`only opens ${family} listeners`, async (context) => {
      let listeners: Server[];
      try {
        listeners = await start(family);
      } catch (error) {
        if (family === 'ipv6' && unavailableIPFamily(error)) {
          context.skip();
          return;
        }
        throw error;
      }
      expect(listeners.map((server) => (server.address() as AddressInfo).family)).toEqual([
        family === 'ipv4' ? 'IPv4' : 'IPv6',
      ]);
    });
  it('uses one port for all auto listeners and accepts both address families', async () => {
    const listeners = await start('auto');
    expect(new Set(listeners.map((server) => (server.address() as AddressInfo).port)).size).toBe(1);
    for (const server of listeners) {
      const address = server.address() as AddressInfo;
      const socket = createConnection({ host: address.address, port: address.port });
      const data = once(socket, 'data');
      await expect(data).resolves.toEqual([Buffer.from('same service')]);
      await once(socket, 'close');
    }
  });
  it('does not hide a conflict in the second family and rolls back the first', async (context) => {
    let blocker: Server[];
    try {
      blocker = await start('ipv6');
    } catch (error) {
      if (unavailableIPFamily(error)) {
        context.skip();
        return;
      }
      throw error;
    }
    const port = (blocker[0].address() as AddressInfo).port;
    await expect(start('auto', port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    const replacement = await start('ipv4', port);
    expect((replacement[0].address() as AddressInfo).port).toBe(port);
  });

  for (const unavailableIndex of [0, 1])
    it(`auto tolerates unavailable local family ${unavailableIndex} and keeps the other listener`, async (context) => {
      if (unavailableIndex === 0) {
        try {
          await closeIPServers(
            await listenIPServers(createServer, { host: 'localhost', port: 0, ip_family: 'ipv6' }),
          );
        } catch (error) {
          if (unavailableIPFamily(error)) {
            context.skip();
            return;
          }
          throw error;
        }
      }
      let created = 0;
      const listeners = await listenIPServers(
        () => {
          const server = createServer();
          if (created++ === unavailableIndex)
            vi.spyOn(server, 'listen').mockImplementation(() => {
              queueMicrotask(() =>
                server.emit(
                  'error',
                  Object.assign(new Error('unavailable'), { code: 'EAFNOSUPPORT' }),
                ),
              );
              return server;
            });
          return server;
        },
        { host: 'localhost', port: 0 },
      );
      active.push(...listeners);
      expect(listeners).toHaveLength(1);
      expect((listeners[0].address() as AddressInfo).family).toBe(
        unavailableIndex === 0 ? 'IPv6' : 'IPv4',
      );
    });
  it('does not downgrade forced policies when a family is unavailable', async () => {
    const create = () => {
      const server = createServer();
      vi.spyOn(server, 'listen').mockImplementation(() => {
        queueMicrotask(() =>
          server.emit('error', Object.assign(new Error('unavailable'), { code: 'EAFNOSUPPORT' })),
        );
        return server;
      });
      return server;
    };
    await expect(
      listenIPServers(create, { host: 'localhost', port: 0, ip_family: 'ipv6' }),
    ).rejects.toMatchObject({ code: 'EAFNOSUPPORT' });
  });
  it('keeps a forced IPv6 wildcard socket from accepting IPv4 connections', async (context) => {
    let listeners: Server[];
    try {
      listeners = await listenIPServers(createServer, { port: 0, ip_family: 'ipv6' });
    } catch (error) {
      if (unavailableIPFamily(error)) {
        context.skip();
        return;
      }
      throw error;
    }
    active.push(...listeners);
    const address = listeners[0].address() as AddressInfo;
    expect(address.address).toBe('::');
    const socket = createConnection({ host: '127.0.0.1', port: address.port });
    try {
      await expect(once(socket, 'connect')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    } finally {
      socket.destroy();
    }
  });
  it('removes startup listeners after a synchronous listen failure', async () => {
    const server = createServer();
    vi.spyOn(server, 'listen').mockImplementation(() => {
      throw new Error('sync failure');
    });
    await expect(listenIPServers(() => server, { port: 0, ip_family: 'ipv4' })).rejects.toThrow(
      'sync failure',
    );
    expect(server.listenerCount('error')).toBe(0);
    expect(server.listenerCount('listening')).toBe(0);
  });
  it('rolls back listeners when a later server factory throws', async (context) => {
    const created: Server[] = [];
    try {
      await expect(
        listenIPServers(
          () => {
            if (created.length) throw new Error('factory failed');
            const server = createServer();
            created.push(server);
            return server;
          },
          { host: 'localhost', port: 0 },
        ),
      ).rejects.toThrow('factory failed');
      expect(created[0].listening).toBe(false);
    } catch (error) {
      if (unavailableIPFamily(error)) {
        context.skip();
        return;
      }
      throw error;
    } finally {
      await closeIPServers(created);
    }
  });
  it('waits for every listener cleanup even if one close fails', async () => {
    const failure = new Error('close failed');
    const first = createServer();
    const second = createServer();
    Object.defineProperty(first, 'listening', { value: true });
    Object.defineProperty(second, 'listening', { value: true });
    vi.spyOn(first, 'close').mockImplementation((callback) => {
      callback?.(failure);
      return first;
    });
    let complete!: () => void;
    vi.spyOn(second, 'close').mockImplementation((callback) => {
      complete = () => callback?.();
      return second;
    });
    let settled = false;
    const closing = closeIPServers([first, second]);
    const assertion = expect(closing).rejects.toBe(failure);
    void closing.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    complete();
    await assertion;
  });
  it('rejects explicit address conflicts', async () => {
    await expect(
      listenIPServers(createServer, { host: '127.0.0.1', port: 0, ip_family: 'ipv6' }),
    ).rejects.toThrow(/conflicts/);
  });
  it('counts UTF-8, views and fragments without concatenating or modifying inputs', () => {
    const bytes = Buffer.from('x模拟器y');
    const view = bytes.subarray(1, bytes.length - 1);
    const concat = vi.spyOn(Buffer, 'concat');
    expect(webSocketByteLength('模拟器')).toBe(9);
    expect(webSocketByteLength(view)).toBe(9);
    expect(webSocketByteLength([view.subarray(0, 2), view.subarray(2)])).toBe(9);
    expect(webSocketByteLength(new ArrayBuffer(5))).toBe(5);
    expect(webSocketByteLength([])).toBe(0);
    expect(concat).not.toHaveBeenCalled();
    concat.mockRestore();
  });
  it('normalizes fragmented UTF-8 text without copying binary views', () => {
    const bytes = Buffer.from('模拟器');
    expect(normalizeWebSocketData([bytes.subarray(0, 2), bytes.subarray(2)], false)).toBe('模拟器');
    expect(normalizeWebSocketData(bytes, true)).toBe(bytes);
    const backing = new Uint8Array([0, 1, 2, 3]);
    const view = backing.subarray(1, 3);
    expect(normalizeWebSocketData(view, true)).toBe(view);
    expect(
      normalizeWebSocketData(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        false,
      ),
    ).toBe('模拟器');
  });
});
