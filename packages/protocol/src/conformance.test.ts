import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ProtocolCodec, selectProtocolCodecMode } from './codec';
import { AnyProtocolMessageSchema } from './schemas';

const conformanceDirectory = fileURLToPath(new URL('../conformance/', import.meta.url));

describe('v0.3 conformance traces', () => {
  it('contains only canonical, schema-valid messages', async () => {
    const files = (await readdir(conformanceDirectory)).filter((file) => file.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const trace = JSON.parse(await readFile(resolve(conformanceDirectory, file), 'utf8')) as { messages: unknown[] };
      for (const message of trace.messages) AnyProtocolMessageSchema.parse(message);
    }
  });
});

describe('codec mode', () => {
  it('compares semantic version components numerically', () => {
    expect(selectProtocolCodecMode(undefined)).toBe('legacy');
    expect(selectProtocolCodecMode('0.2.99')).toBe('legacy');
    expect(selectProtocolCodecMode('0.3')).toBe('strict');
    expect(selectProtocolCodecMode('0.10')).toBe('strict');
    expect(selectProtocolCodecMode('1.0')).toBe('strict');
  });

  it('rejects legacy aliases in strict mode', () => {
    const codec = new ProtocolCodec();
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
