#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const DEFAULT_OUTPUT = 'dist/protocol-types.md';

const [outputArg] = process.argv.slice(2).filter((arg) => arg !== '--');

execFileSync(
  process.execPath,
  ['./scripts/gen-zod-docs.mjs', outputArg ?? DEFAULT_OUTPUT],
  {
    cwd: ROOT,
    stdio: 'inherit',
  },
);
