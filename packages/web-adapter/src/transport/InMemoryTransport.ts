import type {
  ISimulatorTransport,
  TransportConnectionState,
  TransportEventHandler,
  TransportEventMap,
} from '@tensnap/core';
import type {
  ProtocolEncoding,
  RendererToSimulatorMessage,
  SimulatorToRendererMessage,
} from '@tensnap/protocol';

export interface InMemorySimulationHandler {
  connectionId?: string;
  onConnect(send: (msg: SimulatorToRendererMessage) => void): void | Promise<void>;
  onMessage(msg: RendererToSimulatorMessage): void | Promise<void>;
  onDisconnect(): void;
}

/** In-process connection with cancellable initialization and connection-scoped callbacks. */
export class InMemoryTransport implements ISimulatorTransport {
  readonly transportKind = 'inmemory';
  readonly encoding: ProtocolEncoding = 'json';
  readonly connectionId: string;

  private state: TransportConnectionState = 'closed';
  private readonly handlers = new Map<keyof TransportEventMap, Set<TransportEventHandler<any>>>();
  private destroyed = false;
  private generation = 0;
  private pendingConnect: Promise<void> | null = null;
  private cancelConnect: (() => void) | null = null;
  private connectionStarted = false;

  constructor(
    private readonly simulation: InMemorySimulationHandler,
    connectionId?: string,
  ) {
    this.connectionId =
      connectionId ?? simulation.connectionId ?? `inmemory-${crypto.randomUUID()}`;
  }

  async connect(signal?: AbortSignal): Promise<void> {
    if (this.destroyed) {
      throw new Error('Transport destroyed');
    }
    if (this.state === 'open') return;
    if (this.pendingConnect) return this.pendingConnect;

    this.state = 'connecting';

    if (signal?.aborted) {
      this.state = 'closed';
      throw new Error('Connection aborted');
    }

    const generation = ++this.generation;
    const bufferedMessages: SimulatorToRendererMessage[] = [];
    const send = (message: SimulatorToRendererMessage) => {
      if (
        this.destroyed ||
        generation !== this.generation ||
        (this.state !== 'open' && this.state !== 'connecting')
      ) {
        return;
      }

      if (this.state === 'connecting') {
        bufferedMessages.push(message);
        return;
      }

      this.emit('message', message as TransportEventMap['message']);
    };

    const pending = new Promise<void>((resolve, reject) => {
      let settled = false;
      let started = false;
      const cleanup = () => {
        signal?.removeEventListener('abort', abort);
        if (this.cancelConnect === cancel) this.cancelConnect = null;
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (generation === this.generation && this.state === 'connecting') {
          this.state = 'closed';
          this.generation += 1;
          if (started) {
            this.connectionStarted = false;
            try {
              this.simulation.onDisconnect();
            } catch (cleanupError) {
              this.emit('error', cleanupError);
            }
          }
        }
        reject(error);
      };
      const abort = () => fail(new Error('Connection aborted'));
      const cancel = () => fail(new Error('Connection closed before opening'));
      this.cancelConnect = cancel;
      signal?.addEventListener('abort', abort, { once: true });
      Promise.resolve()
        .then(() => {
          if (settled) return;
          started = true;
          this.connectionStarted = true;
          return this.simulation.onConnect(send);
        })
        .then(() => {
          if (settled) return;
          settled = true;
          cleanup();
          this.state = 'open';
          this.emit('open', undefined);
          for (const message of bufferedMessages) {
            if (generation !== this.generation || this.state !== 'open') break;
            this.emit('message', message as TransportEventMap['message']);
          }
          resolve();
        }, fail);
    });
    this.pendingConnect = pending;
    try {
      await pending;
    } finally {
      if (this.pendingConnect === pending) this.pendingConnect = null;
    }
  }

  disconnect(): void {
    if (this.destroyed || this.state === 'closed' || this.state === 'closing') {
      return;
    }
    this.state = 'closing';
    this.generation += 1;
    this.pendingConnect = null;
    this.cancelConnect?.();
    const started = this.connectionStarted;
    this.connectionStarted = false;
    try {
      if (started) this.simulation.onDisconnect();
    } finally {
      this.state = 'closed';
      this.emit('close', undefined);
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    try {
      this.disconnect();
    } finally {
      this.destroyed = true;
      this.state = 'destroyed';
      this.handlers.clear();
    }
  }

  on<K extends keyof TransportEventMap>(
    type: K,
    handler: TransportEventHandler<TransportEventMap[K]>,
  ): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
  }

  off<K extends keyof TransportEventMap>(
    type: K,
    handler?: TransportEventHandler<TransportEventMap[K]>,
  ): void {
    if (!handler) {
      this.handlers.delete(type);
      return;
    }
    const group = this.handlers.get(type);
    if (!group) {
      return;
    }
    group.delete(handler);
    if (group.size === 0) {
      this.handlers.delete(type);
    }
  }

  send(message: RendererToSimulatorMessage): void {
    if (this.destroyed || this.state !== 'open') {
      return;
    }
    const generation = this.generation;
    // A rejected async simulator callback must be observable through the
    // transport instead of becoming an unhandled rejection in the host.
    void Promise.resolve(this.simulation.onMessage(message)).catch((error) => {
      if (!this.destroyed && generation === this.generation) this.emit('error', error);
    });
  }

  get isConnected(): boolean {
    return !this.destroyed && this.state === 'open';
  }

  get connectionState(): TransportConnectionState {
    return this.state;
  }

  private emit<K extends keyof TransportEventMap>(type: K, payload: TransportEventMap[K]): void {
    const group = this.handlers.get(type);
    if (!group) {
      return;
    }
    group.forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        console.error('InMemory transport handler error:', error);
      }
    });
  }
}
