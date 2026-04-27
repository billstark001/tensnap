import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  arrayBufferToJsonString,
  checkMsgpackCompatibility,
  uint8ArrayToArrayBuffer,
} from './msgpack';

describe('msgpack utils', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reuses the underlying buffer for full Uint8Array views', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(uint8ArrayToArrayBuffer(bytes)).toBe(bytes.buffer);
  });

  it('copies partial Uint8Array views into a compact ArrayBuffer', () => {
    const source = new Uint8Array([0, 1, 2, 3]);
    const slice = source.subarray(1, 3);
    const buffer = uint8ArrayToArrayBuffer(slice);

    expect(buffer).not.toBe(source.buffer);
    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2]);
  });

  it('converts ArrayBuffer payloads to JSON-safe latin1 strings', () => {
    const buffer = new Uint8Array([0, 65, 255]).buffer;
    expect(JSON.parse(arrayBufferToJsonString(buffer))).toBe('\u0000Aÿ');
  });

  it('warns for unsupported values while handling nested and circular objects', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const circular: { nested: { fn: () => void }; self?: unknown } = {
      nested: { fn: () => undefined },
    };
    circular.self = circular;

    checkMsgpackCompatibility(circular);

    expect(warn.mock.calls.some(([message]) => String(message).includes('Cannot serialize function: root.nested.fn'))).toBe(true);
    expect(warn.mock.calls.some(([message]) => String(message).includes('Circular reference: root.self'))).toBe(true);
  });
});