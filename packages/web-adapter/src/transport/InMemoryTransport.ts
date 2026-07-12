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

export class InMemoryTransport implements ISimulatorTransport {
  readonly transportKind = 'inmemory';
  readonly encoding: ProtocolEncoding = 'json';
  readonly connectionId: string;

  private state: TransportConnectionState = 'closed';
  private readonly handlers = new Map<keyof TransportEventMap, Set<TransportEventHandler<any>>>();
  private destroyed = false;

  constructor(private readonly simulation: InMemorySimulationHandler, connectionId?: string) {
    this.connectionId = connectionId ?? simulation.connectionId ?? `inmemory-${crypto.randomUUID()}`;
  }

  async connect(signal?: AbortSignal): Promise<void> {
    if (this.destroyed) {
      throw new Error('Transport destroyed');
    }
    if (this.state === 'open' || this.state === 'connecting') {
      return;
    }

    this.state = 'connecting';

    if (signal?.aborted) {
      this.state = 'closed';
      throw new Error('Connection aborted');
    }

    const bufferedMessages: SimulatorToRendererMessage[] = [];
    const send = (message: SimulatorToRendererMessage) => {
      if (this.destroyed || (this.state !== 'open' && this.state !== 'connecting')) {
        return;
      }

      if (this.state === 'connecting') {
        bufferedMessages.push(message);
        return;
      }

      this.emit('message', message as TransportEventMap['message']);
    };

    await this.simulation.onConnect(send);

    if (!this.destroyed) {
      this.state = 'open';
      this.emit('open', undefined);
      bufferedMessages.forEach((message) => {
        this.emit('message', message as TransportEventMap['message']);
      });
    }
  }

  disconnect(): void {
    if (this.destroyed || this.state === 'closed' || this.state === 'closing') {
      return;
    }
    this.state = 'closing';
    this.simulation.onDisconnect();
    this.state = 'closed';
    this.emit('close', undefined);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.disconnect();
    this.destroyed = true;
    this.state = 'destroyed';
    this.handlers.clear();
  }

  on<K extends keyof TransportEventMap>(type: K, handler: TransportEventHandler<TransportEventMap[K]>): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
  }

  off<K extends keyof TransportEventMap>(type: K, handler?: TransportEventHandler<TransportEventMap[K]>): void {
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
    void this.simulation.onMessage(message);
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
