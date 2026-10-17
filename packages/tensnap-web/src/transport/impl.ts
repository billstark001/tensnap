import { type IPFamily, browserWebSocketUrl } from '@tensnap/network';
import { generateUniqueId } from '@/utils/common';
import type {
  ISimulatorTransport,
  TransportConnectionState,
  TransportEventHandler,
  TransportEventMap,
} from '@tensnap/core';
import {
  ProtocolCodec,
  type AnyProtocolMessage,
  type ProtocolCodecMode,
  type ProtocolValidationLevel,
  type ProtocolValidationWarning,
  type RendererToSimulatorMessage,
} from '@tensnap/protocol';
import { WebSocketAbortedError, WebSocketConnectionError, WebSocketDestroyedError } from './errors';

export class WebSocketManagerImpl implements ISimulatorTransport {
  readonly id: string;
  readonly transportKind = 'websocket';

  private ws: WebSocket | null = null;
  private manualDisconnect = false; // Indicates if disconnect was intentional

  private messageHandlers: Map<keyof TransportEventMap, Set<TransportEventHandler<any>>> =
    new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelays = [1000, 2000, 5000, 10000, 15000]; // Progressive delays in ms
  private url: string;
  private useMsgPack: boolean;
  private cancelConnect: (() => void) | null = null;
  private isDestroyed: boolean = false;
  private codec: ProtocolCodec | null = null;
  private codecValidationLevel: ProtocolValidationLevel = 'off';
  private codecValidationDirection: 'any' | 'renderer-to-simulator' | 'simulator-to-renderer' =
    'any';
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private selectedProtocolMode: ProtocolCodecMode | null = null;

  // Validation settings - can be set externally
  public clientMessageValidation: ProtocolValidationLevel = 'off';
  public serverMessageValidation: ProtocolValidationLevel = 'off';

  constructor(
    id: string | null | undefined,
    url: string,
    useMsgPack: boolean = false,
    private readonly protocolPreference: 'auto' | ProtocolCodecMode = 'auto',
    public ip_family: IPFamily = 'auto',
  ) {
    this.id = id || generateUniqueId();
    this.url = url;
    this.useMsgPack = useMsgPack;
  }

  connect(signal?: AbortSignal): Promise<void> {
    if (this.isDestroyed) return Promise.reject(new WebSocketDestroyedError());
    if (signal?.aborted) return Promise.reject(new WebSocketAbortedError());
    let endpoint: string;
    try {
      endpoint = browserWebSocketUrl(this.url, this.ip_family);
    } catch (error) {
      return Promise.reject(new WebSocketConnectionError(String(error)));
    }
    this.cancelConnect?.();
    this.releaseSocket();
    this.clearHandshakeTimer();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.manualDisconnect = false;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let socket: WebSocket | undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', cancel);
        if (this.cancelConnect === cancel) this.cancelConnect = null;
        if (error) reject(error);
        else resolve();
      };
      const cancel = () => {
        if (socket && this.ws === socket) {
          this.manualDisconnect = true;
          this.releaseSocket();
          this.clearHandshakeTimer();
        }
        finish(new WebSocketAbortedError());
      };
      this.cancelConnect = cancel;
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) {
        cancel();
        return;
      }
      try {
        socket = new WebSocket(endpoint);
        this.ws = socket;
        const current = socket;
        current.binaryType = 'arraybuffer';
        current.onopen = () => {
          if (this.ws !== current || this.isDestroyed) {
            cancel();
            return;
          }
          this.emitDiagnostic('info', 'connected', 'WebSocket connection established.');
          if (this.ws !== current || this.isDestroyed) {
            cancel();
            return;
          }
          this.resetProtocolSession();
          if (this.protocolPreference === 'auto') {
            this.handshakeTimer = setTimeout(() => {
              if (
                this.ws === current &&
                current.readyState === WebSocket.OPEN &&
                this.codec === null
              )
                this.selectProtocolMode('legacy', 'handshake-timeout');
            }, 1_000);
          } else this.selectProtocolMode(this.protocolPreference, 'configured');
          if (this.ws !== current || this.isDestroyed) {
            cancel();
            return;
          }
          this.reconnectAttempts = 0;
          finish();
          if (!this.isDestroyed) this.emit('open', undefined);
        };
        current.onmessage = (event) => {
          if (this.ws === current && !this.isDestroyed) this.handleMessage(event.data);
        };
        current.onerror = (error) => {
          if (this.ws !== current) return;
          this.emitDiagnostic('error', 'connection_error', 'WebSocket connection failed.', error);
          finish(new WebSocketConnectionError(`Failed to connect: ${error}`));
        };
        current.onclose = (event) => {
          if (this.ws !== current) return;
          this.ws = null;
          finish(new WebSocketConnectionError('WebSocket closed before opening.'));
          this.clearHandshakeTimer();
          this.emitDiagnostic(
            this.manualDisconnect || event.code === 1000 ? 'info' : 'warning',
            'closed',
            `WebSocket closed (code ${event.code}${event.reason ? `: ${event.reason}` : ''}).`,
            { code: event.code, reason: event.reason, wasClean: event.wasClean },
          );
          if (!this.isDestroyed && !this.manualDisconnect && this.shouldReconnect(event.code))
            this.scheduleReconnect();
          if (!this.isDestroyed && this.ws === null) this.emit('close', undefined);
        };
      } catch (error) {
        if (socket && this.ws === socket) this.releaseSocket();
        finish(new WebSocketConnectionError(`Connection failed: ${error}`));
      }
    });
  }

  private releaseSocket(): void {
    const socket = this.ws;
    this.ws = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.close(1000, 'Connection released');
  }

  private shouldReconnect(closeCode: number): boolean {
    // Don't reconnect on normal closure or policy violation
    if (closeCode === 1000 || closeCode === 1008) return false;

    // Don't reconnect if max attempts reached
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emitDiagnostic(
        'warning',
        'reconnect_exhausted',
        `Stopped reconnecting after ${this.maxReconnectAttempts} attempts.`,
      );
      return false;
    }

    return true;
  }

  private handleMessage(data: ArrayBuffer | string): void {
    try {
      if (this.codec === null) {
        // This one-off probe selects the retained strict/legacy session codec.
        const envelope = new ProtocolCodec().decode(data);
        this.selectProtocolMode(
          envelope.type === 'simulator_info' ? 'strict' : 'legacy',
          envelope.type === 'simulator_info' ? 'simulator-info' : 'legacy-message',
        );
      }
      this.configureCodecValidation(this.serverMessageValidation, 'simulator-to-renderer');
      const message = this.codec!.decode(data) as AnyProtocolMessage;

      this.emit('message', message);
    } catch (error) {
      this.emit('error', error);
    }
  }

  private emit<K extends keyof TransportEventMap>(type: K, payload: TransportEventMap[K]) {
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(payload);
        } catch (error) {
          if (type !== 'diagnostic') {
            this.emitDiagnostic(
              'error',
              'event_handler_error',
              `A ${String(type)} event handler failed.`,
              error,
            );
          }
        }
      });
    }
  }

  on<K extends keyof TransportEventMap>(
    type: K,
    handler: TransportEventHandler<TransportEventMap[K]>,
  ) {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler);
  }

  off<K extends keyof TransportEventMap>(
    type: K,
    handler?: TransportEventHandler<TransportEventMap[K]>,
  ) {
    if (handler) {
      // Remove specific handler
      const handlers = this.messageHandlers.get(type);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.messageHandlers.delete(type);
        }
      }
    } else {
      // Remove all handlers for this type
      this.messageHandlers.delete(type);
    }
  }

  send(message: RendererToSimulatorMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (this.codec === null) {
        throw new Error('Protocol handshake has not selected a codec yet.');
      }
      this.configureCodecValidation(this.clientMessageValidation, 'renderer-to-simulator');
      const encoded = this.codec.encode(message as AnyProtocolMessage, this.encoding);
      this.ws.send(typeof encoded === 'string' ? encoded : new Uint8Array(encoded));
    } else {
      this.emitDiagnostic(
        'warning',
        'send_while_disconnected',
        'Skipped a protocol message because the WebSocket is not connected.',
        {
          messageType: message.type,
        },
      );
      throw new Error('WebSocket transport is not connected.');
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.isDestroyed || this.manualDisconnect) return;

    this.reconnectAttempts++;

    // Calculate delay using progressive backoff
    const delayIndex = Math.min(this.reconnectAttempts - 1, this.reconnectDelays.length - 1);
    const delay = this.reconnectDelays[delayIndex];

    this.emitDiagnostic(
      'info',
      'reconnect_scheduled',
      `Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} scheduled in ${delay}ms.`,
    );

    if (this.reconnectTimer || this.isDestroyed || this.manualDisconnect) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isDestroyed && !this.manualDisconnect) {
        this.connect().catch((error) => {
          this.emitDiagnostic(
            'warning',
            'reconnect_failed',
            `Reconnect attempt ${this.reconnectAttempts} failed.`,
            error,
          );
        });
      }
    }, delay);
  }

  disconnect() {
    this.manualDisconnect = true;

    this.cancelConnect?.();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearHandshakeTimer();
    const wasOpen = this.isConnected;
    this.releaseSocket();
    if (wasOpen && !this.isDestroyed) this.emit('close', undefined);

    this.emitDiagnostic('info', 'disconnected', 'WebSocket disconnected by request.');
  }

  /**
   * Destroy the WebSocketManager instance and clean up all resources
   * The instance cannot be used after calling this method
   */
  destroy() {
    this.isDestroyed = true;
    this.manualDisconnect = true;

    // Disconnect and clean up
    this.disconnect();

    // Clear all message handlers
    this.messageHandlers.clear();

    // Reset reconnection state
    this.reconnectAttempts = 0;
    this.ws = null;
    this.cancelConnect = null;
    this.reconnectTimer = null;
    this.clearHandshakeTimer();

    this.emitDiagnostic('debug', 'destroyed', 'WebSocket transport destroyed.');
  }

  /**
   * Reset reconnection attempts counter
   * Useful when you want to give the connection more retry chances
   */
  resetReconnectionAttempts() {
    this.reconnectAttempts = 0;
  }

  get isConnected(): boolean {
    return !this.isDestroyed && this.ws?.readyState === WebSocket.OPEN;
  }

  get connectionId(): string {
    return this.url;
  }

  get encoding(): 'json' | 'msgpack' {
    return this.useMsgPack ? 'msgpack' : 'json';
  }

  get protocolMode(): ProtocolCodecMode | null {
    return this.selectedProtocolMode;
  }

  get connectionState(): TransportConnectionState {
    if (this.isDestroyed) return 'destroyed';
    if (!this.ws) return 'closed';

    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'open';
      case WebSocket.CLOSING:
        return 'closing';
      case WebSocket.CLOSED:
        return 'closed';
      default:
        return 'closed';
    }
  }

  get reconnectionInfo() {
    return {
      attempts: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      isReconnecting: !!this.reconnectTimer,
      manualDisconnect: this.manualDisconnect,
    };
  }

  private selectProtocolMode(
    mode: ProtocolCodecMode,
    reason: 'configured' | 'simulator-info' | 'legacy-message' | 'handshake-timeout',
  ): void {
    if (this.codec !== null) return;
    this.clearHandshakeTimer();
    this.selectedProtocolMode = mode;
    this.codec = new ProtocolCodec({
      mode,
      onWarning: (warning) => this.emit('codec-warning', warning),
    });
    this.codecValidationLevel = 'off';
    this.codecValidationDirection = 'any';
    this.emit('protocol-mode', { mode, reason });
    this.emitDiagnostic(
      'info',
      'protocol_mode_selected',
      `Selected ${mode} protocol codec (${reason}).`,
      { mode, reason },
    );
  }

  private resetProtocolSession(): void {
    this.clearHandshakeTimer();
    this.codec = null;
    this.codecValidationLevel = 'off';
    this.codecValidationDirection = 'any';
    this.selectedProtocolMode = null;
  }

  private readonly onValidationWarning = (warning: ProtocolValidationWarning): void => {
    this.emit('validation-warning', warning);
  };

  private configureCodecValidation(
    level: ProtocolValidationLevel,
    direction: 'renderer-to-simulator' | 'simulator-to-renderer',
  ): void {
    // With validation off, direction has no effect. Keep the default codec
    // configuration across the four incoming frames and the next send.
    const effectiveDirection = level === 'off' ? 'any' : direction;
    if (this.codecValidationLevel === level && this.codecValidationDirection === effectiveDirection)
      return;
    this.codec!.setValidation({
      level,
      direction: effectiveDirection,
      onWarning: this.onValidationWarning,
    });
    this.codecValidationLevel = level;
    this.codecValidationDirection = effectiveDirection;
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer !== null) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
  }

  private emitDiagnostic(
    severity: TransportEventMap['diagnostic']['severity'],
    code: string,
    message: string,
    details?: unknown,
  ): void {
    this.emit('diagnostic', {
      timestamp: Date.now(),
      severity,
      domain: 'transport',
      source: 'websocket',
      code,
      message,
      ...(details === undefined ? {} : { details }),
      dedupeKey: `${code}:${message}`,
    });
  }
}
