import { WSMessage } from '@/types/api';

export type WebSocketConnectionState = 'connecting' | 'open' | 'closing' | 'closed' | 'destroyed';

export interface WebSocketManager {

  readonly id: string;

  connect(signal?: AbortSignal): Promise<void>;

  on<T = any>(type: string | symbol, handler: (payload: T) => void): void;

  off(type: string | symbol): void;

  send(message: WSMessage): void;

  disconnect(): void;
  /**
   * Destroy the WebSocketManager instance and clean up all resources
   * The instance cannot be used after calling this method
   */
  destroy(): void;

  /**
   * Reset reconnection attempts counter
   * Useful when you want to give the connection more retry chances
   */
  resetReconnectionAttempts(): void;

  get isConnected(): boolean;

  get connectionState(): WebSocketConnectionState;

}