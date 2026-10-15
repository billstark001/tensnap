interface FileSignature {
  format: string;
  signature: number[][];
  offset?: number;
}

const FILE_SIGNATURES: FileSignature[] = [
  {
    format: 'png',
    signature: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  },
  {
    format: 'jpeg',
    signature: [[0xff, 0xd8, 0xff]], // SOI followed by any JPEG marker
  },
  {
    format: 'bmp',
    signature: [[0x42, 0x4d]], // "BM"
  },
  {
    format: 'pdf',
    signature: [[0x25, 0x50, 0x44, 0x46]], // "%PDF"
  },
  {
    format: 'npy',
    signature: [[0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]], // "\x93NUMPY"
  },
];

function matchesSignature(bytes: Uint8Array, signature: number[], offset: number = 0): boolean {
  if (bytes.length < offset + signature.length) {
    return false;
  }

  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) {
      return false;
    }
  }

  return true;
}

/** Identify a supported binary format from its magic bytes, or return null. */
export function detectFileFormat(input: Uint8Array): string | null {
  for (const { format, signature, offset = 0 } of FILE_SIGNATURES) {
    for (const sig of signature) {
      if (matchesSignature(input, sig, offset)) {
        return format;
      }
    }
  }

  return null;
}
