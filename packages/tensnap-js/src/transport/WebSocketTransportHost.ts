import { normalizeWebSocketData } from '@tensnap/network/node';
import {
  ProtocolCodec,
  type AnyProtocolMessage,
  type ProtocolEncoding,
  type ProtocolValidationLevel,
  type ProtocolValidationWarning,
  type RendererToSimulatorMessage,
  type SimulatorToRendererMessage,
} from '@tensnap/protocol';
import WebSocket, { WebSocketServer, type ServerOptions as WebSocketServerOptions } from 'ws';
import type { SimulatorSession } from '../runtime';
import { generateConnectionId } from './PostMessageTransportHost';
import { createServer, type Server as HttpServer } from 'node:http';
import {
  closeIPServers,
  listenIPServers,
  webSocketByteLength,
  closeWebSocket,
} from '@tensnap/network/node';
import { parseIPFamily, listenerUrl, type IPFamily } from '@tensnap/network';

export interface WebSocketTransportHostOptions {
  ip_family?: IPFamily;
  sessionFactory: () => SimulatorSession;
  encoding?: ProtocolEncoding;
  connectionIdFactory?: (socket: WebSocket) => string;
  server?: WebSocketServer;
  serverOptions?: WebSocketServerOptions;
  rendererMessageValidation?: ProtocolValidationLevel;
  simulatorMessageValidation?: ProtocolValidationLevel;
  onValidationWarning?: (warning: ProtocolValidationWarning) => void;
  onValidationError?: (error: unknown) => void;
  /** Optional non-invasive frame observer, useful for diagnostics and benchmark instrumentation. */
  onSimulatorMessage?: (message: SimulatorToRendererMessage, encodedBytes: number) => void;
  /** Optional non-invasive frame observer, useful for diagnostics and benchmark instrumentation. */
  onRendererMessage?: (message: RendererToSimulatorMessage, encodedBytes: number) => void;
}

export class WebSocketTransportHost {
  readonly server: WebSocketServer;
  readonly encoding: ProtocolEncoding;
  readonly ready: Promise<void>;
  private listeners: HttpServer[] = [];

  private readonly connectionIdFactory: (socket: WebSocket) => string;
  private readonly sessionFactory: () => SimulatorSession;
  private readonly rendererMessageValidation: ProtocolValidationLevel;
  private readonly simulatorMessageValidation: ProtocolValidationLevel;
  private readonly onValidationWarning?: (warning: ProtocolValidationWarning) => void;
  private readonly onValidationError?: (error: unknown) => void;
  private readonly onSimulatorMessage?: (
    message: SimulatorToRendererMessage,
    encodedBytes: number,
  ) => void;
  private readonly onRendererMessage?: (
    message: RendererToSimulatorMessage,
    encodedBytes: number,
  ) => void;
  private readonly sessions = new Map<WebSocket, () => Promise<void>>();
  private closePromise?: Promise<void>;
  private closing = false;

  constructor(options: WebSocketTransportHostOptions) {
    const family = parseIPFamily(options.ip_family);
    const managed =
      !options.server && !options.serverOptions?.server && !options.serverOptions?.noServer;
    const { port = 0, host, ...wsOptions } = options.serverOptions ?? {};
    this.server =
      options.server ??
      new WebSocketServer(managed ? { ...wsOptions, noServer: true } : options.serverOptions);
    const server = this.server;
    if (managed) {
      Object.defineProperty(this.server, 'address', {
        value: () => this.listeners[0]?.address() ?? null,
      });
      this.ready = listenIPServers(
        () => {
          const listener = createServer((_request, response) => {
            response.writeHead(426);
            response.end();
          });
          listener.on('upgrade', (request, socket, head) => {
            if (this.closing) {
              socket.destroy();
              return;
            }
            this.server.handleUpgrade(request, socket, head, (client) =>
              this.server.emit('connection', client, request),
            );
          });
          return listener;
        },
        { host, port, backlog: wsOptions.backlog, ip_family: family },
      ).then((listeners) => {
        this.listeners = listeners;
        if (!this.closing) this.server.emit('listening');
      });
    } else {
      this.ready = (async () => {
        if (family !== 'auto')
          throw new Error(
            'ip_family must be configured on the externally managed listener. Use auto when supplying an external server.',
          );
        if (server.options.noServer) {
          return;
        }
        if (!server.address())
          await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              server.off('listening', listening);
              server.off('error', failed);
              server.off('close', closed);
            };
            const listening = () => {
              cleanup();
              resolve();
            };
            const failed = (error: Error) => {
              cleanup();
              reject(error);
            };
            const closed = () => failed(new Error('WebSocket server closed before listening.'));
            server.once('listening', listening);
            server.once('error', failed);
            server.once('close', closed);
          });
      })();
    }
    void this.ready.catch((error) => {
      if (this.server.listenerCount('error')) this.server.emit('error', error);
    });
    this.encoding = options.encoding ?? 'json';
    this.sessionFactory = options.sessionFactory;
    this.connectionIdFactory = options.connectionIdFactory ?? (() => generateConnectionId('ws'));
    this.rendererMessageValidation = options.rendererMessageValidation ?? 'off';
    this.simulatorMessageValidation = options.simulatorMessageValidation ?? 'off';
    this.onValidationWarning = options.onValidationWarning;
    this.onValidationError = options.onValidationError;
    this.onSimulatorMessage = options.onSimulatorMessage;
    this.onRendererMessage = options.onRendererMessage;

    this.server.on('connection', (socket) => {
      if (this.closing) {
        void closeWebSocket(socket).catch((error) => this.reportError(error));
        return;
      }
      void this.handleConnection(socket).catch(async (error) => {
        this.reportError(error);
        await Promise.allSettled([closeWebSocket(socket), this.sessions.get(socket)?.()]);
        this.sessions.delete(socket);
      });
    });
  }

  get url(): string | undefined {
    if (this.server.options.noServer && !this.listeners.length) return undefined;
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      return undefined;
    }
    return listenerUrl(address);
  }

  get urls(): string[] {
    if (!this.listeners.length) return this.url ? [this.url] : [];
    return this.listeners.flatMap((listener) => {
      const address = listener.address();
      return address && typeof address !== 'string' ? [listenerUrl(address)] : [];
    });
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      this.closing = true;
      this.closePromise = this.closeResources();
    }
    return this.closePromise;
  }

  private async closeResources(): Promise<void> {
    // Stop accepting upgrades before taking the connection snapshot. All callers
    // await this same shutdown, including calls made while cleanup is in progress.
    const serverClosed = new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
    // Attach a rejection handler immediately while startup is still pending.
    const serverResult = Promise.allSettled([serverClosed]);
    await this.ready.catch(() => undefined);
    const results = await Promise.allSettled([
      closeIPServers(this.listeners),
      ...[...this.sessions].flatMap(([socket, closeSession]) => [
        closeWebSocket(socket),
        closeSession(),
      ]),
    ]);
    this.sessions.clear();
    const errors = [...(await serverResult), ...results].flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw Object.assign(new Error('WebSocket host cleanup failed.'), { errors });
  }

  private async handleConnection(socket: WebSocket): Promise<void> {
    const session = this.sessionFactory();
    let cleanup: Promise<void> | undefined;
    const closeSession = () =>
      (cleanup ??= Promise.resolve()
        .then(() => session.close())
        .catch((error) => this.reportError(error)));
    this.sessions.set(socket, closeSession);
    socket.once('close', () => {
      void closeSession().finally(() => this.sessions.delete(socket));
    });
    socket.on('error', (error) => {
      this.reportError(error);
      void closeWebSocket(socket).catch((cause) => this.reportError(cause));
      void closeSession();
    });
    const connectionId = this.connectionIdFactory(socket);
    const simulatorCodec = new ProtocolCodec({
      validation: {
        level: this.simulatorMessageValidation,
        direction: 'simulator-to-renderer',
        onWarning: this.onValidationWarning,
      },
    });
    const rendererCodec = new ProtocolCodec({
      validation: {
        level: this.rendererMessageValidation,
        direction: 'renderer-to-simulator',
        onWarning: this.onValidationWarning,
      },
    });

    session.attach(async (message) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      let encoded: string | Uint8Array;
      try {
        encoded = simulatorCodec.encode(message as AnyProtocolMessage, this.encoding);
      } catch (error) {
        this.reportError(error);
        throw error;
      }
      if (this.onSimulatorMessage)
        this.observeFrame(
          this.onSimulatorMessage,
          message as SimulatorToRendererMessage,
          webSocketByteLength(encoded),
        );
      socket.send(typeof encoded === 'string' ? encoded : Buffer.from(encoded));
    }, connectionId);

    socket.on('message', (data, isBinary) => {
      const normalized = normalizeWebSocketData(data, isBinary);
      let decoded: RendererToSimulatorMessage;
      try {
        decoded = rendererCodec.decode(normalized) as RendererToSimulatorMessage;
      } catch (error) {
        this.reportError(error);
        void session.emitter
          .error({
            code: 'protocol_validation_failed',
            message: error instanceof Error ? error.message : String(error),
          })
          .catch((cause) => this.reportError(cause));
        return;
      }
      if (this.onRendererMessage)
        this.observeFrame(this.onRendererMessage, decoded, webSocketByteLength(data));
      void session.dispatch(decoded).catch((error) => {
        void session.emitter
          .error({
            code: 'dispatch_failed',
            message: error instanceof Error ? error.message : String(error),
          })
          .catch((cause) => this.reportError(cause));
      });
    });

    await session.open(connectionId);
  }

  private reportError(error: unknown): void {
    // Diagnostics cannot break delivery or turn cleanup into an unhandled rejection.
    try {
      this.onValidationError?.(error);
    } catch {
      // The diagnostic callback owns its own reporting failures.
    }
  }

  private observeFrame<TMessage>(
    observer: ((message: TMessage, encodedBytes: number) => void) | undefined,
    message: TMessage,
    encodedBytes: number,
  ): void {
    try {
      observer?.(message, encodedBytes);
    } catch (error) {
      // Instrumentation must not change a production transport's delivery semantics.
      this.reportError(error);
    }
  }
}

export function createWebSocketTransportHost(
  options: WebSocketTransportHostOptions,
): WebSocketTransportHost {
  return new WebSocketTransportHost(options);
}
