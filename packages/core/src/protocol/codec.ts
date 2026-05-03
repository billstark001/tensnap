import { decode, encode } from '@msgpack/msgpack';
import { decodeBinaryString, encodeBytesAsDataUrl } from '../utils/binary';
import {
  AssetDataPayloadSchema,
  ScreenshotResponsePayloadSchema,
} from './schemas';
import type { AnyProtocolMessage } from './types';

export type ProtocolEncoding = 'json' | 'msgpack';

export function detectProtocolEncoding(data: string | Uint8Array | ArrayBuffer): ProtocolEncoding {
  return typeof data === 'string' ? 'json' : 'msgpack';
}

export function encodeProtocolMessage(
  message: AnyProtocolMessage,
  encoding: ProtocolEncoding,
): string | Uint8Array {
  const normalized = normalizeBinarySemanticMessage(message, encoding);
  return encoding === 'json' ? JSON.stringify(normalized) : encode(normalized);
}

export function decodeProtocolMessage(data: string | Uint8Array | ArrayBuffer): AnyProtocolMessage {
  if (typeof data === 'string') {
    return normalizeDecodedBinarySemanticMessage(JSON.parse(data) as AnyProtocolMessage);
  }

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return normalizeDecodedBinarySemanticMessage(decode(bytes) as AnyProtocolMessage);
}

function normalizeBinarySemanticMessage(
  message: AnyProtocolMessage,
  encoding: ProtocolEncoding,
): AnyProtocolMessage {
  switch (message.type) {
    case 'asset_data': {
      const payload = AssetDataPayloadSchema.parse(message.payload);
      return {
        ...message,
        payload: {
          ...payload,
          data: normalizeBinaryDataForEncoding(payload.data, payload.mime, encoding),
        },
      };
    }
    case 'screenshot_response': {
      const payload = ScreenshotResponsePayloadSchema.parse(message.payload);
      return {
        ...message,
        payload: {
          ...payload,
          data: typeof payload.data === 'undefined'
            ? undefined
            : normalizeBinaryDataForEncoding(payload.data, payload.mime, encoding),
        },
      };
    }
    default:
      return message;
  }
}

function normalizeDecodedBinarySemanticMessage(message: AnyProtocolMessage): AnyProtocolMessage {
  switch (message.type) {
    case 'asset_data': {
      const payload = AssetDataPayloadSchema.parse(message.payload);
      return {
        ...message,
        payload: {
          ...payload,
          data: typeof payload.data === 'string' ? decodeBinaryString(payload.data).bytes : payload.data,
        },
      };
    }
    case 'screenshot_response': {
      const payload = ScreenshotResponsePayloadSchema.parse(message.payload);
      return {
        ...message,
        payload: {
          ...payload,
          data: typeof payload.data === 'string' ? decodeBinaryString(payload.data).bytes : payload.data,
        },
      };
    }
    default:
      return message;
  }
}

function normalizeBinaryDataForEncoding(
  value: string | Uint8Array,
  mime: string | undefined,
  encoding: ProtocolEncoding,
): string | Uint8Array {
  if (encoding === 'json') {
    return typeof value === 'string'
      ? value
      : encodeBytesAsDataUrl(value, mime ?? 'application/octet-stream');
  }

  return typeof value === 'string' ? decodeBinaryString(value).bytes : value;
}