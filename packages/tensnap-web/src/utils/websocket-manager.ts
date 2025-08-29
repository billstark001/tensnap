import { encode, decode } from '@msgpack/msgpack';
import { generateUniqueId } from '@/utils/common';
import { WSMessage } from '@/types/api';

// Custom exception classes for better error handling
export class WebSocketError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'WebSocketError';
  }
}

export class WebSocketConnectionError extends WebSocketError {
  constructor(message: string) {
    super(message, 'CONNECTION_ERROR');
    this.name = 'WebSocketConnectionError';
  }
}

export class WebSocketDestroyedError extends WebSocketError {
  constructor() {
    super('WebSocketManager has been destroyed', 'DESTROYED');
    this.name = 'WebSocketDestroyedError';
  }
}

export class WebSocketAbortedError extends WebSocketError {
  constructor() {
    super('Connection aborted', 'ABORTED');
    this.name = 'WebSocketAbortedError';
  }
}

export class WebSocketManager {

  readonly id: string;

  private ws: WebSocket | null = null;
  private manualDisconnect = false; // Indicates if disconnect was intentional

  private messageHandlers: Map<string | symbol, (payload: any) => void> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelays = [1000, 2000, 5000, 10000, 15000]; // Progressive delays in ms
  private url: string;
  private useMsgPack: boolean;
  private abortController: AbortController | null = null;
  private isDestroyed: boolean = false;

  constructor(id: string | null | undefined, url: string, useMsgPack: boolean = false) {
    this.id = id || generateUniqueId();
    this.url = url;
    this.useMsgPack = useMsgPack;
  }

  static readonly Connected = Symbol('WebSocketManager:Connected');
  static readonly Disconnected = Symbol('WebSocketManager:Disconnected');

  connect(signal?: AbortSignal): Promise<void> {
    this.manualDisconnect = false;
    return new Promise((resolve, reject) => {
      let promiseFinished = false;
      try {
        // Check if already destroyed
        if (this.isDestroyed) {
          promiseFinished = true;
          reject(new WebSocketDestroyedError());
          return;
        }

        // Create internal AbortController for connection management
        this.abortController = new AbortController();

        // Listen to external abort signal if provided
        if (signal) {
          signal.addEventListener('abort', () => {
            this.abortController?.abort();
          });
        }

        // Listen to abort signal
        this.abortController.signal.addEventListener('abort', () => {
          if (this.ws) {
            console.log(`${this.id}: Connection aborted by external signal`);
            this.manualDisconnect = true;
            this.ws.close();
            this.ws = null;
          }
          promiseFinished = true;
          reject(new WebSocketAbortedError());
        });

        // Check if already aborted before starting connection
        if (this.abortController.signal.aborted) {
          promiseFinished = true;
          reject(new WebSocketAbortedError());
          return;
        }

        this.ws = new WebSocket(this.url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = (event) => {
          // Check if aborted or destroyed during connection establishment
          if (this.abortController?.signal.aborted || this.isDestroyed) {
            this.manualDisconnect = true;
            this.ws?.close();
            this.ws = null;
            promiseFinished = true;
            reject(new WebSocketAbortedError());
            return;
          }
          console.log(`${this.id}: WebSocket connected`);

          // Reset reconnection state on successful connection
          this.reconnectAttempts = 0;
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }

          // Clean up AbortController after successful connection
          this.abortController = null;
          if (!promiseFinished) {
            promiseFinished = true;
            resolve();
          } else if (!this.isDestroyed) {
            this.messageHandlers.get(WebSocketManager.Connected)?.(event);
          }
        };

        this.ws.onmessage = (event) => {
          if (!this.isDestroyed) {
            this.handleMessage(event.data);
          }
        };

        this.ws.onerror = (error) => {
          this.abortController = null;
          if (!promiseFinished) {
            promiseFinished = true;
            reject(new WebSocketConnectionError(`Failed to connect: ${error}`));
          }
        };

        this.ws.onclose = (event) => {
          console.log(`${this.id}: WebSocket disconnected (code: ${event.code}, reason: ${event.reason})`);
          this.abortController = null;

          // Only attempt reconnection if not manually disconnected, not destroyed, and within retry limits
          if (!this.isDestroyed && !this.manualDisconnect && this.shouldReconnect(event.code)) {
            this.scheduleReconnect();
          }
          if (!this.isDestroyed) {
            this.messageHandlers.get(WebSocketManager.Disconnected)?.(event);
          }
        };
      } catch (error) {
        this.abortController = null;
        promiseFinished = true;
        reject(new WebSocketConnectionError(`Connection failed: ${error}`));
      }
    });
  }

  private shouldReconnect(closeCode: number): boolean {
    // Don't reconnect on normal closure or policy violation
    if (closeCode === 1000 || closeCode === 1008) return false;

    // Don't reconnect if max attempts reached
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(`${this.id}: Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
      return false;
    }

    return true;
  }

  private async handleMessage(data: ArrayBuffer | string) {
    try {
      let message: WSMessage;

      if (this.useMsgPack && data instanceof ArrayBuffer) {
        message = decode(data) as WSMessage;
      } else {
        const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
        message = JSON.parse(text);
      }

      const handler = this.messageHandlers.get(message.type);
      if (handler) {
        handler(message.payload);
      }
    } catch (error) {
      console.error(`${this.id}: Error handling message:`, error);
    }
  }

  on<T = any>(type: string | symbol, handler: (payload: T) => void) {
    this.messageHandlers.set(type, handler);
  }

  off(type: string | symbol) {
    this.messageHandlers.delete(type);
  }

  send(message: WSMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (this.useMsgPack) {
        const encoded = encode(message);
        this.ws.send(encoded);
      } else {
        this.ws.send(JSON.stringify(message));
      }
    } else {
      console.warn(`${this.id}: WebSocket not connected`);
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.isDestroyed || this.manualDisconnect) return;

    this.reconnectAttempts++;

    // Calculate delay using progressive backoff
    const delayIndex = Math.min(this.reconnectAttempts - 1, this.reconnectDelays.length - 1);
    const delay = this.reconnectDelays[delayIndex];

    console.log(`${this.id}: Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isDestroyed && !this.manualDisconnect) {
        this.connect().catch(error => {
          console.error(`${this.id}: Reconnection attempt ${this.reconnectAttempts} failed:`, error);
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

    // Clear reconnection timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Close WebSocket connection
    if (this.ws) {
      this.ws.close(1000, 'Manual disconnect'); // Normal closure
      this.ws = null;
    }

    console.log(`${this.id}: WebSocket manually disconnected`);
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

    console.log(`${this.id}: WebSocketManager destroyed`);
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

  get connectionState(): 'connecting' | 'open' | 'closing' | 'closed' | 'destroyed' {
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
}