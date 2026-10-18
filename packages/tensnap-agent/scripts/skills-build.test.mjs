import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { parse } from 'yaml';
import { bundleSkill, stampSkill } from './skills-build.mjs';

const content =
  '---\nname: "demo"\ndescription: >-\n  Drive a simulator: safely\nmetadata:\n  version: old\n  author: example\n---\n\nUse the simulator.\n';

test('parses quoted and multiline YAML, replaces the version, and preserves the body', () => {
  const stamped = stampSkill(content, 'demo', '2.0.0');
  const metadata = parse(stamped.content.split('---')[1]);
  assert.equal(stamped.description, 'Drive a simulator: safely');
  assert.equal(metadata.metadata.version, '2.0.0');
  assert.equal(metadata.metadata.author, 'example');
  assert(stamped.content.endsWith('\nUse the simulator.\n'));
  assert.throws(
    () => stampSkill(content.replace('  author: example', '  version: duplicate'), 'demo', '2.0.0'),
    /Invalid skill YAML/,
  );
});

test('bundles executable resources and omits installation receipts', () => {
  const root = mkdtempSync(join(tmpdir(), 'tensnap-skill-build-'));
  try {
    const source = join(root, 'source');
    mkdirSync(join(source, 'scripts'), { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), content);
    writeFileSync(join(source, '.tensnap-skill.json'), 'local installation state');
    writeFileSync(join(source, 'scripts/check.sh'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(source, 'scripts/check.sh'), 0o755);
    const target = join(root, 'output');
    const skill = bundleSkill(source, target, 'demo', '2.0.0');
    assert.deepEqual(skill.executables, ['scripts/check.sh']);
    assert(lstatSync(join(target, 'scripts/check.sh')).mode & 0o111);
    assert(!existsSync(join(target, '.tensnap-skill.json')));
    assert.equal(readFileSync(join(source, 'SKILL.md'), 'utf8'), content);
    assert.equal(
      parse(readFileSync(join(target, 'SKILL.md'), 'utf8').split('---')[1]).metadata.version,
      '2.0.0',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const kind of ['root-link', 'entrypoint-link', 'resource-link', 'empty-directory']) {
  test(`rejects ${kind} before writing metadata through a link or producing an incomplete bundle`, () => {
    const root = mkdtempSync(join(tmpdir(), 'tensnap-skill-link-build-'));
    try {
      const source = join(root, 'source');
      const external = join(root, 'external');
      mkdirSync(external);
      writeFileSync(join(external, 'SKILL.md'), content);
      if (kind === 'root-link') symlinkSync(external, source, 'dir');
      else {
        mkdirSync(source);
        if (kind === 'entrypoint-link')
          symlinkSync(join(external, 'SKILL.md'), join(source, 'SKILL.md'));
        else writeFileSync(join(source, 'SKILL.md'), content);
        if (kind === 'resource-link') symlinkSync(external, join(source, 'references'), 'dir');
        if (kind === 'empty-directory') mkdirSync(join(source, 'references'));
      }
      const output = join(root, 'output');
      assert.throws(() => bundleSkill(source, output, 'demo', '2.0.0'));
      assert.equal(readFileSync(join(external, 'SKILL.md'), 'utf8'), content);
      assert(!existsSync(output));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
