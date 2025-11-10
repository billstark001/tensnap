import { WSMessage } from "@/types/api";
import { WebSocketConnectionState, WebSocketManager } from "./types";
import { wsConnected, wsDisconnected } from "./constants";

export interface FakeWebSocketOptions {

  metadata?: {
    name: string;
    description: string;
  },

  /**
   * 当WebSocketManagerFake发送消息时调用的函数
   * @param message 发送的消息
   */
  onMessage?: (message: WSMessage) => void;

  onSendMessageFuncReady?: (sendFunc: (message: WSMessage) => void, wsManager: WebSocketManagerFake) => void;


  /**
   * 连接延迟（毫秒），模拟真实连接
   */
  connectDelay?: number;
}

export interface FakeModelInfo {
  url: string;
  name: string;
  description: string;
}

export class WebSocketManagerFake implements WebSocketManager {
  
  static readonly WEBSOCKET_FAKE_PROTOCOL = 'fake:';
  static readonly globalOptions: Map<string, FakeWebSocketOptions> = new Map();

  static setGlobalOptions(url: string, options: FakeWebSocketOptions) {
    if (url.startsWith(WebSocketManagerFake.WEBSOCKET_FAKE_PROTOCOL)) {
      url = url.slice(WebSocketManagerFake.WEBSOCKET_FAKE_PROTOCOL.length);
    }
    const optionsToRegister = {
      ...options,
    };
    if (!optionsToRegister.metadata) {
      optionsToRegister.metadata = {
        name: url,
        description: 'No description available.',
      };
    } else {
      optionsToRegister.metadata = {
        name: options.metadata!.name || url,
        description: options.metadata!.description || 'No description available.',
      };
    }
    WebSocketManagerFake.globalOptions.set(url, optionsToRegister);
  }

  static getGlobalOptions(url: string): FakeWebSocketOptions | undefined {
    if (url.startsWith(WebSocketManagerFake.WEBSOCKET_FAKE_PROTOCOL)) {
      url = url.slice(WebSocketManagerFake.WEBSOCKET_FAKE_PROTOCOL.length);
    }
    return WebSocketManagerFake.globalOptions.get(url);
  }

  static listRegisteredModels(): FakeModelInfo[] {
    const models: FakeModelInfo[] = [];
    for (const [url, options] of WebSocketManagerFake.globalOptions) {
      models.push({
        url: `${WebSocketManagerFake.WEBSOCKET_FAKE_PROTOCOL}${url}`,
        name: options.metadata?.name || url,
        description: options.metadata?.description || 'No description available.',
      });
    }
    return models;
  }

  static createFromGlobalOptions(id: string | null, url: string): WebSocketManagerFake {
    const options = WebSocketManagerFake.getGlobalOptions(url);
    if (!options) {
      throw new Error(`No global FakeWebSocketOptions found for url: ${url}`);
    }
    return new WebSocketManagerFake(id, options);
  }

  readonly id: string;

  private _connectionState: WebSocketConnectionState = 'closed';
  private _eventHandlers = new Map<string | symbol, Set<(payload: any) => void>>();
  private _options: FakeWebSocketOptions;
  private _connectAbortController?: AbortController;
  private _destroyed = false;

  constructor(id: string | null, options: FakeWebSocketOptions = {}) {
    this.id = id || `fake-ws-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this._options = {
      connectDelay: 100,
      ...options
    };
  }

  async connect(signal?: AbortSignal): Promise<void> {
    if (this._destroyed) {
      throw new Error('WebSocketManagerFake has been destroyed');
    }

    if (this._connectionState === 'connecting' || this._connectionState === 'open') {
      return;
    }

    this._connectionState = 'connecting';
    this._connectAbortController = new AbortController();

    // 如果传入了外部的 AbortSignal，将其链接到内部的 AbortController
    if (signal) {
      signal.addEventListener('abort', () => {
        this._connectAbortController?.abort();
      }, { once: true });
    }

    try {
      // 模拟连接延迟
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (this._connectAbortController?.signal.aborted) {
            reject(new Error('Connection aborted'));
          } else {
            resolve();
          }
        }, this._options.connectDelay);

        this._connectAbortController!.signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new Error('Connection aborted'));
        }, { once: true });
      });

      if (!this._connectAbortController.signal.aborted) {
        this._connectionState = 'open';
        this._options.onSendMessageFuncReady?.(
          this.simulateMessage.bind(this), this
        );
        this._emit(wsConnected, undefined);
      }
    } catch (error) {
      this._connectionState = 'closed';
      throw error;
    }
  }

  on<T = any>(type: string | symbol, handler: (payload: T) => void): void {
    if (this._destroyed) return;

    if (!this._eventHandlers.has(type)) {
      this._eventHandlers.set(type, new Set());
    }
    this._eventHandlers.get(type)!.add(handler);
  }

  off<T = any>(type: string | symbol, handler?: (payload: T) => void): void {
    if (handler) {
      // Remove specific handler
      const handlers = this._eventHandlers.get(type);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this._eventHandlers.delete(type);
        }
      }
    } else {
      // Remove all handlers for this type
      this._eventHandlers.delete(type);
    }
  }

  send(message: WSMessage): void {
    if (this._destroyed) {
      throw new Error('WebSocketManagerFake has been destroyed');
    }

    if (this._connectionState !== 'open') {
      throw new Error('WebSocket is not connected');
    }

    // 调用外部提供的发送处理函数
    this._options.onMessage?.(message);
  }

  disconnect(): void {
    if (this._destroyed || this._connectionState === 'closed' || this._connectionState === 'closing') {
      return;
    }

    this._connectionState = 'closing';
    this._connectAbortController?.abort();

    // Synchronous disconnect to match WebSocketManagerImpl behavior
    this._connectionState = 'closed';
    
    // Use queueMicrotask to ensure disconnect event is emitted asynchronously
    // but without the delay of setTimeout, maintaining consistency
    queueMicrotask(() => {
      if (!this._destroyed) {
        this._emit(wsDisconnected, undefined);
      }
    });
  }

  destroy(): void {
    if (this._destroyed) return;

    this.disconnect();
    this._destroyed = true;
    this._connectionState = 'destroyed';
    this._eventHandlers.clear();
    this._connectAbortController?.abort();
  }

  resetReconnectionAttempts(): void {
    // 模拟实现，对于假的 WebSocket 管理器不需要实际功能
  }

  get isConnected(): boolean {
    return this._connectionState === 'open';
  }

  get connectionState(): WebSocketConnectionState {
    return this._connectionState;
  }

  /**
   * 模拟接收到消息，触发相应的事件处理器
   * @param message 接收到的消息
   */
  simulateMessage(message: WSMessage): void {
    if (this._destroyed || this._connectionState !== 'open') {
      return;
    }
    this._emit(message.type, message.payload);
  }

  /**
   * 模拟连接断开
   */
  simulateDisconnect(): void {
    if (this._connectionState === 'open') {
      this._connectionState = 'closed';
      this._emit(wsDisconnected, undefined);
    }
  }

  private _emit(type: string | symbol, payload: any): void {
    const handlers = this._eventHandlers.get(type);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(payload);
        } catch (error) {
          console.error('Error in WebSocket event handler:', error);
        }
      });
    }
  }
}