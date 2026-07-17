import { generateUniqueId } from '@/utils/common';
import type {
  ISimulatorTransport,
  TransportConnectionState,
  TransportEventHandler,
  TransportEventMap,
} from '@tensnap/core';
import {
  decodeProtocolMessage,
  ProtocolCodec,
  type AnyProtocolMessage,
  type ProtocolCodecMode,
  type ProtocolValidationLevel,
  type RendererToSimulatorMessage,
} from '@tensnap/protocol';
import { WebSocketAbortedError, WebSocketConnectionError, WebSocketDestroyedError } from './errors';


export class WebSocketManagerImpl implements ISimulatorTransport {

  readonly id: string;
  readonly transportKind = 'websocket';

  private ws: WebSocket | null = null;
  private manualDisconnect = false; // Indicates if disconnect was intentional

  private messageHandlers: Map<keyof TransportEventMap, Set<TransportEventHandler<any>>> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelays = [1000, 2000, 5000, 10000, 15000]; // Progressive delays in ms
  private url: string;
  private useMsgPack: boolean;
  private abortController: AbortController | null = null;
  private externalAbortHandler: (() => void) | null = null;
  private isDestroyed: boolean = false;
  private codec: ProtocolCodec | null = null;
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
  ) {
    this.id = id || generateUniqueId();
    this.url = url;
    this.useMsgPack = useMsgPack;
  }

  connect(signal?: AbortSignal): Promise<void> {
    this.manualDisconnect = false;
    return new Promise((resolve, reject) => {
      let promiseSettled = false;
      
      const settlePromise = (settler: () => void) => {
        if (!promiseSettled) {
          promiseSettled = true;
          settler();
        }
      };

      try {
        // Check if already destroyed
        if (this.isDestroyed) {
          settlePromise(() => reject(new WebSocketDestroyedError()));
          return;
        }

        // Clean up existing external abort handler if any
        if (this.externalAbortHandler && signal) {
          signal.removeEventListener('abort', this.externalAbortHandler);
          this.externalAbortHandler = null;
        }

        // Create internal AbortController for connection management
        this.abortController = new AbortController();

        // Listen to external abort signal if provided
        if (signal) {
          this.externalAbortHandler = () => {
            this.abortController?.abort();
          };
          signal.addEventListener('abort', this.externalAbortHandler, { once: true });
        }

        // Listen to abort signal
        const internalAbortHandler = () => {
          if (this.ws) {
            this.emitDiagnostic('info', 'connection_aborted', 'Connection attempt aborted.');
            this.manualDisconnect = true;
            this.ws.close();
            this.ws = null;
          }
          settlePromise(() => reject(new WebSocketAbortedError()));
        };
        this.abortController.signal.addEventListener('abort', internalAbortHandler, { once: true });

        // Check if already aborted before starting connection
        if (this.abortController.signal.aborted) {
          settlePromise(() => reject(new WebSocketAbortedError()));
          return;
        }

        this.ws = new WebSocket(this.url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          // Check if aborted or destroyed during connection establishment
          if (this.abortController?.signal.aborted || this.isDestroyed) {
            this.manualDisconnect = true;
            this.ws?.close();
            this.ws = null;
            settlePromise(() => reject(new WebSocketAbortedError()));
            return;
          }
          this.emitDiagnostic('info', 'connected', 'WebSocket connection established.');

          this.resetProtocolSession();
          if (this.protocolPreference === 'auto') {
            this.handshakeTimer = setTimeout(() => {
              if (this.ws?.readyState === WebSocket.OPEN && this.codec === null) {
                this.selectProtocolMode('legacy', 'handshake-timeout');
              }
            }, 1_000);
          } else {
            this.selectProtocolMode(this.protocolPreference, 'configured');
          }

          // Reset reconnection state on successful connection
          this.reconnectAttempts = 0;
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }

          // Clean up AbortController after successful connection
          this.abortController = null;
          this.externalAbortHandler = null;
          
          settlePromise(() => resolve());
          
          if (!this.isDestroyed) {
            this.emit('open', undefined);
          }
        };

        this.ws.onmessage = (event) => {
          if (!this.isDestroyed) {
            this.handleMessage(event.data);
          }
        };

        this.ws.onerror = (error) => {
          this.abortController = null;
          this.externalAbortHandler = null;
          this.emitDiagnostic('error', 'connection_error', 'WebSocket connection failed.', error);
          settlePromise(() => reject(new WebSocketConnectionError(`Failed to connect: ${error}`)));
        };

        this.ws.onclose = (event) => {
          this.emitDiagnostic(
            this.manualDisconnect || event.code === 1000 ? 'info' : 'warning',
            'closed',
            `WebSocket closed (code ${event.code}${event.reason ? `: ${event.reason}` : ''}).`,
            { code: event.code, reason: event.reason, wasClean: event.wasClean },
          );
          this.abortController = null;
          this.externalAbortHandler = null;
          this.clearHandshakeTimer();

          // Only attempt reconnection if not manually disconnected, not destroyed, and within retry limits
          if (!this.isDestroyed && !this.manualDisconnect && this.shouldReconnect(event.code)) {
            this.scheduleReconnect();
          }
          if (!this.isDestroyed) {
            this.emit('close', undefined);
          }
        };
      } catch (error) {
        this.abortController = null;
        this.externalAbortHandler = null;
        settlePromise(() => reject(new WebSocketConnectionError(`Connection failed: ${error}`)));
      }
    });
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

  private async handleMessage(data: ArrayBuffer | string) {
    try {
      if (this.codec === null) {
        const envelope = decodeProtocolMessage(data) as AnyProtocolMessage;
        this.selectProtocolMode(
          envelope.type === 'simulator_info' ? 'strict' : 'legacy',
          envelope.type === 'simulator_info' ? 'simulator-info' : 'legacy-message',
        );
      }
      this.codec!.setValidation({
        level: this.serverMessageValidation,
        direction: 'simulator-to-renderer',
        onWarning: (warning) => this.emit('validation-warning', warning),
      });
      const message = this.codec!.decode(data) as AnyProtocolMessage;

      this.emit('message', message);
    } catch (error) {
      this.emit('error', error);
    }
  }

  private emit<K extends keyof TransportEventMap>(type: K, payload: TransportEventMap[K]) {
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(payload);
        } catch (error) {
          if (type !== 'diagnostic') {
            this.emitDiagnostic('error', 'event_handler_error', `A ${String(type)} event handler failed.`, error);
          }
        }
      });
    }
  }

  on<K extends keyof TransportEventMap>(type: K, handler: TransportEventHandler<TransportEventMap[K]>) {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler);
  }

  off<K extends keyof TransportEventMap>(type: K, handler?: TransportEventHandler<TransportEventMap[K]>) {
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
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (this.codec === null) {
        throw new Error('Protocol handshake has not selected a codec yet.');
      }
      this.codec.setValidation({
        level: this.clientMessageValidation,
        direction: 'renderer-to-simulator',
        onWarning: (warning) => this.emit('validation-warning', warning),
      });
      const encoded = this.codec.encode(message as AnyProtocolMessage, this.encoding);
      this.ws.send(typeof encoded === 'string' ? encoded : new Uint8Array(encoded));
    } else {
      this.emitDiagnostic('warning', 'send_while_disconnected', 'Skipped a protocol message because the WebSocket is not connected.', {
        messageType: message.type,
      });
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

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isDestroyed && !this.manualDisconnect) {
        this.connect().catch(error => {
          this.emitDiagnostic('warning', 'reconnect_failed', `Reconnect attempt ${this.reconnectAttempts} failed.`, error);
        });
      }
    }, delay);
  }

  disconnect() {
    this.manualDisconnect = true;

    // Abort ongoing connection attempts
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Clean up external abort handler
    this.externalAbortHandler = null;

    // Clear reconnection timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearHandshakeTimer();

    // Close WebSocket connection
    if (this.ws) {
      this.ws.close(1000, 'Manual disconnect'); // Normal closure
      this.ws = null;
    }

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
    this.abortController = null;
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
      case WebSocket.CONNECTING: return 'connecting';
      case WebSocket.OPEN: return 'open';
      case WebSocket.CLOSING: return 'closing';
      case WebSocket.CLOSED: return 'closed';
      default: return 'closed';
    }
  }

  get reconnectionInfo() {
    return {
      attempts: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      isReconnecting: !!this.reconnectTimer,
      manualDisconnect: this.manualDisconnect
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
    this.emit('protocol-mode', { mode, reason });
    this.emitDiagnostic('info', 'protocol_mode_selected', `Selected ${mode} protocol codec (${reason}).`, { mode, reason });
  }

  private resetProtocolSession(): void {
    this.clearHandshakeTimer();
    this.codec = null;
    this.selectedProtocolMode = null;
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
