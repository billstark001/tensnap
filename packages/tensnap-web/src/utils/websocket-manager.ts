import { encode, decode } from '@msgpack/msgpack';
import { WSMessage } from '../types';

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private messageHandlers: Map<string, (payload: any) => void> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private url: string;
  private useMsgPack: boolean;
  
  constructor(url: string, useMsgPack: boolean = false) {
    this.url = url;
    this.useMsgPack = useMsgPack;
  }
  
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        this.ws.binaryType = 'arraybuffer';
        
        this.ws.onopen = () => {
          console.log('WebSocket connected');
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
        
        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };
        
        this.ws.onclose = () => {
          console.log('WebSocket disconnected');
          this.scheduleReconnect();
        };
      } catch (error) {
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
      console.warn('WebSocket not connected');
    }
  }
  
  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(console.error);
    }, 5000);
  }
  
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
  
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}