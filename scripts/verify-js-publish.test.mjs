import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const verifier = fileURLToPath(new URL('./verify-js-publish.mjs', import.meta.url));

function manifest(directory) {
  return JSON.parse(
    readFileSync(new URL(`../packages/${directory}/package.json`, import.meta.url), 'utf8'),
  );
}
const network = manifest('network');
const protocol = manifest('protocol');
const js = manifest('tensnap-js');
const networkKey = `${network.name}@${network.version}`;
const protocolKey = `${protocol.name}@${protocol.version}`;
const jsKey = `${js.name}@${js.version}`;

// Exercise the real command with a registry fixture instead of contacting npm or
// using local authentication. Only the npm executable is replaced.
function verify(packages, fixtures) {
  const directory = mkdtempSync(join(tmpdir(), 'tensnap-publish-test-'));
  const log = join(directory, 'queries.jsonl');
  try {
    writeFileSync(
      join(directory, 'npm'),
      `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const key = process.argv[3];
appendFileSync(process.env.NPM_QUERY_LOG, JSON.stringify(key) + '\\n');
const fixtures = JSON.parse(process.env.NPM_VERSION_FIXTURES);
if (!Object.hasOwn(fixtures, key)) {
  process.stderr.write('Unexpected registry query: ' + key);
  process.exit(2);
}
const value = fixtures[key];
if (value === null || value?.error) {
  process.stderr.write(value?.error ?? 'E404');
  process.exit(1);
}
process.stdout.write(JSON.stringify(value));
`,
      { mode: 0o755 },
    );
    const result = spawnSync(process.execPath, [verifier], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        PACKAGES: packages,
        NPM_VERSION_FIXTURES: JSON.stringify(fixtures),
        NPM_QUERY_LOG: log,
      },
    });
    assert.ifError(result.error);
    const queries = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    return { ...result, queries };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const response of [network.version, [network.version]]) {
  const format = Array.isArray(response) ? 'array' : 'string';
  test(`rejects an already published selected version returned as a ${format}`, () => {
    const result = verify('network', { [networkKey]: response });
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(`${networkKey} is already published`));
  });

  test(`accepts a published omitted dependency returned as a ${format}`, () => {
    const result = verify('protocol tensnap-js', {
      [protocolKey]: null,
      [jsKey]: null,
      [networkKey]: response,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ready for publishing/);
    assert.equal(result.queries.filter((key) => key === networkKey).length, 1);
  });
}

test('rejects an omitted dependency when only another version is returned', () => {
  const result = verify('tensnap-js', {
    [jsKey]: null,
    [networkKey]: ['0.0.0-stage'],
    [protocolKey]: protocol.version,
  });
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(`needs ${networkKey}`));
});

test('rejects a missing omitted dependency', () => {
  const result = verify('tensnap-js', {
    [jsKey]: null,
    [networkKey]: null,
    [protocolKey]: protocol.version,
  });
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(`needs ${networkKey}`));
});

test('does not treat authentication failures as an unpublished version', () => {
  const result = verify('network', { [networkKey]: { error: 'E401' } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /E401/);
});
