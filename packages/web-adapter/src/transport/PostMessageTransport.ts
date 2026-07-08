import type {
  ISimulatorTransport,
  TransportConnectionState,
  TransportEventHandler,
  TransportEventMap,
} from '@tensnap/core';
import type {
  ProtocolEncoding,
  RendererToSimulatorMessage,
} from '@tensnap/protocol';
import {
  generateConnectionId,
  isPostMessageEnvelope,
  type PostMessageEndpoint,
  type PostMessageEnvelope,
  type PostMessageSimulatorHost,
} from '@tensnap/js/transport';

export interface PostMessageTransportOptions {
  endpoint: PostMessageEndpoint;
  connectionId?: string;
}

export class PostMessageTransport implements ISimulatorTransport {
  readonly transportKind = 'postmessage';
  readonly encoding: ProtocolEncoding = 'json';
  readonly connectionId: string;

  private state: TransportConnectionState = 'closed';
  private destroyed = false;
  private readonly handlers = new Map<keyof TransportEventMap, Set<TransportEventHandler<any>>>();
  private readonly endpoint: PostMessageEndpoint;
  private readonly messageListener = (message: unknown) => {
    this.handleEnvelope(message);
  };

  constructor(options: PostMessageTransportOptions) {
    this.endpoint = options.endpoint;
    this.connectionId = options.connectionId ?? generateConnectionId('postmessage');
  }

  async connect(signal?: AbortSignal): Promise<void> {
    if (this.destroyed) {
      throw new Error('Transport destroyed');
    }
    if (this.state === 'open' || this.state === 'connecting') {
      return;
    }
    if (signal?.aborted) {
      throw new Error('Connection aborted');
    }

    this.endpoint.start?.();
    this.endpoint.addMessageListener(this.messageListener);
    this.state = 'connecting';

    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        cleanup();
        this.state = 'closed';
        this.endpoint.removeMessageListener(this.messageListener);
        reject(new Error('Connection aborted'));
      };

      const onOpen = () => {
        cleanup();
        resolve();
      };

      const onError = (error: unknown) => {
        cleanup();
        this.state = 'closed';
        this.endpoint.removeMessageListener(this.messageListener);
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const cleanup = () => {
        signal?.removeEventListener('abort', abort);
        this.off('open', onOpen);
        this.off('error', onError);
      };

      signal?.addEventListener('abort', abort, { once: true });
      this.on('open', onOpen);
      this.on('error', onError);
      this.endpoint.postMessage({
        source: '@tensnap/js',
        protocol: 'postmessage/v1',
        kind: 'connect',
        connectionId: this.connectionId,
      } satisfies PostMessageEnvelope);
    });
  }

  disconnect(): void {
    if (this.destroyed || this.state === 'closed' || this.state === 'closing') {
      return;
    }

    this.state = 'closing';
    this.endpoint.postMessage({
      source: '@tensnap/js',
      protocol: 'postmessage/v1',
      kind: 'disconnect',
      connectionId: this.connectionId,
    } satisfies PostMessageEnvelope);
    this.state = 'closed';
    this.emit('close', undefined);
    this.endpoint.removeMessageListener(this.messageListener);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.disconnect();
    this.destroyed = true;
    this.state = 'destroyed';
    this.handlers.clear();
    this.endpoint.close?.();
  }

  on<K extends keyof TransportEventMap>(
    type: K,
    handler: TransportEventHandler<TransportEventMap[K]>,
  ): void {
    const group = this.handlers.get(type) ?? new Set<TransportEventHandler<TransportEventMap[K]>>();
    group.add(handler);
    this.handlers.set(type, group);
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

    this.endpoint.postMessage({
      source: '@tensnap/js',
      protocol: 'postmessage/v1',
      kind: 'renderer-message',
      connectionId: this.connectionId,
      message,
    } satisfies PostMessageEnvelope);
  }

  get isConnected(): boolean {
    return !this.destroyed && this.state === 'open';
  }

  get connectionState(): TransportConnectionState {
    return this.state;
  }

  private handleEnvelope(message: unknown): void {
    if (!isPostMessageEnvelope(message)) {
      return;
    }
    if (message.connectionId && message.connectionId !== this.connectionId) {
      return;
    }

    switch (message.kind) {
      case 'connected':
        this.state = 'open';
        this.emit('open', undefined);
        return;
      case 'simulator-message':
        this.emit('message', message.message as TransportEventMap['message']);
        return;
      case 'error':
        this.emit('error', new Error(message.error.message));
        return;
      case 'disconnect':
        this.state = 'closed';
        this.emit('close', undefined);
        return;
      default:
        return;
    }
  }

  private emit<K extends keyof TransportEventMap>(type: K, payload: TransportEventMap[K]): void {
    const group = this.handlers.get(type);
    if (!group) {
      return;
    }

    for (const handler of group) {
      handler(payload);
    }
  }
}

export function createPostMessageTransport(options: PostMessageTransportOptions): PostMessageTransport {
  return new PostMessageTransport(options);
}

export function createTransportHostPair(
  transportOptions: PostMessageTransportOptions,
  host: PostMessageSimulatorHost,
): { transport: PostMessageTransport; host: PostMessageSimulatorHost } {
  return {
    transport: new PostMessageTransport(transportOptions),
    host,
  };
}
