import { encode, decode } from '@msgpack/msgpack';
import { generateUniqueId } from '@/utils/common';
import { WSMessage } from '@/types/api';
import { WebSocketAbortedError, WebSocketConnectionError, WebSocketDestroyedError } from './errors';
import { wsConnected, wsDisconnected } from './constants';
import { EventHandler, WebSocketManager } from './types';
import { validateClientMessage, validateServerMessage, ValidationLevel } from '@/utils/validation';


export class WebSocketManagerImpl implements WebSocketManager {

  readonly id: string;

  private ws: WebSocket | null = null;
  private manualDisconnect = false; // Indicates if disconnect was intentional

  private messageHandlers: Map<string | symbol, Set<EventHandler>> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelays = [1000, 2000, 5000, 10000, 15000]; // Progressive delays in ms
  private url: string;
  private useMsgPack: boolean;
  private abortController: AbortController | null = null;
  private externalAbortHandler: (() => void) | null = null;
  private isDestroyed: boolean = false;
  
  // Validation settings - can be set externally
  public clientMessageValidation: ValidationLevel = 'off';
  public serverMessageValidation: ValidationLevel = 'off';

  constructor(id: string | null | undefined, url: string, useMsgPack: boolean = false) {
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
            console.log(`${this.id}: Connection aborted`);
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

        this.ws.onopen = (event) => {
          // Check if aborted or destroyed during connection establishment
          if (this.abortController?.signal.aborted || this.isDestroyed) {
            this.manualDisconnect = true;
            this.ws?.close();
            this.ws = null;
            settlePromise(() => reject(new WebSocketAbortedError()));
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
          this.externalAbortHandler = null;
          
          settlePromise(() => resolve());
          
          if (!this.isDestroyed) {
            this.emit(wsConnected, event);
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
          settlePromise(() => reject(new WebSocketConnectionError(`Failed to connect: ${error}`)));
        };

        this.ws.onclose = (event) => {
          console.log(`${this.id}: WebSocket disconnected (code: ${event.code}, reason: ${event.reason})`);
          this.abortController = null;
          this.externalAbortHandler = null;

          // Only attempt reconnection if not manually disconnected, not destroyed, and within retry limits
          if (!this.isDestroyed && !this.manualDisconnect && this.shouldReconnect(event.code)) {
            this.scheduleReconnect();
          }
          if (!this.isDestroyed) {
            this.emit(wsDisconnected, event);
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
      console.warn(`${this.id}: Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
      return false;
    }

    return true;
  }

  private async handleMessage(data: ArrayBuffer | string) {
    try {
      let message: WSMessage;

      if (data instanceof ArrayBuffer) {
        message = decode(data) as WSMessage;
      } else {
        const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
        message = JSON.parse(text);
      }

      // Validate server message if validation is enabled
      if (this.serverMessageValidation !== 'off') {
        const validation = validateServerMessage(message, this.serverMessageValidation);
        if (!validation.valid && this.serverMessageValidation === 'error') {
          console.error(`${this.id}: Server message validation failed`, validation.message);
          return; // Don't emit invalid messages when in error mode
        }
      }

      this.emit(message.type, message.payload);
    } catch (error) {
      console.error(`${this.id}: Error handling message:`, error);
    }
  }

  private emit<T = any>(type: string | symbol, payload: T) {
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(payload);
        } catch (error) {
          console.error(`${this.id}: Error in event handler:`, error);
        }
      });
    }
  }

  on<T = any>(type: string | symbol, handler: EventHandler<T>) {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler);
  }

  off<T = any>(type: string | symbol, handler?: EventHandler<T>) {
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

  send(message: WSMessage) {
    // Validate client message if validation is enabled
    if (this.clientMessageValidation !== 'off') {
      const validation = validateClientMessage(message, this.clientMessageValidation);
      if (!validation.valid && this.clientMessageValidation === 'error') {
        console.error(`${this.id}: Client message validation failed`, validation.message);
        return; // Don't send invalid messages when in error mode
      }
    }

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

    // Clean up external abort handler
    this.externalAbortHandler = null;

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