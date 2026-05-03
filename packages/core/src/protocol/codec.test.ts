import { describe, expect, it } from 'vitest';
import { encodeProtocolMessage, decodeProtocolMessage } from './codec';
import { AssetDataPayloadSchema, ItemDeletePayloadSchema, ScreenshotResponsePayloadSchema } from './schemas';

describe('protocol binary semantic fields', () => {
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
    const decoded = decodeProtocolMessage(JSON.stringify({
      type: 'screenshot_response',
      payload: {
        request_id: 'req-1',
        mime: 'image/png',
        data: 'AAECAw==',
      },
    }));

    expect(decoded.type).toBe('screenshot_response');
    if (decoded.type !== 'screenshot_response') {
      throw new Error('Expected screenshot_response payload.');
    }
    const screenshotPayload = decoded.payload as { data: Uint8Array };
    expect(screenshotPayload.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(screenshotPayload.data)).toEqual([0, 1, 2, 3]);
  });
});