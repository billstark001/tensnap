import { decode, encode } from '@msgpack/msgpack';
import type { AnyProtocolMessage } from './types';

export type ProtocolEncoding = 'json' | 'msgpack';

export function detectProtocolEncoding(data: string | Uint8Array | ArrayBuffer): ProtocolEncoding {
  return typeof data === 'string' ? 'json' : 'msgpack';
}

export function encodeProtocolMessage(
  message: AnyProtocolMessage,
  encoding: ProtocolEncoding,
): string | Uint8Array {
  return encoding === 'json' ? JSON.stringify(message) : encode(message);
}

export function decodeProtocolMessage(data: string | Uint8Array | ArrayBuffer): AnyProtocolMessage {
  if (typeof data === 'string') {
    return JSON.parse(data) as AnyProtocolMessage;
  }

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return decode(bytes) as AnyProtocolMessage;
}