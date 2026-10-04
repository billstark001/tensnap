#!/usr/bin/env node

import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageDirs = {
  protocol: 'protocol',
  core: 'core',
  js: 'tensnap-js',
  agent: 'tensnap-agent',
};
const event = process.env.GITHUB_EVENT_NAME;
const refType = process.env.GITHUB_REF_TYPE;
const refName = process.env.GITHUB_REF_NAME;

let selected;
if (event === 'push') {
  assert.equal(refType, 'tag', 'JavaScript publishing requires a release tag');
  const match = /^(protocol|js)-v(.+)$/.exec(refName ?? '');
  assert.ok(match, `Unexpected JavaScript release tag: ${refName}`);
  const [, component, version] = match;
  const manifest = JSON.parse(
    readFileSync(resolve(root, 'packages', packageDirs[component], 'package.json'), 'utf8'),
  );
  assert.equal(manifest.version, version, `${manifest.name} version must match ${refName}`);
  selected = [component];
} else if (event === 'workflow_dispatch') {
  assert.equal(refType, 'branch', 'Manual JavaScript publishing must run from main');
  assert.equal(refName, 'main', 'Manual JavaScript publishing must run from main');
  selected = Object.keys(packageDirs).filter(
    (component) => process.env[`INPUT_${component.toUpperCase()}`] === 'true',
  );
  assert.ok(selected.length > 0, 'Select at least one package for manual publishing');
} else {
  throw new Error(`Unsupported publishing event: ${event}`);
}

const directories = selected.map((component) => packageDirs[component]);
const output = `packages=${directories.join(' ')}\n`;
assert.ok(process.env.GITHUB_OUTPUT, 'GITHUB_OUTPUT is required');
appendFileSync(process.env.GITHUB_OUTPUT, output);
console.log(`Publishing: ${selected.map((component) => `@tensnap/${component}`).join(', ')}`);
