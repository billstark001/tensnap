#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'dist');
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const entryPoints = new Set();
for (const source of Object.values(manifest.exports)) {
  const path = source.slice(2);
  if (path.includes('*')) {
    const directory = dirname(path);
    for (const name of readdirSync(resolve(root, directory))) {
      if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
        entryPoints.add(`${directory}/${name}`);
      }
    }
  } else {
    entryPoints.add(path);
  }
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  absWorkingDir: root,
  bundle: true,
  entryPoints: [...entryPoints],
  external: Object.keys(manifest.dependencies),
  format: 'esm',
  legalComments: 'none',
  outbase: 'src',
  outdir: dist,
  platform: 'neutral',
  sourcemap: true,
  target: 'es2020',
});

execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json'], {
  cwd: root,
  stdio: 'inherit',
});

copyFileSync(resolve(root, '..', '..', 'LICENSE'), resolve(dist, 'LICENSE'));
