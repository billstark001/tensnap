import { expect, test } from 'vitest';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { listenerUrl, type IPFamily } from './index';
import {
  normalizeWebSocketData,
  webSocketByteLength,
  listenIPServers,
  closeIPServers,
  waitForWebSocketOpen,
  closeWebSocket,
  unavailableIPFamily,
} from './node';

// Capture exports outside timed callbacks to avoid Vitest's module-getter overhead.
const normalize = normalizeWebSocketData;
const countBytes = webSocketByteLength;
const batch = 64;

for (const size of [1024, 65536]) {
  // Exact byte sizes, with distinct inputs so binary cases do not time a constant return.
  const buffers = Array.from({ length: 16 }, (_, index) =>
    Buffer.from('模拟器'.repeat(Math.floor(size / 9)) + String(index % 10).repeat(size % 9)),
  );
  for (const [kind, binary, inputs] of [
    ['text Buffer', false, buffers],
    ['binary Buffer', true, buffers],
    ['text fragments', false, buffers.map((bytes) => [bytes.subarray(0, 4), bytes.subarray(4)])],
    ['binary fragments', true, buffers.map((bytes) => [bytes.subarray(0, 4), bytes.subarray(4)])],
    [
      'text subview',
      false,
      buffers.map((bytes) => new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)),
    ],
  ] as const) {
    test(`${kind}, ${size} bytes, ${batch} frames/batch`, async ({ bench }) => {
      let retained: ReturnType<typeof normalize> | undefined;
      let index = 0;
      await bench('normalize', () => {
        for (let frame = 0; frame < batch; frame++)
          retained = normalize(inputs[index++ & 15], binary);
      }).run({ time: 200 });
      const expected = buffers[(index - 1) & 15];
      expect(binary ? retained : String(retained)).toEqual(
        binary ? expected : expected.toString('utf8'),
      );
      let total = 0;
      await bench('byte length', () => {
        for (let frame = 0; frame < batch; frame++) total += countBytes(inputs[index++ & 15]);
      }).run({ time: 200 });
      expect(total).toBeGreaterThan(0);
    });
  }
}

// Raw network fixture: no simulator model, protocol codec or renderer dependency.
async function fixture(ip_family: IPFamily) {
  const websocket = new WebSocketServer({ noServer: true });
  let listeners: Server[];
  try {
    listeners = await listenIPServers(
      () => {
        const server = createServer();
        server.on('upgrade', (request, socket, head) =>
          websocket.handleUpgrade(request, socket, head, (client) =>
            websocket.emit('connection', client, request),
          ),
        );
        return server;
      },
      { host: 'localhost', port: 0, ip_family },
    );
  } catch (error) {
    await new Promise<void>((resolve) => websocket.close(() => resolve()));
    throw error;
  }
  websocket.on('connection', (socket) =>
    socket.on('message', (data, binary) => socket.send(data, { binary })),
  );
  return {
    url: listenerUrl(listeners[0].address() as AddressInfo),
    async close() {
      await Promise.all([...websocket.clients].map((socket) => closeWebSocket(socket)));
      await new Promise<void>((resolve) => websocket.close(() => resolve()));
      await closeIPServers(listeners);
    },
  };
}

for (const family of ['ipv4', 'ipv6', 'auto'] as const) {
  test(`listener lifecycle, ${family}`, async (context) => {
    try {
      const probe = await fixture(family);
      await probe.close();
    } catch (error) {
      if (family === 'ipv6' && unavailableIPFamily(error)) {
        context.skip();
        return;
      }
      throw error;
    }
    await context
      .bench('listen + close', async () => {
        const host = await fixture(family);
        await host.close();
      })
      .run({ time: 200 });
  });
  test(`WebSocket echo RTT, ${family}, 1024 bytes`, async (context) => {
    let host: Awaited<ReturnType<typeof fixture>>;
    try {
      host = await fixture(family);
    } catch (error) {
      if (family === 'ipv6' && unavailableIPFamily(error)) {
        context.skip();
        return;
      }
      throw error;
    }
    const socket = new WebSocket(host.url);
    try {
      await waitForWebSocketOpen(socket);
      const payload = Buffer.alloc(1024, 1);
      const echo = () =>
        new Promise<void>((resolve, reject) => {
          socket.once('message', () => resolve());
          socket.send(payload, (error) => {
            if (error) reject(error);
          });
        });
      await context.bench('one send/echo', echo).run({ time: 200 });
    } finally {
      await closeWebSocket(socket);
      await host.close();
    }
  });
}
