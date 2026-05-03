import { EventEmitter } from 'node:events';
import {
  decodeProtocolMessage,
  encodeProtocolMessage,
  type AnyProtocolMessage,
  type ProtocolEncoding,
  type RendererToSimulatorMessage,
} from '@tensnap/core/protocol';
import type {
  ISimulatorTransport,
  TransportConnectionState,
  TransportEventHandler,
  TransportEventMap,
} from '@tensnap/core/transport';
import WebSocket, { type RawData } from 'ws';

export function normalizeRawData(data: RawData, isBinary: boolean): string | Uint8Array | ArrayBuffer {
  if (!isBinary) {
    if (typeof data === 'string') {
      return data;
    }

    if (data instanceof ArrayBuffer) {
      return Buffer.from(data).toString('utf8');
    }

    if (Array.isArray(data)) {
      return Buffer.concat(data.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(part))).toString('utf8');
    }

    return Buffer.from(data).toString('utf8');
  }

  if (typeof data === 'string') {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(part)));
  }

  return data;
}

export class NodeWebSocketTransport implements ISimulatorTransport {
  readonly connectionId: string;
  readonly transportKind = 'node-ws';

  private readonly emitter = new EventEmitter();
  private socket: WebSocket | null = null;
  private state: TransportConnectionState = 'closed';

  constructor(
    private readonly url: string,
    readonly encoding: ProtocolEncoding = 'msgpack',
  ) {
    this.connectionId = `ws:${url}`;
  }

  get connectionState(): TransportConnectionState {
    return this.state;
  }

  get isConnected(): boolean {
    return this.state === 'open';
  }

  async connect(signal?: AbortSignal): Promise<void> {
    if (this.state === 'destroyed') {
      throw new Error('Transport has already been destroyed.');
    }

    if (this.state === 'open') {
      return;
    }

    if (this.state === 'connecting') {
      throw new Error('Transport is already connecting.');
    }

    this.updateState('connecting');

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(this.url);
      this.socket = socket;

      const cleanupAbort = (): void => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      const fail = (error: unknown): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanupAbort();
        this.updateState('closed');
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const succeed = (): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanupAbort();
        this.updateState('open');
        this.emitter.emit('open');
        resolve();
      };

      const onAbort = (): void => {
        socket.close();
        fail(new Error('WebSocket connection aborted.'));
      };

      socket.once('open', succeed);
      socket.once('error', fail);
      socket.on('message', (data, isBinary) => this.handleMessage(normalizeRawData(data, isBinary)));
      socket.on('close', () => {
        const wasOpen = this.state === 'open';
        this.updateState(this.state === 'destroyed' ? 'destroyed' : 'closed');
        if (!settled) {
          fail(new Error(`WebSocket closed before opening: ${this.url}`));
          return;
        }
        if (wasOpen) {
          this.emitter.emit('close');
        }
      });
      socket.on('error', (error) => {
        if (settled) {
          this.emitter.emit('error', error);
          return;
        }
        fail(error);
      });

      if (signal?.aborted) {
        onAbort();
      } else {
        signal?.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  disconnect(): void {
    if (!this.socket || this.state === 'closed' || this.state === 'destroyed') {
      return;
    }

    this.updateState('closing');
    this.socket.close();
  }

  destroy(): void {
    if (this.state === 'destroyed') {
      return;
    }

    this.updateState('destroyed');
    this.socket?.removeAllListeners();
    this.socket?.terminate();
    this.socket = null;
    this.emitter.removeAllListeners();
  }

  on<K extends keyof TransportEventMap>(
    type: K,
    handler: TransportEventHandler<TransportEventMap[K]>,
  ): void {
    this.emitter.on(type, handler);
  }

  off<K extends keyof TransportEventMap>(
    type: K,
    handler?: TransportEventHandler<TransportEventMap[K]>,
  ): void {
    if (!handler) {
      this.emitter.removeAllListeners(type);
      return;
    }

    this.emitter.off(type, handler);
  }

  send(message: RendererToSimulatorMessage): void {
    if (!this.socket || this.state !== 'open') {
      throw new Error('Transport is not connected.');
    }

    const payload = encodeProtocolMessage(message as AnyProtocolMessage, this.encoding);
    this.socket.send(typeof payload === 'string' ? payload : Buffer.from(payload));
  }

  private handleMessage(data: string | Uint8Array | ArrayBuffer): void {
    try {
      const message = decodeProtocolMessage(data) as AnyProtocolMessage;
      this.emitter.emit('message', message);
    } catch (error) {
      this.emitter.emit('error', error);
    }
  }

  private updateState(state: TransportConnectionState): void {
    this.state = state;
  }
}