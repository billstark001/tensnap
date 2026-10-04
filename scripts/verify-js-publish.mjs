#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageDirs = ['protocol', 'core', 'tensnap-js', 'tensnap-agent'];
const manifests = new Map(
  packageDirs.map((dir) => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'packages', dir, 'package.json'), 'utf8'),
    );
    return [manifest.name, { dir, manifest }];
  }),
);
const selectedDirs = (process.env.PACKAGES ?? '').split(' ').filter(Boolean);
assert.ok(selectedDirs.length > 0, 'Select at least one package to publish');
assert.equal(
  new Set(selectedDirs).size,
  selectedDirs.length,
  'Package selection contains duplicates',
);
for (const dir of selectedDirs) {
  assert.ok(packageDirs.includes(dir), `Unknown package directory: ${dir}`);
}

const selected = new Set(selectedDirs);
const checked = new Map();
function isPublished(name, version) {
  const key = `${name}@${version}`;
  if (!checked.has(key)) {
    try {
      const output = execFileSync(
        'npm',
        ['view', key, 'version', '--json', '--registry=https://registry.npmjs.org'],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      checked.set(key, JSON.parse(output) === version);
    } catch (error) {
      if (error.status === 1 && error.stderr?.includes('E404')) {
        checked.set(key, false);
      } else {
        throw error;
      }
    }
  }
  return checked.get(key);
}

for (const { dir, manifest } of manifests.values()) {
  if (!selected.has(dir)) continue;
  assert.ok(
    !isPublished(manifest.name, manifest.version),
    `${manifest.name}@${manifest.version} is already published`,
  );

  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    if (!range.startsWith('workspace:')) continue;
    const dependency = manifests.get(name);
    assert.ok(dependency, `Unknown workspace dependency ${name} of ${manifest.name}`);
    if (!selected.has(dependency.dir)) {
      assert.ok(
        isPublished(name, dependency.manifest.version),
        `${manifest.name} needs ${name}@${dependency.manifest.version} on npm or in this batch`,
      );
    }
  }
}

console.log('Selected package versions and npm dependencies are ready for publishing.');
