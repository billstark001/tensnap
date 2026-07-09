#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const ROOT_LICENSE = resolve(ROOT, '..', '..', 'LICENSE');
const TSC = resolve(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

const entryPoints = [
  'src/index.ts',
  'src/asset.ts',
  'src/binary.ts',
  'src/chart.ts',
  'src/codec.ts',
  'src/controls.ts',
  'src/layers.ts',
  'src/schemas.ts',
  'src/types.ts',
];

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

await build({
  absWorkingDir: ROOT,
  bundle: true,
  entryPoints,
  external: ['@msgpack/msgpack', 'zod'],
  format: 'esm',
  legalComments: 'none',
  outbase: 'src',
  outdir: DIST,
  platform: 'neutral',
  sourcemap: true,
  target: 'es2020',
});

execFileSync(process.execPath, [TSC, '-p', 'tsconfig.build.json'], {
  cwd: ROOT,
  stdio: 'inherit',
});

copyFileSync(ROOT_LICENSE, resolve(DIST, 'LICENSE'));

execFileSync(process.execPath, ['./scripts/gen-zod-docs.mjs', 'dist/protocol-types.md'], {
  cwd: ROOT,
  stdio: 'inherit',
});
