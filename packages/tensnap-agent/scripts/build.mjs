#!/usr/bin/env node

import { build } from 'esbuild';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const ROOT_LICENSE = resolve(ROOT, '..', '..', 'LICENSE');
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const publishedDependencies = Object.fromEntries(
  Object.entries(manifest.dependencies ?? {}).filter(([name]) => name !== '@tensnap/core'),
);

const sharedBuildOptions = {
  absWorkingDir: ROOT,
  bundle: true,
  external: Object.keys(publishedDependencies),
  format: 'esm',
  legalComments: 'none',
  platform: 'node',
  sourcemap: true,
  target: 'node18',
};

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

await build({
  ...sharedBuildOptions,
  entryPoints: ['src/index.ts', 'src/runtime/index.ts', 'src/session/index.ts'],
  outbase: 'src',
  outdir: DIST,
});

await build({
  ...sharedBuildOptions,
  banner: {
    js: '#!/usr/bin/env node',
  },
  entryPoints: ['src/bin.ts'],
  outfile: resolve(DIST, 'cli.js'),
});

chmodSync(resolve(DIST, 'cli.js'), 0o755);
copyFileSync(ROOT_LICENSE, resolve(DIST, 'LICENSE'));

writeFileSync(
  resolve(DIST, 'package.json'),
  JSON.stringify({
    name: manifest.name,
    version: manifest.version,
    type: manifest.type,
    description: manifest.description,
    main: './index.js',
    exports: {
      '.': './index.js',
      './runtime': './runtime/index.js',
      './session': './session/index.js',
    },
    bin: {
      'tensnap-agent': './cli.js',
    },
    scripts: {
      cli: 'node ./cli.js',
    },
    dependencies: publishedDependencies,
    keywords: manifest.keywords,
    license: 'SEE LICENSE IN LICENSE',
    publishConfig: {
      access: 'public',
    },
    engines: {
      node: '>=18.0.0',
    },
  }, null, 2) + '\n',
  'utf8',
);