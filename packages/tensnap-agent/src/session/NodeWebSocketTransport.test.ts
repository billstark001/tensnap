import { describe, expect, it, vi } from 'vitest';
import { encodeProtocolMessage, decodeProtocolMessage, type AnyProtocolMessage } from '@tensnap/protocol';
import { NodeWebSocketTransport, normalizeRawData } from './NodeWebSocketTransport';

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

  it('emits one warning and continues for invalid inbound messages in warning mode', () => {
    const transport = new NodeWebSocketTransport('ws://test', 'json', { serverMessages: 'warning' });
    const warning = vi.fn();
    const message = vi.fn();
    transport.on('validation-warning', warning);
    transport.on('message', message);

    (transport as unknown as { handleMessage(data: string): void }).handleMessage(JSON.stringify({
      type: 'metadata_update',
      payload: { time: 'invalid' },
    }));

    expect(warning).toHaveBeenCalledTimes(1);
    expect(message).toHaveBeenCalledTimes(1);
  });

  it('emits an error and rejects invalid inbound messages in error mode', () => {
    const transport = new NodeWebSocketTransport('ws://test', 'json', { serverMessages: 'error' });
    const error = vi.fn();
    const message = vi.fn();
    transport.on('error', error);
    transport.on('message', message);

    (transport as unknown as { handleMessage(data: string): void }).handleMessage(JSON.stringify({
      type: 'metadata_update',
      payload: { time: 'invalid' },
    }));

    expect(error).toHaveBeenCalledTimes(1);
    expect(message).not.toHaveBeenCalled();
  });
});
