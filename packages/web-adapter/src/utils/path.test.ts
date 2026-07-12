import { describe, expect, it } from 'vitest';
import {
  calculateChecksum,
  getBaseName,
  getParentPath,
  getPathComponents,
  getPathDepth,
  joinPath,
  normalizePath,
  validatePath,
} from './path';

describe('path utils', () => {
  it('normalizes slashes and ensures an absolute path', () => {
    expect(normalizePath('foo\\bar//baz/')).toBe('/foo/bar/baz');
    expect(normalizePath('/')).toBe('/');
  });

  it('joins path segments consistently', () => {
    expect(joinPath('/projects/', 'demo', 'model.json')).toBe('/projects/demo/model.json');
  });

  it('derives parent and basename metadata', () => {
    expect(getParentPath('/projects/demo/model.json')).toBe('/projects/demo');
    expect(getBaseName('/projects/demo/model.json')).toBe('model.json');
    expect(getPathDepth('/projects/demo/model.json')).toBe(3);
    expect(getPathComponents('/projects/demo/model.json')).toEqual(['projects', 'demo', 'model.json']);
  });

  it('validates supported paths', () => {
    expect(validatePath('/projects/demo')).toBe(true);
    expect(validatePath('../secret')).toBe(false);
  });

  it('produces the same checksum for equivalent text content', () => {
    const text = 'hello tensnap';
    const bytes = new TextEncoder().encode(text);

    expect(calculateChecksum(text)).toBe(calculateChecksum(bytes));
    expect(calculateChecksum(text)).toBe(calculateChecksum(bytes.buffer));
  });

  it('hashes raw bytes without lossy text decoding', () => {
    expect(calculateChecksum(new Uint8Array([0x80])))
      .not.toBe(calculateChecksum(new Uint8Array([0x81])));
  });
});
