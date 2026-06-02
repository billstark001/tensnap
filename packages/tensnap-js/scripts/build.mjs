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

const entryPoints = [
  'src/index.ts',
  'src/bindings/index.ts',
  'src/runtime/index.ts',
  'src/scenario/index.ts',
  'src/transport/index.ts',
];

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

await build({
  absWorkingDir: ROOT,
  bundle: true,
  entryPoints,
  external: ['ws'],
  format: 'esm',
  legalComments: 'none',
  outbase: 'src',
  outdir: DIST,
  platform: 'node',
  sourcemap: true,
  target: 'node18',
});

execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json'], {
  cwd: ROOT,
  stdio: 'inherit',
});

copyFileSync(ROOT_LICENSE, resolve(DIST, 'LICENSE'));
