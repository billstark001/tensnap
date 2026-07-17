import type {
  AnyProtocolMessage,
  ProtocolEncoding,
  ProtocolValidationWarning,
  RendererToSimulatorMessage,
} from '@tensnap/protocol';

export type TransportConnectionState = 'connecting' | 'open' | 'closing' | 'closed' | 'destroyed';
export type TransportEventHandler<T = unknown> = (payload: T) => void;

export interface TransportEventMap {
  open: unknown;
  close: unknown;
  error: unknown;
  'validation-warning': ProtocolValidationWarning;
  message: AnyProtocolMessage;
}

export interface ISimulatorTransport {
  readonly connectionId: string;
  readonly transportKind: string;
  readonly encoding: ProtocolEncoding;
  readonly connectionState: TransportConnectionState;
  readonly isConnected: boolean;

  connect(signal?: AbortSignal): Promise<void>;
  disconnect(): void;
  destroy(): void;

  on<K extends keyof TransportEventMap>(
    type: K,
    handler: TransportEventHandler<TransportEventMap[K]>,
  ): void;

  off<K extends keyof TransportEventMap>(
    type: K,
    handler?: TransportEventHandler<TransportEventMap[K]>,
  ): void;

  send(message: RendererToSimulatorMessage): void;
}
