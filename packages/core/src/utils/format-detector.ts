/**
 * 文件格式检测器
 * 通过读取文件头部的魔数（magic bytes）来识别文件格式
 */

interface FileSignature {
  format: string;
  signature: number[][];
  offset?: number;
}

/**
 * 各种文件格式的魔数签名
 */
const FILE_SIGNATURES: FileSignature[] = [
  {
    format: 'png',
    signature: [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]]
  },
  {
    format: 'jpeg',
    signature: [
      [0xFF, 0xD8, 0xFF, 0xE0], // JPEG JFIF
      [0xFF, 0xD8, 0xFF, 0xE1], // JPEG Exif
      [0xFF, 0xD8, 0xFF, 0xE2], // JPEG
      [0xFF, 0xD8, 0xFF, 0xE3], // JPEG
      [0xFF, 0xD8, 0xFF, 0xDB], // JPEG raw
      [0xFF, 0xD8, 0xFF, 0xEE]  // JPEG
    ]
  },
  {
    format: 'bmp',
    signature: [[0x42, 0x4D]] // "BM"
  },
  {
    format: 'pdf',
    signature: [[0x25, 0x50, 0x44, 0x46]] // "%PDF"
  },
  {
    format: 'npy',
    signature: [[0x93, 0x4E, 0x55, 0x4D, 0x50, 0x59]] // "\x93NUMPY"
  }
];

/**
 * 检查字节数组是否匹配给定的签名
 */
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

export function detectFileFormat(
  input: Uint8Array,
): string | null {
  for (const { format, signature, offset = 0 } of FILE_SIGNATURES) {
    for (const sig of signature) {
      if (matchesSignature(input, sig, offset)) {
        return format;
      }
    }
  }

  return null;
}
