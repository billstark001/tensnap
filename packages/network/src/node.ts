import { lookup } from 'node:dns/promises';
import { isIP, type Server, type AddressInfo } from 'node:net';
import { parseIPFamily, validateIPFamily, type IPFamily } from './index.js';

export { waitForWebSocketOpen, closeWebSocket } from './websocket.js';
export type { NodeWebSocket, WebSocketOpenOptions, WebSocketCloseOptions } from './websocket.js';

/** Count wire bytes without decoding, copying, or concatenating fragmented frames. */
export function webSocketByteLength(
  data: string | Uint8Array | ArrayBuffer | readonly Uint8Array[],
): number {
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (Array.isArray(data)) {
    let bytes = 0;
    for (const fragment of data) bytes += fragment.byteLength;
    return bytes;
  }
  return (data as Uint8Array | ArrayBuffer).byteLength;
}

/** Preserve binary frame views; text frames may arrive as buffers or fragments in ws. */
export function normalizeWebSocketData(
  data: string | Uint8Array | ArrayBuffer | Uint8Array[],
  isBinary: boolean,
): string | Uint8Array | ArrayBuffer {
  if (isBinary) return Array.isArray(data) ? Buffer.concat(data) : data;
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  // Decode directly from a Buffer or byte view; copying every text frame is unnecessary.
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  const bytes =
    data instanceof ArrayBuffer
      ? Buffer.from(data)
      : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return bytes.toString('utf8');
}

export interface ListenIPOptions {
  host?: string;
  port: number;
  ip_family?: IPFamily;
  backlog?: number;
}

/** Only absence of a local address family permits auto to degrade. Never hide EADDRINUSE. */
export function unavailableIPFamily(error: unknown): boolean {
  return ['EAFNOSUPPORT', 'EPROTONOSUPPORT', 'EADDRNOTAVAIL'].includes(
    (error as NodeJS.ErrnoException | null)?.code ?? '',
  );
}

export async function listenIPServers<T extends Server>(
  createServer: () => T,
  options: ListenIPOptions,
): Promise<T[]> {
  const family = parseIPFamily(options.ip_family);
  const host = (options.host ?? '').replace(/^\[|\]$/g, '');
  validateIPFamily(host, family);
  let targets: Array<{ address: string; family: number }>;
  const literalFamily = isIP(host);
  if (!host || host.toLowerCase() === 'localhost') {
    targets = [
      { address: host ? '127.0.0.1' : '0.0.0.0', family: 4 },
      { address: host ? '::1' : '::', family: 6 },
    ];
  } else if (literalFamily) targets = [{ address: host, family: literalFamily }];
  else
    targets = await lookup(host, {
      all: true,
      family: family === 'ipv4' ? 4 : family === 'ipv6' ? 6 : 0,
    });
  const seen = new Set<string>();
  targets = targets.filter((target) => {
    if (
      (family !== 'auto' && target.family !== (family === 'ipv4' ? 4 : 6)) ||
      seen.has(target.address)
    )
      return false;
    seen.add(target.address);
    return true;
  });
  if (!targets.length) throw new Error(`No ${family} listen address for ${host}.`);
  const servers: T[] = [];
  let port = options.port;
  try {
    for (const target of targets) {
      const server = createServer();
      try {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            server.off('listening', ready);
            server.off('error', error);
          };
          const error = (cause: Error) => {
            cleanup();
            reject(cause);
          };
          const ready = () => {
            cleanup();
            resolve();
          };
          server.once('error', error);
          server.once('listening', ready);
          try {
            server.listen({
              host: target.address,
              port,
              backlog: options.backlog,
              ipv6Only: target.family === 6,
            });
          } catch (cause) {
            cleanup();
            reject(cause);
          }
        });
        servers.push(server);
        port = (server.address() as AddressInfo).port;
      } catch (error) {
        if (!servers.includes(server)) await closeIPServers([server]);
        if (
          family === 'auto' &&
          (!host || host.toLowerCase() === 'localhost') &&
          unavailableIPFamily(error)
        )
          continue;
        throw error;
      }
    }
    if (!servers.length) throw new Error('No available IP listen address.');
    return servers;
  } catch (error) {
    try {
      await closeIPServers(servers);
    } catch (cleanupError) {
      throw Object.assign(new Error('Listener startup and rollback failed.'), {
        cause: error,
        errors: [error, cleanupError],
      });
    }
    throw error;
  }
}

export async function closeIPServers(servers: readonly Server[]): Promise<void> {
  const results = await Promise.allSettled(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw Object.assign(new Error('Listener cleanup failed.'), { errors });
}
