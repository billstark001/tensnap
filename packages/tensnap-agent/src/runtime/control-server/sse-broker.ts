// #region Imports
import type { RuntimeEvent } from '../../types';

// #endregion

// #region Types

interface SseClient {
  write: (event: RuntimeEvent) => void;
  close: () => void;
}

// #endregion

// #region Helpers

function formatSseEvent(event: RuntimeEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

// #endregion

// #region Broker

export class RuntimeSseBroker {
  private readonly clients = new Set<SseClient>();

  broadcast(event: RuntimeEvent): void {
    for (const client of [...this.clients]) {
      try {
        client.write(event);
      } catch {
        client.close();
      }
    }
  }

  closeAll(): void {
    for (const client of [...this.clients]) {
      client.close();
    }
    this.clients.clear();
  }

  createResponse(initialEvent: RuntimeEvent, signal?: AbortSignal): Response {
    const encoder = new TextEncoder();
    let client: SseClient | null = null;
    let abortListener: (() => void) | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let closed = false;

        const close = (): void => {
          if (closed) {
            return;
          }
          closed = true;

          if (client) {
            this.clients.delete(client);
          }
          if (signal && abortListener) {
            signal.removeEventListener('abort', abortListener);
          }

          try {
            controller.close();
          } catch {
            // Ignore controller shutdown errors.
          }
        };

        const write = (event: RuntimeEvent): void => {
          if (closed) {
            return;
          }

          controller.enqueue(encoder.encode(formatSseEvent(event)));
        };

        client = { write, close };
        this.clients.add(client);
        write(initialEvent);

        if (signal?.aborted) {
          close();
          return;
        }

        if (signal) {
          abortListener = () => {
            client?.close();
          };
          signal.addEventListener('abort', abortListener, { once: true });
        }
      },
      cancel: () => {
        client?.close();
      },
    });

    return new Response(stream, {
      headers: {
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'content-type': 'text/event-stream',
      },
    });
  }
}

// #endregion