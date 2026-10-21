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

test('bundles executable resources and omits receipts and npm-excluded Finder metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'tensnap-skill-build-'));
  try {
    const source = join(root, 'source');
    mkdirSync(join(source, 'scripts'), { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), content);
    writeFileSync(join(source, '.tensnap-skill.json'), 'local installation state');
    writeFileSync(join(source, '.DS_Store'), 'root Finder metadata');
    writeFileSync(join(source, 'scripts/.DS_Store'), 'nested Finder metadata');
    writeFileSync(join(source, 'scripts/check.sh'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(source, 'scripts/check.sh'), 0o755);
    const target = join(root, 'output');
    const skill = bundleSkill(source, target, 'demo', '2.0.0');
    assert.deepEqual(skill.executables, ['scripts/check.sh']);
    assert(lstatSync(join(target, 'scripts/check.sh')).mode & 0o111);
    assert(!existsSync(join(target, '.tensnap-skill.json')));
    assert(!existsSync(join(target, '.DS_Store')));
    assert(!existsSync(join(target, 'scripts/.DS_Store')));
    assert.deepEqual(Object.keys(skill.files).sort(), ['SKILL.md', 'scripts/check.sh']);
    assert.equal(readFileSync(join(source, 'SKILL.md'), 'utf8'), content);
    assert.equal(
      parse(readFileSync(join(target, 'SKILL.md'), 'utf8').split('---')[1]).metadata.version,
      '2.0.0',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolves nested local references while ignoring anchors, external links and fenced examples', () => {
  const root = mkdtempSync(join(tmpdir(), 'tensnap-skill-references-'));
  try {
    const source = join(root, 'source');
    mkdirSync(join(source, 'references', 'nested'), { recursive: true });
    writeFileSync(
      join(source, 'SKILL.md'),
      content + '\n[Guide](references/nested/guide.md#details)\n',
    );
    writeFileSync(
      join(source, 'references/nested/guide.md'),
      '[Home](../../SKILL.md) [Here](#details) [Source](https://example.com/source) ' +
        '[Email](mailto:example@example.com)\n```md\n[Example](missing.md)\n```\n',
    );
    const target = join(root, 'output');
    const bundled = bundleSkill(source, target, 'demo', '2.0.0');
    assert.equal(Object.keys(bundled.files).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const link of ['missing.md', '../../outside.md', 'nested', '/SKILL.md']) {
  test(`rejects unresolved nested reference ${link} before writing a bundle`, () => {
    const root = mkdtempSync(join(tmpdir(), 'tensnap-skill-missing-reference-'));
    try {
      const source = join(root, 'source');
      mkdirSync(join(source, 'references/nested'), { recursive: true });
      writeFileSync(join(source, 'SKILL.md'), content);
      writeFileSync(join(source, 'references/guide.md'), `[Missing](${link}#details)\n`);
      writeFileSync(join(source, 'references/nested/existing.md'), 'Present resource');
      writeFileSync(join(root, 'outside.md'), 'Outside the skill');
      const output = join(root, 'output');
      assert.throws(
        () => bundleSkill(source, output, 'demo', '2.0.0'),
        /Missing skill reference in references\/guide\.md/,
      );
      assert(!existsSync(output));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

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
