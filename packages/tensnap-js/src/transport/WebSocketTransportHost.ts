import {
  decodeProtocolMessage,
  encodeProtocolMessage,
  type AnyProtocolMessage,
  type ProtocolEncoding,
  type ProtocolValidationLevel,
  type ProtocolValidationWarning,
  type RendererToSimulatorMessage,
} from '@tensnap/protocol';
import WebSocket, {
  WebSocketServer,
  type RawData,
  type ServerOptions as WebSocketServerOptions,
} from 'ws';
import type { SimulatorSession } from '../runtime';
import { generateConnectionId } from './PostMessageTransportHost';

export function normalizeWebSocketRawData(
  data: RawData,
  isBinary: boolean,
): string | Uint8Array | ArrayBuffer {
  if (!isBinary) {
    if (typeof data === 'string') {
      return data;
    }

    if (data instanceof ArrayBuffer) {
      return Buffer.from(data).toString('utf8');
    }

    if (Array.isArray(data)) {
      return Buffer.concat(data.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(part))).toString('utf8');
    }

    return Buffer.from(data).toString('utf8');
  }

  if (typeof data === 'string') {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(part)));
  }

  return data;
}

export interface WebSocketTransportHostOptions {
  sessionFactory: () => SimulatorSession;
  encoding?: ProtocolEncoding;
  connectionIdFactory?: (socket: WebSocket) => string;
  server?: WebSocketServer;
  serverOptions?: WebSocketServerOptions;
  rendererMessageValidation?: ProtocolValidationLevel;
  simulatorMessageValidation?: ProtocolValidationLevel;
  onValidationWarning?: (warning: ProtocolValidationWarning) => void;
  onValidationError?: (error: unknown) => void;
}

export class WebSocketTransportHost {
  readonly server: WebSocketServer;
  readonly encoding: ProtocolEncoding;

  private readonly connectionIdFactory: (socket: WebSocket) => string;
  private readonly sessionFactory: () => SimulatorSession;
  private readonly rendererMessageValidation: ProtocolValidationLevel;
  private readonly simulatorMessageValidation: ProtocolValidationLevel;
  private readonly onValidationWarning?: (warning: ProtocolValidationWarning) => void;
  private readonly onValidationError?: (error: unknown) => void;
  private readonly sessions = new Map<WebSocket, SimulatorSession>();
  private closing = false;

  constructor(options: WebSocketTransportHostOptions) {
    this.server = options.server ?? new WebSocketServer(options.serverOptions ?? { port: 0 });
    this.encoding = options.encoding ?? 'json';
    this.sessionFactory = options.sessionFactory;
    this.connectionIdFactory = options.connectionIdFactory ?? (() => generateConnectionId('ws'));
    this.rendererMessageValidation = options.rendererMessageValidation ?? 'off';
    this.simulatorMessageValidation = options.simulatorMessageValidation ?? 'off';
    this.onValidationWarning = options.onValidationWarning;
    this.onValidationError = options.onValidationError;

    this.server.on('connection', (socket) => {
      void this.handleConnection(socket);
    });
  }

  get url(): string | undefined {
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      return undefined;
    }
    return `ws://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    if (this.closing) {
      return;
    }

    this.closing = true;

    for (const socket of this.sessions.keys()) {
      socket.close();
    }

    await Promise.all([...this.sessions.values()].map((session) => session.close().catch(() => undefined)));
    this.sessions.clear();

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async handleConnection(socket: WebSocket): Promise<void> {
    const session = this.sessionFactory();
    const connectionId = this.connectionIdFactory(socket);
    this.sessions.set(socket, session);

    session.attach(async (message) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      let encoded: string | Uint8Array;
      try {
        encoded = encodeProtocolMessage(message as AnyProtocolMessage, this.encoding, {
          validation: {
            level: this.simulatorMessageValidation,
            direction: 'simulator-to-renderer',
            onWarning: this.onValidationWarning,
          },
        });
      } catch (error) {
        this.onValidationError?.(error);
        throw error;
      }
      socket.send(typeof encoded === 'string' ? encoded : Buffer.from(encoded));
    }, connectionId);

    socket.on('message', (data, isBinary) => {
      const normalized = normalizeWebSocketRawData(data, isBinary);
      let decoded: RendererToSimulatorMessage;
      try {
        decoded = decodeProtocolMessage(normalized, {
          validation: {
            level: this.rendererMessageValidation,
            direction: 'renderer-to-simulator',
            onWarning: this.onValidationWarning,
          },
        }) as RendererToSimulatorMessage;
      } catch (error) {
        this.onValidationError?.(error);
        void session.emitter.error({
          code: 'protocol_validation_failed',
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      void session.dispatch(decoded).catch((error) => {
        void session.emitter.error({
          code: 'dispatch_failed',
          message: error instanceof Error ? error.message : String(error),
        });
      });
    });

    socket.once('close', () => {
      this.sessions.delete(socket);
      void session.close();
    });

    socket.once('error', () => {
      this.sessions.delete(socket);
      void session.close();
    });

    try {
      await session.open(connectionId);
    } catch (error) {
      this.sessions.delete(socket);
      socket.close();
      throw error;
    }
  }
}

export function createWebSocketTransportHost(
  options: WebSocketTransportHostOptions,
): WebSocketTransportHost {
  return new WebSocketTransportHost(options);
}
