import { deepStrictEqual } from 'node:assert';
import { describe, expect, it, vi } from 'vitest';
import {
  decodeProtocolMessage,
  decodeMessagePack,
  encodeMessagePack,
  encodeProtocolMessage,
  ProtocolCodec,
  ProtocolValidationError,
  type ProtocolValidationWarning,
} from './codec';
import {
  AssetDataPayloadSchema,
  ItemDeletePayloadSchema,
  RendererToSimulatorMessageSchema,
  SimulatorToRendererMessageSchema,
  ScreenshotResponsePayloadSchema,
} from './schemas';
import type { AnyProtocolMessage } from './types';

describe('session codec ownership and reuse', () => {
  it.each(['strict', 'legacy'] as const)(
    'preserves optional map fields and array positions in %s mode without mutating inputs',
    (mode) => {
      // Undefined nested values are outside validated ProtocolValue, but the
      // validation-off encoder still preserves its existing JSON-like behavior.
      const data = {
        absent: undefined,
        nested: { present: 1, absent: undefined },
        list: [undefined, null, { present: false, absent: undefined }],
        sparse: Object.assign(Array<unknown>(2), { 1: 'tail' }),
      };
      const message = {
        type: 'item_update',
        payload: { env_id: 'env', layer_id: 'agents', items: [{ id: 'a', data }] },
      } as unknown as AnyProtocolMessage;
      const codec = new ProtocolCodec({ mode });
      const expected = JSON.parse(JSON.stringify(message));
      for (const encoding of ['json', 'msgpack'] as const) {
        expect(codec.decode(codec.encode(message, encoding))).toEqual(expected);
      }
      expect(Object.prototype.hasOwnProperty.call(data, 'absent')).toBe(true);
      expect(data.list[0]).toBeUndefined();
      expect(0 in data.sparse).toBe(false);
    },
  );

  it('retains earlier encoded frames across buffer growth and other sessions', () => {
    const first = { type: 'error', payload: { code: 'first', message: 'one' } } as const;
    const codec = new ProtocolCodec();
    const encoded = codec.encode(first, 'msgpack') as Uint8Array;
    const saved = encoded.slice();
    const other = new ProtocolCodec();
    for (const size of [8, 8192, 2 * 1024 * 1024, 8]) {
      const message: AnyProtocolMessage = {
        type: 'asset_data',
        payload: {
          id: 'asset',
          hash: 'hash',
          mime: 'application/octet-stream',
          data: new Uint8Array(size).fill(7),
        },
      };
      const frame = codec.encode(message, 'msgpack');
      // Native assertions compare the full byte array without enumerating millions
      // of indexed properties through the assertion library on slower CI runners.
      deepStrictEqual(codec.decode(frame), message);
      other.encode(message, 'msgpack');
      expect(encoded).toEqual(saved);
      expect(codec.decode(encoded)).toEqual(first);
    }
    const padded = new Uint8Array(encoded.byteLength + 8);
    padded.set(encoded, 4);
    expect(codec.decode(padded.subarray(4, 4 + encoded.byteLength))).toEqual(first);
    expect(codec.decode(encoded.slice().buffer as ArrayBuffer)).toEqual(first);
  });

  it('recovers after failed encoding and decoding without changing previous results', () => {
    const codec = new ProtocolCodec();
    const message = { type: 'error', payload: { code: 'first', message: 'three' } } as const;
    const encoded = codec.encode(message, 'msgpack') as Uint8Array;
    const previous = codec.decode(encoded);
    // Includes a truncated nested container and trailing bytes after a valid frame.
    for (const invalid of [
      encoded.subarray(0, 4),
      new Uint8Array([0x81, 0xa1, 0x78, 0x92, 1]),
      new Uint8Array([...encoded, 0]),
    ]) {
      expect(() => codec.decode(invalid)).toThrow();
      expect(codec.decode(encoded)).toEqual(message);
    }
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() =>
      codec.encode(
        { type: 'item_update', payload: circular } as unknown as AnyProtocolMessage,
        'msgpack',
      ),
    ).toThrow();
    codec.decode(
      codec.encode({ type: 'error', payload: { code: 'next', message: 'nine' } }, 'msgpack'),
    );
    expect(previous).toEqual(message);
    expect(codec.decode(codec.encode(message, 'msgpack'))).toEqual(message);
  });

  it('keeps decoded binary data stable when the decoder is reused', () => {
    const codec = new ProtocolCodec();
    const message: AnyProtocolMessage = {
      type: 'asset_data',
      payload: {
        id: 'asset',
        hash: 'hash',
        mime: 'application/octet-stream',
        data: new Uint8Array([1, 2, 3]),
      },
    };
    const decoded = codec.decode(codec.encode(message, 'msgpack'));
    codec.decode(
      codec.encode({ type: 'error', payload: { code: 'next', message: 'four' } }, 'msgpack'),
    );
    expect(decoded).toEqual(message);
  });

  it('preserves generic persistence helper semantics for undefined map values', () => {
    expect(decodeMessagePack(encodeMessagePack({ field: undefined, list: [undefined] }))).toEqual({
      field: null,
      list: [null],
    });
  });
});

describe('protocol runtime validation', () => {
  const invalidRendererMessage = {
    type: 'action_invoke',
    payload: { id: 'step' },
  } as unknown as AnyProtocolMessage;

  it('is disabled by default', () => {
    expect(() => encodeProtocolMessage(invalidRendererMessage, 'json')).not.toThrow();
    expect(decodeProtocolMessage(JSON.stringify(invalidRendererMessage))).toEqual(
      invalidRendererMessage,
    );
  });

  it('reports one warning and continues in warning mode', () => {
    const warnings: ProtocolValidationWarning[] = [];
    const encoded = encodeProtocolMessage(invalidRendererMessage, 'json', {
      validation: {
        level: 'warning',
        direction: 'renderer-to-simulator',
        onWarning: (warning) => warnings.push(warning),
      },
    });

    expect(JSON.parse(encoded as string)).toEqual(invalidRendererMessage);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      level: 'warning',
      direction: 'renderer-to-simulator',
    });
  });

  it('keeps warning observers non-fatal', () => {
    expect(() =>
      encodeProtocolMessage(invalidRendererMessage, 'json', {
        validation: {
          level: 'warning',
          direction: 'renderer-to-simulator',
          onWarning: () => {
            throw new Error('observer failed');
          },
        },
      }),
    ).not.toThrow();
  });

  it('throws a typed error in error mode', () => {
    expect(() =>
      encodeProtocolMessage(invalidRendererMessage, 'json', {
        validation: { level: 'error', direction: 'renderer-to-simulator' },
      }),
    ).toThrow(ProtocolValidationError);
  });

  it('runs at most one envelope validation per message', () => {
    const validation = vi.spyOn(RendererToSimulatorMessageSchema, 'safeParse');
    expect(() =>
      encodeProtocolMessage(invalidRendererMessage, 'json', {
        validation: { level: 'warning', direction: 'renderer-to-simulator' },
      }),
    ).not.toThrow();
    expect(validation).toHaveBeenCalledTimes(1);

    validation.mockClear();
    expect(() =>
      decodeProtocolMessage(JSON.stringify(invalidRendererMessage), {
        validation: { level: 'warning', direction: 'renderer-to-simulator' },
      }),
    ).not.toThrow();
    expect(validation).toHaveBeenCalledTimes(1);
    validation.mockRestore();
  });

  it('does not re-parse binary payloads during semantic normalization', () => {
    const envelopeValidation = vi.spyOn(SimulatorToRendererMessageSchema, 'safeParse');
    const payloadValidation = vi.spyOn(AssetDataPayloadSchema, 'parse');
    encodeProtocolMessage(
      {
        type: 'asset_data',
        payload: {
          id: 'asset-1',
          hash: 'hash-1',
          mime: 'image/png',
          data: new Uint8Array([0, 1, 2, 3]),
        },
      },
      'json',
      {
        validation: { level: 'error', direction: 'simulator-to-renderer' },
      },
    );

    expect(envelopeValidation).toHaveBeenCalledTimes(1);
    expect(payloadValidation).not.toHaveBeenCalled();
    envelopeValidation.mockRestore();
    payloadValidation.mockRestore();
  });
});

describe('protocol binary semantic fields', () => {
  it('normalizes optional undefined fields identically for JSON and MessagePack', () => {
    const message: AnyProtocolMessage = {
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'test', version: '0.3.0' },
        model: { id: 'model', version: undefined, state_schema_version: undefined },
        instance_id: 'instance',
        capabilities: [],
        capability_details: undefined,
      },
    };
    const options = {
      validation: { level: 'error' as const, direction: 'simulator-to-renderer' as const },
    };
    const json = decodeProtocolMessage(encodeProtocolMessage(message, 'json', options), options);
    const messagePack = decodeProtocolMessage(
      encodeProtocolMessage(message, 'msgpack', options),
      options,
    );
    expect(messagePack).toEqual(json);
    expect(messagePack).toEqual({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'test', version: '0.3.0' },
        model: { id: 'model' },
        instance_id: 'instance',
        capabilities: [],
      },
    });
  });

  it('encodes JSON binary payloads as data URLs and decodes them back to bytes', () => {
    const source = new Uint8Array([0, 1, 2, 3]);
    const message = {
      type: 'asset_data',
      payload: {
        id: 'asset-1',
        hash: 'hash-1',
        mime: 'image/png',
        data: source,
      },
    } as const;

    const encoded = encodeProtocolMessage(message, 'json');
    expect(typeof encoded).toBe('string');

    const parsed = JSON.parse(encoded as string);
    expect(parsed.payload.data).toBe('data:image/png;base64,AAECAw==');

    const decoded = decodeProtocolMessage(encoded);
    expect(decoded.type).toBe('asset_data');
    if (decoded.type !== 'asset_data') {
      throw new Error('Expected asset_data payload.');
    }
    const assetPayload = decoded.payload as { data: Uint8Array };
    expect(assetPayload.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(assetPayload.data)).toEqual(Array.from(source));
  });

  it('accepts explicit JSON binary strings and rejects arbitrary text', () => {
    expect(() => {
      AssetDataPayloadSchema.parse({
        id: 'asset-1',
        hash: 'hash-1',
        mime: 'image/png',
        data: 'not-binary',
      });
    }).toThrow('base64');

    expect(() => {
      ScreenshotResponsePayloadSchema.parse({
        request_id: 'req-1',
        mime: 'image/png',
        data: 'data:image/png;base64,AAECAw==',
      });
    }).not.toThrow();

    expect(() => {
      ItemDeletePayloadSchema.parse({
        env_id: 'env-1',
        layer_id: 'agents',
        items: ['a1', 'a2'],
      });
    }).not.toThrow();

    expect(() => {
      ItemDeletePayloadSchema.parse({
        env_id: 'env-1',
        layer_id: 'agents',
        items: ['a1', { id: 'a2' }],
      });
    }).toThrow();
  });

  it('normalizes base64 JSON binary payloads back into bytes on decode', () => {
    const decoded = decodeProtocolMessage(
      JSON.stringify({
        type: 'screenshot_response',
        payload: {
          request_id: 'req-1',
          mime: 'image/png',
          data: 'AAECAw==',
        },
      }),
    );

    expect(decoded.type).toBe('screenshot_response');
    if (decoded.type !== 'screenshot_response') {
      throw new Error('Expected screenshot_response payload.');
    }
    const screenshotPayload = decoded.payload as { data: Uint8Array };
    expect(screenshotPayload.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(screenshotPayload.data)).toEqual([0, 1, 2, 3]);
  });
});

describe('legacy session codec', () => {
  it('keeps v0.2 state-sync correlation inside one codec session', () => {
    const codec = new ProtocolCodec({ mode: 'legacy', validation: { level: 'error' } });
    const encoded = codec.encode(
      {
        type: 'state_sync',
        payload: {
          request_id: 'legacy-sync-1',
          model_id: 'legacy',
          instance_id: 'legacy-instance',
          state_revision: 'old',
          metadata_revision: 'old-metadata',
          parameters: [],
          actions: [],
          envs: [],
          charts: [],
          monitors: [],
        },
      },
      'json',
    ) as string;

    expect(JSON.parse(encoded).payload).toEqual({
      request_id: 'legacy-sync-1',
      parameters: [],
      actions: [],
      envs: [],
      charts: [],
    });

    expect(codec.decode(JSON.stringify({ type: 'state_sync_begin', payload: {} }))).toEqual({
      type: 'state_sync_begin',
      payload: {
        request_id: 'legacy-sync-1',
        model_id: 'legacy',
        instance_id: 'legacy',
        mode: 'replace',
      },
    });
    expect(codec.decode(JSON.stringify({ type: 'state_sync_end', payload: {} }))).toEqual({
      type: 'state_sync_end',
      payload: { request_id: 'legacy-sync-1', state_revision: 'legacy' },
    });
  });

  it('normalizes the legacy error envelope without leaking its old shape', () => {
    const codec = new ProtocolCodec({
      mode: 'legacy',
      validation: { level: 'error', direction: 'simulator-to-renderer' },
    });
    expect(
      codec.decode(JSON.stringify({ type: 'error', payload: { error: 'Model failed.' } })),
    ).toEqual({
      type: 'error',
      payload: { code: 'legacy_error', message: 'Model failed.' },
    });
  });

  it('decodes v0.2 chart clear operations as chart-group operations', () => {
    const codec = new ProtocolCodec({
      mode: 'legacy',
      validation: { level: 'error', direction: 'simulator-to-renderer' },
    });

    expect(
      codec.decode(
        JSON.stringify({
          type: 'chart_update',
          payload: { operations: [{ operation: 'clear', id: 'attendance' }] },
        }),
      ),
    ).toEqual({
      type: 'chart_update',
      payload: { operations: [{ operation: 'clear', kind: 'group', id: 'attendance' }] },
    });
  });
});
