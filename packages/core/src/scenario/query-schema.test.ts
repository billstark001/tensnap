// @vitest-environment node
/// <reference types="node" />
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { ScenarioQuerySchema, compileFieldPath } from './query-schema';
import * as engine from './index';

it('preserves the original schema and field-path exports by identity', () => {
  expect(engine.ScenarioQuerySchema).toBe(ScenarioQuerySchema);
  expect(engine.compileFieldPath).toBe(compileFieldPath);
});

it('keeps strict selectors, typed ids, path safety and defaults in standalone validation', () => {
  expect(ScenarioQuerySchema.parse({ selector: { kind: 'metadata' } }).limit).toBe(100);
  for (const agentId of [1, '1'])
    expect(
      ScenarioQuerySchema.parse({
        selector: {
          kind: 'agent',
          ref: {
            environmentId: 'e',
            layerId: 'a',
            agentId,
          },
        },
      }).selector,
    ).toMatchObject({ ref: { agentId } });
  for (const fields of [['/__proto__/x'], ['/constructor'], ['/bad~escape']])
    expect(() => ScenarioQuerySchema.parse({ selector: { kind: 'metadata' }, fields })).toThrow();
  expect(() => ScenarioQuerySchema.parse({ selector: { kind: 'eval' } })).toThrow();
  expect(() =>
    ScenarioQuerySchema.parse({ selector: { kind: 'metadata' }, extra: true }),
  ).toThrow();
});

it('bundles validation without loading a renderer, scenario engine or persistence implementation', async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./query-schema.ts', import.meta.url))],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'esm',
    external: ['zod'],
  });
  expect(
    Object.keys(result.metafile.inputs).filter(
      (file) =>
        /[/\\]src[/\\](environment|runtime|persistence|chart)[/\\]/.test(file) ||
        file.endsWith('/Scenario.ts'),
    ),
  ).toEqual([]);
  expect(result.outputFiles[0].text).toContain('ScenarioQuerySchema');
});
