import type { EventEmitter } from 'node:events';

/** Structural Node socket surface; no dependency on a particular WebSocket library. */
export interface NodeWebSocket extends Pick<EventEmitter, 'on' | 'once' | 'off'> {
  readonly readyState: number;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

export interface WebSocketOpenOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  label?: string;
}

/** Wait for opening without owning the socket. The caller closes it on failure. */
export function waitForWebSocketOpen(
  socket: NodeWebSocket,
  options: WebSocketOpenOptions = {},
): Promise<void> {
  if (options.signal?.aborted) return Promise.reject(new Error('WebSocket connection aborted.'));
  if (socket.readyState === 1) return Promise.resolve();
  if (socket.readyState !== 0) return Promise.reject(new Error('WebSocket closed before opening.'));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      socket.off('open', opened);
      socket.off('error', failed);
      socket.off('close', closed);
      options.signal?.removeEventListener('abort', aborted);
      if (timer) clearTimeout(timer);
    };
    const opened = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const failed = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const closed = () => failed(new Error('WebSocket closed before opening.'));
    const aborted = () => failed(new Error('WebSocket connection aborted.'));
    socket.once('open', opened);
    socket.once('error', failed);
    socket.once('close', closed);
    options.signal?.addEventListener('abort', aborted, { once: true });
    if (options.signal?.aborted) aborted();
    if (settled) return;
    const timeoutMs = options.timeoutMs ?? 30_000;
    timer = setTimeout(
      () =>
        failed(
          new Error(`${options.label ?? 'WebSocket connection'} timed out after ${timeoutMs} ms.`),
        ),
      timeoutMs,
    );
  });
}

export interface WebSocketCloseOptions {
  timeoutMs?: number;
  code?: number;
  reason?: string;
}

/** Graceful close with a bounded wait; terminate a pending handshake or stalled peer. */
export function closeWebSocket(
  socket: NodeWebSocket,
  options: WebSocketCloseOptions = {},
): Promise<void> {
  if (socket.readyState === 3) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fallback: ReturnType<typeof setImmediate> | undefined;
    let settled = false;
    const finished = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (fallback) clearImmediate(fallback);
      socket.off('close', closed);
      socket.off('error', ignoreError);
      if (error) reject(error);
      else resolve();
    };
    // ws emits an asynchronous error when terminating an in-progress handshake.
    const ignoreError = () => {};
    const closed = () => finished();
    const terminate = () => {
      if (settled) return;
      if (timer) clearTimeout(timer);
      try {
        socket.terminate();
        // Keep the error guard through asynchronous handshake cancellation. A broken
        // adapter that never emits close must still release our listeners and waiter.
        if (!settled) fallback = setImmediate(closed);
      } catch (error) {
        finished(error);
      }
    };
    socket.once('close', closed);
    socket.on('error', ignoreError);
    timer = setTimeout(terminate, options.timeoutMs ?? 5_000);
    try {
      if (socket.readyState === 0) terminate();
      else if (socket.readyState === 1) socket.close(options.code, options.reason);
    } catch {
      terminate();
    }
  });
}
