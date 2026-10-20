import { afterEach, expect, it, vi } from 'vitest';
import { installTimeoutProbes } from './browser-probe';

const originalTimer = window.setTimeout;
const OriginalSocket = window.WebSocket;
afterEach(() => {
  window.setTimeout = originalTimer;
  window.WebSocket = OriginalSocket;
  delete window.__TENSNAP_TIMEOUT_TRACE__;
  vi.unstubAllGlobals();
});

function install() {
  const callbacks: (() => void)[] = [];
  window.setTimeout = ((_callback: TimerHandler, _delay?: number, ...args: unknown[]) => {
    callbacks.push(() => typeof _callback === 'function' && Reflect.apply(_callback, window, args));
    return callbacks.length;
  }) as typeof window.setTimeout;
  class Socket {
    private handler: ((event: MessageEvent) => void) | null = null;
    get onmessage() {
      return this.handler;
    }
    set onmessage(handler: ((event: MessageEvent) => void) | null) {
      this.handler = handler;
    }
    receive(data: string | ArrayBuffer | Blob) {
      this.handler?.call(this, new MessageEvent('message', { data }));
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal(
    'PerformanceObserver',
    class {
      observe() {}
    },
  );
  installTimeoutProbes();
  return { callbacks, socket: new Socket() };
}

it('preserves timer callback receiver, arguments and return handle', () => {
  const { callbacks } = install();
  const observed: { receiver?: unknown; values?: unknown[] } = {};
  const handle = window.setTimeout(
    function (this: unknown, ...args: unknown[]) {
      Object.assign(observed, { receiver: this, values: args });
    },
    1,
    'argument',
  );
  callbacks[0]!();
  expect(handle).toBe(1);
  expect(observed.receiver).toBe(window);
  expect(observed.values).toEqual(['argument']);
  expect(window.__TENSNAP_TIMEOUT_TRACE__!.timers[0]!.completedMs).toBeDefined();
});

it('preserves binary and text delivery without decoding or copying binary payloads', () => {
  const { socket } = install();
  const received = vi.fn();
  socket.onmessage = received;
  const binary = new Uint8Array([1, 2, 3]).buffer;
  socket.receive(binary);
  const text = '{"type":"metadata_update","payload":{"label":"日本語"}}';
  socket.receive(text);
  expect(received.mock.contexts).toEqual([socket, socket]);
  expect(received.mock.calls[0]![0].data).toBe(binary);
  expect(received.mock.calls[1]![0].data).toBe(text);
  expect(socket.onmessage).toBe(received);
  expect(window.__TENSNAP_TIMEOUT_TRACE__!.messages).toEqual([
    expect.objectContaining({ size: 3, sizeUnit: 'bytes' }),
    expect.objectContaining({ size: text.length, sizeUnit: 'utf16-code-units' }),
  ]);
});

it('leaves malformed action results to the transport handler', () => {
  const { socket } = install();
  const received = vi.fn();
  socket.onmessage = received;
  const malformed = '{"type":"action_result",';
  expect(() => socket.receive(malformed)).not.toThrow();
  expect(received.mock.calls[0]![0].data).toBe(malformed);
});
