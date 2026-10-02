#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const match = (path, pattern) => {
  const value = read(path).match(pattern)?.[1];
  assert.ok(value, `Missing version in ${path}`);
  return value;
};

const protocolVersion = match('packages/protocol/src/schemas.ts', /PROTOCOL_VERSION = '([^']+)'/);
for (const [path, pattern] of [
  ['packages/tensnap-go/protocol/version.go', /ProtocolVersion = "([^"]+)"/],
  ['packages/tensnap-python/tensnap/_version.py', /PROTOCOL_VERSION = "([^"]+)"/],
  ['packages/tensnap-julia/src/constants.jl', /PROTOCOL_VERSION = "([^"]+)"/],
]) {
  assert.equal(match(path, pattern), protocolVersion, `${path} disagrees with the protocol package`);
}

const tauriPackage = JSON.parse(read('packages/tensnap-tauri/package.json'));
const tauriConfig = JSON.parse(read('packages/tensnap-tauri/src-tauri/tauri.conf.json'));
assert.equal(tauriConfig.version, '../package.json');
assert.equal(match('packages/tensnap-tauri/src-tauri/Cargo.toml', /^version = "([^"]+)"/m), tauriPackage.version);
assert.equal(match('packages/tensnap-tauri/src-tauri/Cargo.lock', /name = "tensnap-tauri"\nversion = "([^"]+)"/), tauriPackage.version);

assert.match(read('packages/tensnap-python/pyproject.toml'), /^dynamic = \["version"\]$/m);
assert.match(read('packages/tensnap-python/pyproject.toml'), /^version = \{attr = "tensnap\._version\.__version__"\}$/m);
for (const binding of ['go', 'python', 'julia']) {
  const packageJson = JSON.parse(read(`packages/tensnap-${binding}/package.json`));
  assert.ok(!('version' in packageJson), `${binding} pnpm wrapper must not duplicate its native version`);
}

console.log('Version sources are consistent.');
