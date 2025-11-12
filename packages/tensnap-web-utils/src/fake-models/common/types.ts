/**
 * Common types for fake model WebSocket simulations
 */

import type {
  WSMessage,
  ClientToServerMessage,
  ServerToClientMessage,
} from 'tensnap-web';

export type { WSMessage, ClientToServerMessage, ServerToClientMessage };

/**
 * Metadata for the simulation model
 */
export interface SimulationMetadata {
  name: string;
  description: string;
}

/**
 * Options for configuring a fake WebSocket simulation
 */
export interface FakeWebSocketOptions {
  metadata?: SimulationMetadata;
  onMessage?: (message: ClientToServerMessage) => void;
  onSendMessageFuncReady?: (
    sendFunc: (message: ServerToClientMessage) => void,
    wsManager: any
  ) => void;
  connectDelay?: number;
}
