import { encode, decode } from '@msgpack/msgpack';
import { WSMessage } from '../types';
import { generateUniqueId } from '@/components/view/utils/common';

export class WebSocketManager {

  readonly id: string;

  private ws: WebSocket | null = null;
  private noReconnect = false;
  
  private messageHandlers: Map<string, (payload: any) => void> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private url: string;
  private useMsgPack: boolean;
  private abortController: AbortController | null = null;
  private isDestroyed: boolean = false;

  constructor(id: string | null | undefined, url: string, useMsgPack: boolean = false) {
    this.id = id || generateUniqueId();
    this.url = url;
    this.useMsgPack = useMsgPack;
  }

  connect(signal?: AbortSignal): Promise<void> {
    this.noReconnect = false;
    return new Promise((resolve, reject) => {
      try {
        // 检查是否已被销毁
        if (this.isDestroyed) {
          reject(new Error('WebSocketManager has been destroyed'));
          return;
        }

        // 创建内部的 AbortController 用于管理连接过程
        this.abortController = new AbortController();

        // 如果传入了外部信号，监听它的中断
        if (signal) {
          signal.addEventListener('abort', () => {
            this.abortController?.abort();
          });
        }

        // 监听中断信号
        this.abortController.signal.addEventListener('abort', () => {
          if (this.ws) {
            console.log(`${this.id}: Connection aborted by external signal`);
            this.noReconnect = true;
            this.ws.close();
            this.ws = null;
          }
          reject(new Error('Connection aborted'));
        });

        // 检查是否在开始连接前就被中断了
        if (this.abortController.signal.aborted) {
          reject(new Error('Connection aborted'));
          return;
        }

        this.ws = new WebSocket(this.url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          // 检查是否在连接建立期间被中断
          if (this.abortController?.signal.aborted || this.isDestroyed) {
            this.noReconnect = true;
            this.ws?.close();
            this.ws = null;
            reject(new Error('Connection aborted'));
            return;
          }
          console.log(`${this.id}: WebSocket connected`);
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          // 连接成功后清理 AbortController
          this.abortController = null;
          resolve();
        };

        this.ws.onmessage = (event) => {
          if (!this.isDestroyed) {
            this.handleMessage(event.data);
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.abortController = null;
          reject(error);
        };

        this.ws.onclose = () => {
          console.log(`${this.id}: WebSocket disconnected`);
          this.abortController = null;
          if (!this.isDestroyed && !this.noReconnect) {
            this.scheduleReconnect();
          }
        };
      } catch (error) {
        this.abortController = null;
        reject(error);
      }
    });
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
      console.error('Error handling message:', error);
    }
  }

  on(type: string, handler: (payload: any) => void) {
    this.messageHandlers.set(type, handler);
  }

  off(type: string) {
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
    if (this.reconnectTimer || this.isDestroyed) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isDestroyed) {
        this.connect().catch(console.error);
      }
    }, 5000);
  }

  disconnect() {
    // 中断正在进行的连接
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.noReconnect = true;
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * 销毁 WebSocketManager 实例，清理所有资源
   * 调用此方法后，实例将不能再使用
   */
  destroy() {
    this.isDestroyed = true;

    // 断开连接
    this.disconnect();

    // 清理所有消息处理器
    this.messageHandlers.clear();

    console.log(`${this.id}: WebSocketManager destroyed`);
  }

  get isConnected(): boolean {
    return !this.isDestroyed && this.ws?.readyState === WebSocket.OPEN;
  }
}