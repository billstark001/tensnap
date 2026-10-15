import { describe, expect, it, vi } from 'vitest';
import {
  encodeProtocolMessage,
  decodeProtocolMessage,
  ProtocolCodec,
  type AnyProtocolMessage,
  type ProtocolValidationLevel,
} from '@tensnap/protocol';
import { NodeWebSocketTransport, normalizeRawData } from './NodeWebSocketTransport';

describe('NodeWebSocketTransport', () => {
  it.each(['json', 'msgpack'] as const)(
    'preserves current validation policy across successive %s frames',
    (encoding) => {
      const policy: {
        serverMessages: ProtocolValidationLevel;
        clientMessages: ProtocolValidationLevel;
      } = { serverMessages: 'off', clientMessages: 'off' };
      const transport = new NodeWebSocketTransport('ws://test', encoding, policy);
      const error = vi.fn();
      const message = vi.fn();
      const send = vi.fn();
      const codec = new ProtocolCodec();
      transport.on('error', error);
      transport.on('message', message);
      // Supply an open socket without introducing network timing into this test.
      Object.assign(transport, { socket: { send }, state: 'open' });
      const receive = (frame: string | Uint8Array) =>
        (transport as unknown as { handleMessage(data: string | Uint8Array): void }).handleMessage(
          frame,
        );
      const valid: AnyProtocolMessage = { type: 'metadata_update', payload: { time: 7 } };
      const invalid = {
        type: 'metadata_update',
        payload: { time: 'invalid' },
      } as unknown as AnyProtocolMessage;
      receive(codec.encode(invalid, encoding));
      expect(message).toHaveBeenCalledTimes(1);
      policy.serverMessages = 'error';
      receive(codec.encode(invalid, encoding));
      receive(codec.encode(valid, encoding));
      expect(error).toHaveBeenCalledTimes(1);
      expect(message).toHaveBeenCalledTimes(2);
      expect(message).toHaveBeenLastCalledWith(valid);

      for (const request_id of ['first', 'second']) {
        transport.send({ type: 'action_invoke', payload: { id: 'step', request_id } });
      }
      policy.clientMessages = 'error';
      expect(() =>
        transport.send({ type: 'action_invoke', payload: { id: 'step', request_id: '' } }),
      ).toThrow(/validation/i);
      for (const [index, request_id] of ['first', 'second'].entries()) {
        expect(codec.decode(send.mock.calls[index]![0])).toEqual({
          type: 'action_invoke',
          payload: { id: 'step', request_id },
        });
      }
      expect(send).toHaveBeenCalledTimes(2);
    },
  );

  it('normalizes JSON text frames delivered as buffers into strings', () => {
    const payload: AnyProtocolMessage = {
      type: 'metadata_update',
      payload: { time: 7 },
    };

    const normalized = normalizeRawData(Buffer.from(JSON.stringify(payload), 'utf8'), false);

    expect(typeof normalized).toBe('string');
    expect(decodeProtocolMessage(normalized)).toEqual(payload);
  });

  it('keeps binary msgpack frames as bytes', () => {
    const payload: AnyProtocolMessage = {
      type: 'metadata_update',
      payload: { time: 9 },
    };
    const encoded = encodeProtocolMessage(payload, 'msgpack') as Uint8Array;

    const normalized = normalizeRawData(Buffer.from(encoded), true);

    expect(normalized).toBeInstanceOf(Uint8Array);
    expect(decodeProtocolMessage(normalized)).toEqual(payload);
  });

  it('emits one warning and continues for invalid inbound messages in warning mode', () => {
    const transport = new NodeWebSocketTransport('ws://test', 'json', {
      serverMessages: 'warning',
    });
    const warning = vi.fn();
    const message = vi.fn();
    transport.on('validation-warning', warning);
    transport.on('message', message);

    (transport as unknown as { handleMessage(data: string): void }).handleMessage(
      JSON.stringify({
        type: 'metadata_update',
        payload: { time: 'invalid' },
      }),
    );

    expect(warning).toHaveBeenCalledTimes(1);
    expect(message).toHaveBeenCalledTimes(1);
  });

  it('emits an error and rejects invalid inbound messages in error mode', () => {
    const transport = new NodeWebSocketTransport('ws://test', 'json', { serverMessages: 'error' });
    const error = vi.fn();
    const message = vi.fn();
    transport.on('error', error);
    transport.on('message', message);

    (transport as unknown as { handleMessage(data: string): void }).handleMessage(
      JSON.stringify({
        type: 'metadata_update',
        payload: { time: 'invalid' },
      }),
    );

    expect(error).toHaveBeenCalledTimes(1);
    expect(message).not.toHaveBeenCalled();
  });
});
