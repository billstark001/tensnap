const BASE64_DATA_URL_MARKER = ';base64,';

interface BufferEncoderResult {
  toString(encoding: 'base64'): string;
}

interface BufferLike {
  from(data: Uint8Array): BufferEncoderResult;
  from(data: string, encoding: 'base64'): ArrayLike<number>;
}

export interface DecodedBinaryString {
  bytes: Uint8Array;
  mime?: string;
  encoding: 'base64' | 'data-url';
}

function getGlobalBuffer(): BufferLike | undefined {
  return (globalThis as { Buffer?: BufferLike }).Buffer;
}

/** Encode bytes as unprefixed base64 for storage or an enclosing data URL. */
export function encodeBytesAsBase64(bytes: Uint8Array): string {
  const buffer = getGlobalBuffer();
  if (buffer) {
    return buffer.from(bytes).toString('base64');
  }

  if (typeof btoa === 'function') {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
  }

  throw new Error('No base64 encoder is available in this runtime.');
}

/** Encode bytes as the JSON wire representation for a binary protocol field. */
export function encodeBytesAsDataUrl(
  bytes: Uint8Array,
  mime = 'application/octet-stream',
): string {
  return `data:${mime};base64,${encodeBytesAsBase64(bytes)}`;
}

/** Decode an unprefixed base64 string or base64 data URL into semantic bytes. */
export function decodeBinaryString(value: string): DecodedBinaryString {
  const decoded = tryDecodeBinaryString(value);
  if (!decoded) {
    throw new Error('Expected a base64 string or a base64 data URL.');
  }
  return decoded;
}

/** Whether a string is a valid unprefixed base64 value or base64 data URL. */
export function isEncodedBinaryString(value: string): boolean {
  return tryDecodeBinaryString(value) !== null;
}

function tryDecodeBinaryString(value: string): DecodedBinaryString | null {
  if (value.startsWith('data:')) {
    const dataUrl = tryDecodeBase64DataUrl(value);
    if (dataUrl) {
      return dataUrl;
    }
  }

  const bytes = tryDecodeBase64(value);
  if (!bytes) {
    return null;
  }

  return {
    bytes,
    encoding: 'base64',
  };
}

function tryDecodeBase64DataUrl(value: string): DecodedBinaryString | null {
  const markerIndex = value.indexOf(BASE64_DATA_URL_MARKER);
  if (markerIndex === -1) {
    return null;
  }

  const mime = value.slice(5, markerIndex) || undefined;
  const base64 = value.slice(markerIndex + BASE64_DATA_URL_MARKER.length);
  const bytes = tryDecodeBase64(base64);
  if (!bytes) {
    return null;
  }

  return {
    bytes,
    mime,
    encoding: 'data-url',
  };
}

function tryDecodeBase64(value: string): Uint8Array | null {
  const normalized = value.replace(/\s+/g, '');
  if (!normalized || normalized.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(normalized)) {
    return null;
  }

  try {
    const buffer = getGlobalBuffer();
    if (buffer) {
      return new Uint8Array(buffer.from(normalized, 'base64'));
    }

    if (typeof atob === 'function') {
      const binary = atob(normalized);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    }
  } catch {
    return null;
  }

  throw new Error('No base64 decoder is available in this runtime.');
}
