/** Diagnostic-only probes installed before the production benchmark bundle. */
export interface TimeoutBrowserTrace {
  timers: { scheduledMs: number; delayMs?: number; firedMs?: number; completedMs?: number }[];
  messages: {
    receivedMs: number;
    appliedMs?: number;
    size: number;
    sizeUnit: 'utf16-code-units' | 'bytes';
    type?: string;
    requestId?: string;
  }[];
  visibility: { ms: number; state: DocumentVisibilityState }[];
  longTasks: { startMs: number; durationMs: number }[];
}

declare global {
  interface Window {
    __TENSNAP_TIMEOUT_TRACE__?: TimeoutBrowserTrace;
  }
}

// Keep this function self-contained: Playwright serializes it into the page.
export function installTimeoutProbes(): void {
  const trace: TimeoutBrowserTrace = { timers: [], messages: [], visibility: [], longTasks: [] };
  window.__TENSNAP_TIMEOUT_TRACE__ = trace;
  const timer = window.setTimeout.bind(window);
  window.setTimeout = function (handler: TimerHandler, delay?: number, ...args: unknown[]): number {
    if (typeof handler !== 'function' || (delay ?? 0) > 10) return timer(handler, delay, ...args);
    const row: TimeoutBrowserTrace['timers'][number] = {
      scheduledMs: performance.now(),
      delayMs: delay,
    };
    trace.timers.push(row);
    return timer(
      (...values: unknown[]) => {
        row.firedMs = performance.now();
        try {
          return Reflect.apply(handler, window, values);
        } finally {
          row.completedMs = performance.now();
        }
      },
      delay,
      ...args,
    );
  } as typeof window.setTimeout;
  const descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
  if (!descriptor?.set) throw new Error('Cannot instrument WebSocket.onmessage.');
  const handlers = new WeakMap<WebSocket, ((event: MessageEvent) => unknown) | null>();
  Object.defineProperty(WebSocket.prototype, 'onmessage', {
    configurable: true,
    get(this: WebSocket) {
      return handlers.get(this) ?? null;
    },
    set(this: WebSocket, handler: ((event: MessageEvent) => unknown) | null) {
      handlers.set(this, handler);
      descriptor.set!.call(
        this,
        handler
          ? function (this: WebSocket, event: MessageEvent<string | ArrayBuffer | Blob>) {
              const text = typeof event.data === 'string' ? event.data : undefined;
              const row: TimeoutBrowserTrace['messages'][number] = {
                receivedMs: performance.now(),
                size:
                  text !== undefined
                    ? text.length
                    : event.data instanceof Blob
                      ? event.data.size
                      : (event.data as ArrayBuffer).byteLength,
                sizeUnit: text !== undefined ? 'utf16-code-units' : 'bytes',
                type: text?.slice(0, 80).match(/"type"\s*:\s*"([^"]+)/)?.[1],
              };
              if (row.type === 'action_result') {
                try {
                  row.requestId = JSON.parse(text!).payload?.request_id;
                } catch {
                  // Let the transport handle malformed input as it normally would.
                }
              }
              trace.messages.push(row);
              try {
                return handler.call(this, event);
              } finally {
                row.appliedMs = performance.now();
              }
            }
          : null,
      );
    },
  });
  document.addEventListener('visibilitychange', () =>
    trace.visibility.push({ ms: performance.now(), state: document.visibilityState }),
  );
  new PerformanceObserver((list) => {
    trace.longTasks.push(
      ...list
        .getEntries()
        .map((entry) => ({ startMs: entry.startTime, durationMs: entry.duration })),
    );
  }).observe({ type: 'longtask', buffered: true });
}
