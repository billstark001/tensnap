import { describe, expect, it } from 'vitest';
import { encodeProtocolMessage, decodeProtocolMessage, type AnyProtocolMessage } from '@tensnap/protocol';
import { normalizeRawData } from './NodeWebSocketTransport';

describe('NodeWebSocketTransport', () => {
  it('normalizes JSON text frames delivered as buffers into strings', () => {
    const payload: AnyProtocolMessage = {
      type: 'metadata_update',
      payload: { time: 7 },
    };

    const normalized = normalizeRawData(
      Buffer.from(JSON.stringify(payload), 'utf8'),
      false,
    );

    expect(typeof normalized).toBe('string');
    expect(decodeProtocolMessage(normalized)).toEqual(payload);
  });

  it('keeps binary msgpack frames as bytes', () => {
    const payload: AnyProtocolMessage = {
      type: 'metadata_update',
      payload: { time: 9 },
    };
    const encoded = encodeProtocolMessage(payload, 'msgpack') as Uint8Array;

    const normalized = normalizeRawData(
      Buffer.from(encoded),
      true,
    );

    expect(normalized).toBeInstanceOf(Uint8Array);
    expect(decodeProtocolMessage(normalized)).toEqual(payload);
  });
});