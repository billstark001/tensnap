import type { RendererToSimulatorMessage } from '../core-types';
import type { SimulatorSession } from '../runtime';
import type { PostMessageEndpoint, PostMessageEnvelope } from './types';
import { isPostMessageEnvelope } from './types';

export interface PostMessageSimulatorHostOptions {
  endpoint: PostMessageEndpoint;
  session: SimulatorSession;
  connectionId?: string;
}

export function generateConnectionId(prefix = 'tensnap'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class PostMessageSimulatorHost {
  readonly connectionId: string;

  private destroyed = false;
  private readonly endpoint: PostMessageEndpoint;
  private readonly session: SimulatorSession;
  private readonly messageListener = (message: unknown) => {
    void this.handleEnvelope(message);
  };

  constructor(options: PostMessageSimulatorHostOptions) {
    this.endpoint = options.endpoint;
    this.session = options.session;
    this.connectionId = options.connectionId ?? generateConnectionId('simulator');

    this.endpoint.start?.();
    this.endpoint.addMessageListener(this.messageListener);
  }

  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.endpoint.removeMessageListener(this.messageListener);
    await this.session.close();
    this.endpoint.close?.();
  }

  private async handleEnvelope(message: unknown): Promise<void> {
    if (!isPostMessageEnvelope(message) || this.destroyed) {
      return;
    }

    if (message.connectionId && message.connectionId !== this.connectionId) {
      if (message.kind !== 'connect') {
        return;
      }
    }

    try {
      switch (message.kind) {
        case 'connect':
          await this.handleConnect(message.connectionId);
          return;
        case 'disconnect':
          await this.handleDisconnect(message.connectionId);
          return;
        case 'renderer-message':
          await this.handleRendererMessage(message.message, message.connectionId);
          return;
        default:
          return;
      }
    } catch (error) {
      this.endpoint.postMessage({
        source: '@tensnap/js',
        protocol: 'postmessage/v1',
        kind: 'error',
        connectionId: this.connectionId,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      } satisfies PostMessageEnvelope);
    }
  }

  private async handleConnect(connectionId?: string): Promise<void> {
    const effectiveConnectionId = connectionId ?? this.connectionId;
    this.session.attach((message) => {
      this.endpoint.postMessage({
        source: '@tensnap/js',
        protocol: 'postmessage/v1',
        kind: 'simulator-message',
        connectionId: effectiveConnectionId,
        message,
      } satisfies PostMessageEnvelope);
    }, effectiveConnectionId);
    await this.session.open(effectiveConnectionId);

    this.endpoint.postMessage({
      source: '@tensnap/js',
      protocol: 'postmessage/v1',
      kind: 'connected',
      connectionId: effectiveConnectionId,
    } satisfies PostMessageEnvelope);
  }

  private async handleDisconnect(connectionId?: string): Promise<void> {
    if (connectionId && this.session.connectionId && connectionId !== this.session.connectionId) {
      return;
    }

    await this.session.close();
  }

  private async handleRendererMessage(
    message: RendererToSimulatorMessage,
    connectionId?: string,
  ): Promise<void> {
    if (connectionId && this.session.connectionId && connectionId !== this.session.connectionId) {
      return;
    }
    await this.session.dispatch(message);
  }
}

export function createPostMessageSimulatorHost(
  options: PostMessageSimulatorHostOptions,
): PostMessageSimulatorHost {
  return new PostMessageSimulatorHost(options);
}
