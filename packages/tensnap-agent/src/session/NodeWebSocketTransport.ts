import {
  normalizeWebSocketData,
  waitForWebSocketOpen,
  closeWebSocket,
} from '@tensnap/network/node';
import { type IPFamily, parseIPFamily, validateIPFamily } from '@tensnap/network';
import { EventEmitter } from 'node:events';
import {
  ProtocolCodec,
  type AnyProtocolMessage,
  type ProtocolEncoding,
  type ProtocolValidationLevel,
  type ProtocolValidationWarning,
  type RendererToSimulatorMessage,
} from '@tensnap/protocol';
import type {
  ISimulatorTransport,
  TransportConnectionState,
  TransportEventHandler,
  TransportEventMap,
} from '@tensnap/core/transport';
import WebSocket from 'ws';

export interface NodeWebSocketValidationOptions {
  ip_family?: IPFamily;
  clientMessages?: ProtocolValidationLevel;
  serverMessages?: ProtocolValidationLevel;
}

/** Node WebSocket adapter for the shared renderer client; protocol framing stays in @tensnap/protocol. */
export class NodeWebSocketTransport implements ISimulatorTransport {
  readonly connectionId: string;
  readonly transportKind = 'node-ws';

  private readonly emitter = new EventEmitter();
  private readonly clientCodec = new ProtocolCodec();
  private readonly serverCodec = new ProtocolCodec();
  private readonly onValidationWarning = (warning: ProtocolValidationWarning): void => {
    this.emitter.emit('validation-warning', warning);
  };
  private socket: WebSocket | null = null;
  private state: TransportConnectionState = 'closed';
  private connectAbort: AbortController | null = null;

  constructor(
    private readonly url: string,
    readonly encoding: ProtocolEncoding = 'msgpack',
    private readonly validation: NodeWebSocketValidationOptions = {},
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

    if (signal?.aborted) throw new Error('WebSocket connection aborted.');
    const family = parseIPFamily(this.validation.ip_family);
    validateIPFamily(new URL(this.url).hostname, family);
    this.updateState('connecting');

    const controller = new AbortController();
    this.connectAbort = controller;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const socketOptions: WebSocket.ClientOptions & { autoSelectFamily?: boolean } =
      family === 'auto'
        ? {}
        : {
            family: family === 'ipv4' ? 4 : 6,
            autoSelectFamily: false,
          };
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url, socketOptions);
    } catch (error) {
      signal?.removeEventListener('abort', abort);
      this.connectAbort = null;
      this.updateState('closed');
      throw error;
    }
    this.socket = socket;
    const opened = () => {
      if (this.socket !== socket || controller.signal.aborted || this.state !== 'connecting')
        return;
      this.updateState('open');
      this.emitter.emit('open');
    };
    socket.once('open', opened);
    socket.on('message', (data, isBinary) => {
      if (this.socket === socket && this.state === 'open')
        this.handleMessage(normalizeWebSocketData(data, isBinary));
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      const wasOpen = this.state === 'open';
      this.updateState(this.state === 'destroyed' ? 'destroyed' : 'closed');
      if (wasOpen) this.emitter.emit('close');
    });
    socket.on('error', (error) => {
      if (this.socket === socket && this.state === 'open') this.emitter.emit('error', error);
    });
    try {
      await waitForWebSocketOpen(socket, { signal: controller.signal });
    } catch (error) {
      socket.off('open', opened);
      if (this.socket === socket) {
        this.socket = null;
        if (this.connectionState !== 'destroyed') this.updateState('closed');
      }
      await closeWebSocket(socket);
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (this.connectAbort === controller) this.connectAbort = null;
    }
  }

  disconnect(): void {
    if (!this.socket || this.state === 'closed' || this.state === 'destroyed') {
      return;
    }

    this.updateState('closing');
    this.connectAbort?.abort();
    void closeWebSocket(this.socket).catch(() => undefined);
  }

  destroy(): void {
    if (this.state === 'destroyed') {
      return;
    }

    this.updateState('destroyed');
    this.connectAbort?.abort();
    if (this.socket) void closeWebSocket(this.socket, { timeoutMs: 0 }).catch(() => undefined);
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

    // Read the caller's current policy as before, without discarding scratch state.
    this.clientCodec.setValidation({
      level: this.validation.clientMessages ?? 'off',
      direction: 'renderer-to-simulator',
      onWarning: this.onValidationWarning,
    });
    const payload = this.clientCodec.encode(message as AnyProtocolMessage, this.encoding);
    this.socket.send(typeof payload === 'string' ? payload : Buffer.from(payload));
  }

  private handleMessage(data: string | Uint8Array | ArrayBuffer): void {
    try {
      this.serverCodec.setValidation({
        level: this.validation.serverMessages ?? 'off',
        direction: 'simulator-to-renderer',
        onWarning: this.onValidationWarning,
      });
      const message = this.serverCodec.decode(data);
      this.emitter.emit('message', message);
    } catch (error) {
      this.emitter.emit('error', error);
    }
  }

  private updateState(state: TransportConnectionState): void {
    this.state = state;
  }
}
