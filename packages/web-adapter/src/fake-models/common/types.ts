/**
 * Common types for fake model WebSocket simulations
 */

import type {
  ProtocolMessage,
  RendererToSimulatorMessage,
  SimulatorToRendererMessage,
} from '@tensnap/core';

export type { ProtocolMessage as WSMessage, RendererToSimulatorMessage as ClientToServerMessage, SimulatorToRendererMessage as ServerToClientMessage };

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
  onMessage?: (message: RendererToSimulatorMessage) => void;
  onSendMessageFuncReady?: (
    sendFunc: (message: SimulatorToRendererMessage) => void,
    wsManager: any
  ) => void;
  connectDelay?: number;
}
