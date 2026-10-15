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
export function encodeBytesAsDataUrl(bytes: Uint8Array, mime = 'application/octet-stream'): string {
  return `data:${mime};base64,${encodeBytesAsBase64(bytes)}`;
}

/** Decode an unprefixed base64 string or base64 data URL into semantic bytes. */
export function decodeBinaryString(value: string): DecodedBinaryString {
  const parsed = parseBinaryString(value);
  if (!parsed) {
    throw new Error('Expected a base64 string or a base64 data URL.');
  }
  const { base64, ...metadata } = parsed;
  return { ...metadata, bytes: decodeBase64(base64) };
}

/** Validate base64 syntax without decoding or allocating the binary payload. */
export function isEncodedBinaryString(value: string): boolean {
  return parseBinaryString(value) !== null;
}

function parseBinaryString(
  value: string,
): (Omit<DecodedBinaryString, 'bytes'> & { base64: string }) | null {
  let mime: string | undefined;
  let encoding: DecodedBinaryString['encoding'] = 'base64';
  if (value.startsWith('data:')) {
    const markerIndex = value.indexOf(BASE64_DATA_URL_MARKER);
    if (markerIndex === -1) return null;
    mime = value.slice(5, markerIndex) || undefined;
    value = value.slice(markerIndex + BASE64_DATA_URL_MARKER.length);
    encoding = 'data-url';
  }

  const base64 = value.replace(/\s+/g, '');
  if (base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(base64)) {
    return null;
  }
  const paddingIndex = base64.indexOf('=');
  if (
    paddingIndex !== -1 &&
    (paddingIndex < base64.length - 2 || /[^=]/.test(base64.slice(paddingIndex)))
  ) {
    return null;
  }

  return { base64, ...(encoding === 'data-url' ? { mime } : {}), encoding };
}

/** Decode already validated input identically in Node and browser hosts. */
function decodeBase64(value: string): Uint8Array {
  const buffer = getGlobalBuffer();
  if (buffer) {
    return new Uint8Array(buffer.from(value, 'base64'));
  }

  if (typeof atob === 'function') {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  throw new Error('No base64 decoder is available in this runtime.');
}
