import { describe, expect, it } from 'vitest';
import { detectFileFormat } from './format-detector';

describe('detectFileFormat', () => {
  it('detects known binary signatures', () => {
    expect(detectFileFormat(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))).toBe('png');
    expect(detectFileFormat(new Uint8Array([0xFF, 0xD8, 0xFF, 0xDB]))).toBe('jpeg');
    expect(detectFileFormat(new Uint8Array([0x42, 0x4D, 0x00, 0x00]))).toBe('bmp');
    expect(detectFileFormat(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]))).toBe('pdf');
    expect(detectFileFormat(new Uint8Array([0x93, 0x4E, 0x55, 0x4D, 0x50, 0x59]))).toBe('npy');
  });

  it('returns null for unknown or truncated signatures', () => {
    expect(detectFileFormat(new Uint8Array([0x89, 0x50, 0x4E]))).toBeNull();
    expect(detectFileFormat(new Uint8Array([0x00, 0x11, 0x22, 0x33]))).toBeNull();
  });
});