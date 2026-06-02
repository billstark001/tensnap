import type {
  RendererToSimulatorMessage,
  SimulatorToRendererMessage,
} from '../core-types';

export type PostMessageTransfer = Transferable;

export interface PostMessageEndpoint {
  postMessage(message: unknown, transfer?: readonly PostMessageTransfer[]): void;
  addMessageListener(listener: (message: unknown) => void): void;
  removeMessageListener(listener: (message: unknown) => void): void;
  start?(): void;
  close?(): void;
}

export interface PostMessageEnvelopeBase {
  source: '@tensnap/js';
  protocol: 'postmessage/v1';
  connectionId?: string;
}

export interface PostMessageConnectEnvelope extends PostMessageEnvelopeBase {
  kind: 'connect';
}

export interface PostMessageConnectedEnvelope extends PostMessageEnvelopeBase {
  kind: 'connected';
}

export interface PostMessageDisconnectEnvelope extends PostMessageEnvelopeBase {
  kind: 'disconnect';
}

export interface PostMessageRendererEnvelope extends PostMessageEnvelopeBase {
  kind: 'renderer-message';
  message: RendererToSimulatorMessage;
}

export interface PostMessageSimulatorEnvelope extends PostMessageEnvelopeBase {
  kind: 'simulator-message';
  message: SimulatorToRendererMessage;
}

export interface PostMessageErrorEnvelope extends PostMessageEnvelopeBase {
  kind: 'error';
  error: {
    message: string;
  };
}

export type PostMessageEnvelope =
  | PostMessageConnectEnvelope
  | PostMessageConnectedEnvelope
  | PostMessageDisconnectEnvelope
  | PostMessageRendererEnvelope
  | PostMessageSimulatorEnvelope
  | PostMessageErrorEnvelope;

export function isPostMessageEnvelope(value: unknown): value is PostMessageEnvelope {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<PostMessageEnvelope>;
  return candidate.source === '@tensnap/js' && candidate.protocol === 'postmessage/v1' && typeof candidate.kind === 'string';
}
