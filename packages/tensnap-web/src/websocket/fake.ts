import { WSMessage } from "@/types/api";
import { WebSocketConnectionState, WebSocketManager } from "./types";
import { wsConnected, wsDisconnected } from "./constants";

export interface FakeWebSocketOptions {
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

export class WebSocketManagerFake implements WebSocketManager {
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

  off(type: string | symbol): void {
    this._eventHandlers.delete(type);
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

    // 模拟断开连接的异步行为
    setTimeout(() => {
      this._connectionState = 'closed';
      this._emit(wsDisconnected, undefined);
    }, 10);
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