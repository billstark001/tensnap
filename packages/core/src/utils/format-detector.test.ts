import { describe, expect, it } from 'vitest';
import { detectFileFormat } from './format-detector';

describe('detectFileFormat', () => {
  it('detects known binary signatures', () => {
    expect(detectFileFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'png',
    );
    expect(detectFileFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBe('jpeg');
    expect(detectFileFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe4]))).toBe('jpeg');
    expect(detectFileFormat(new Uint8Array([0x42, 0x4d, 0x00, 0x00]))).toBe('bmp');
    expect(detectFileFormat(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe('pdf');
    expect(detectFileFormat(new Uint8Array([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]))).toBe('npy');
  });

  it('returns null for unknown or truncated signatures', () => {
    expect(detectFileFormat(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
    expect(detectFileFormat(new Uint8Array([0x00, 0x11, 0x22, 0x33]))).toBeNull();
  });
});
