import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeBinaryString, encodeBytesAsDataUrl, isEncodedBinaryString } from './binary';

afterEach(() => vi.unstubAllGlobals());

describe.each(['node', 'browser'] as const)('binary strings (%s)', (runtime) => {
  function selectRuntime(): void {
    if (runtime === 'browser') vi.stubGlobal('Buffer', undefined);
  }

  it.each(['', 'AA==', 'AAA=', 'AAAA', ' A A==\n', 'data:;base64,', 'data:image/png;base64,AA=='])(
    'accepts valid base64 %j',
    (value) => {
      selectRuntime();
      expect(isEncodedBinaryString(value)).toBe(true);
      expect(decodeBinaryString(value).bytes).toBeInstanceOf(Uint8Array);
    },
  );

  it.each(['====', 'A===', 'AA=A', '=AAA', 'A=AA', 'AAA', 'AA', 'data:image/png,AA==', 'AA-_'])(
    'rejects malformed base64 %j',
    (value) => {
      selectRuntime();
      expect(isEncodedBinaryString(value)).toBe(false);
      expect(() => decodeBinaryString(value)).toThrow('Expected a base64');
    },
  );

  it('round-trips empty binary data', () => {
    selectRuntime();
    const encoded = encodeBytesAsDataUrl(new Uint8Array());
    expect(decodeBinaryString(encoded)).toEqual({
      bytes: new Uint8Array(),
      mime: 'application/octet-stream',
      encoding: 'data-url',
    });
  });
});

it('validates syntax without allocating decoded binary data', () => {
  vi.stubGlobal('Buffer', undefined);
  const decoder = vi.fn(() => {
    throw new Error('must not decode');
  });
  vi.stubGlobal('atob', decoder);
  expect(isEncodedBinaryString('AA==')).toBe(true);
  expect(decoder).not.toHaveBeenCalled();
});
