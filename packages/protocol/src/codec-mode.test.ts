import { describe, expect, it } from 'vitest';
import { ProtocolCodec, selectProtocolCodecMode } from './codec';

describe('codec mode', () => {
  it('compares semantic version components numerically', () => {
    expect(selectProtocolCodecMode(undefined)).toBe('legacy');
    expect(selectProtocolCodecMode('0.2.99')).toBe('legacy');
    expect(selectProtocolCodecMode('0.3')).toBe('strict');
    expect(selectProtocolCodecMode('0.10')).toBe('strict');
    expect(selectProtocolCodecMode('1.0')).toBe('strict');
  });

  it('rejects legacy aliases in strict mode', () => {
    const codec = new ProtocolCodec({ validation: { level: 'error' } });
    expect(() => codec.decode(JSON.stringify({
      type: 'param_create',
      payload: { id: 'size', type: 'number', label: 'Size', value: 10, allowRuntimeChange: true },
    }))).toThrow();
  });

  it('normalizes only declared legacy paths and leaves custom maps untouched', () => {
    const warnings: string[] = [];
    const codec = new ProtocolCodec({ mode: 'legacy', onWarning: (warning) => warnings.push(warning.path) });
    const decoded = codec.decode(JSON.stringify({
      type: 'param_create',
      payload: {
        id: 'size',
        type: 'number',
        label: 'Size',
        value: 10,
        allowRuntimeChange: true,
      },
    }));
    expect(decoded).toMatchObject({
      type: 'param_create',
      payload: { allow_runtime_change: true },
    });
    expect(warnings).toContain('payload.allowRuntimeChange');
  });

  it('rejects conflicting canonical and legacy values', () => {
    const codec = new ProtocolCodec({ mode: 'legacy' });
    expect(() => codec.decode(JSON.stringify({
      type: 'param_create',
      payload: {
        id: 'size',
        type: 'number',
        label: 'Size',
        value: 10,
        allow_runtime_change: false,
        allowRuntimeChange: true,
      },
    }))).toThrow(/Conflicting/);
  });
});
