import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { verifyNpmOidc } from './verify-npm-oidc.mjs';

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
function verify(packages, fixtures, { args = [], env = {} } = {}) {
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
    const result = spawnSync(process.execPath, [verifier, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        PACKAGES: packages,
        NPM_VERSION_FIXTURES: JSON.stringify(fixtures),
        NPM_QUERY_LOG: log,
        ...env,
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

const oidcEnv = {
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token?api-version=2.0',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'github-request-secret',
};

function oidcRegistry(fixtures = {}) {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url: new URL(url), options });
    if (calls.length === 1) return Response.json({ value: 'github-identity-secret' });
    const name = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    const response = fixtures[name];
    if (response instanceof Error) throw response;
    return response ?? Response.json({ token: 'npm-publish-secret' });
  };
  return { request, calls };
}

test('exchanges the GitHub identity for every selected package without uploading packages', async () => {
  const { request, calls } = oidcRegistry();
  await verifyNpmOidc([network.name, js.name], { env: oidcEnv, request });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url.searchParams.get('audience'), 'npm:registry.npmjs.org');
  assert.equal(calls[0].url.searchParams.get('api-version'), '2.0');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer github-request-secret');
  for (const [index, name] of [network.name, js.name].entries()) {
    const call = calls[index + 1];
    assert.equal(call.url.origin, 'https://registry.npmjs.org');
    assert.equal(
      decodeURIComponent(call.url.pathname),
      `/-/npm/v1/oidc/token/exchange/package/${name}`,
    );
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers.Authorization, 'Bearer github-identity-secret');
    assert.equal(call.options.redirect, 'error');
  }
});

test('reports all rejected packages and expired-publisher recovery without exposing response bodies', async () => {
  const { request, calls } = oidcRegistry({
    [network.name]: Response.json({ error: 'private-registry-detail' }, { status: 404 }),
    [js.name]: Response.json({ error: 'private-registry-detail' }, { status: 401 }),
  });
  await assert.rejects(
    verifyNpmOidc([network.name, protocol.name, js.name], { env: oidcEnv, request }),
    (error) => {
      assert.ok(error.message.includes(`${network.name}: npm OIDC token exchange: HTTP 404`));
      assert.ok(error.message.includes(`${js.name}: npm OIDC token exchange: HTTP 401`));
      assert.match(error.message, /no packages have been published/);
      assert.match(error.message, /2 days/);
      assert.match(error.message, /delete and recreate/);
      assert.doesNotMatch(error.message, /secret|private-registry-detail/);
      return true;
    },
  );
  assert.equal(calls.length, 4);
});

test('rejects absent GitHub OIDC permissions before sending any request', async () => {
  const { request, calls } = oidcRegistry();
  await assert.rejects(verifyNpmOidc([network.name], { env: {}, request }), /id-token: write/);
  assert.equal(calls.length, 0);
});

test('rejects a failed GitHub identity request without exposing credentials', async () => {
  const request = async () => Response.json({ error: 'github-request-secret' }, { status: 403 });
  await assert.rejects(
    verifyNpmOidc([network.name], { env: oidcEnv, request }),
    /^Error: GitHub Actions OIDC: HTTP 403\.$/,
  );
});

test('rejects missing identity and publish tokens', async () => {
  await assert.rejects(
    verifyNpmOidc([network.name], {
      env: oidcEnv,
      request: async () => Response.json({ value: '' }),
    }),
    /no identity token/,
  );
  const { request } = oidcRegistry({ [network.name]: Response.json({ token: '' }) });
  await assert.rejects(
    verifyNpmOidc([network.name], { env: oidcEnv, request }),
    /no publish token/,
  );
});

test('rejects malformed registry responses and hides network error details', async () => {
  const { request } = oidcRegistry({
    [network.name]: new Response('private-registry-detail'),
    [js.name]: new Error('github-identity-secret'),
  });
  await assert.rejects(
    verifyNpmOidc([network.name, js.name], { env: oidcEnv, request }),
    (error) => {
      assert.match(error.message, /invalid JSON response/);
      assert.match(error.message, /network error or timeout/);
      assert.doesNotMatch(error.message, /secret|private-registry-detail/);
      return true;
    },
  );
});

test('the release command requires OIDC when --oidc is requested', () => {
  const result = verify(
    'network',
    { [networkKey]: null },
    {
      args: ['--oidc'],
      env: { ACTIONS_ID_TOKEN_REQUEST_URL: '', ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /id-token: write/);
  assert.doesNotMatch(result.stdout, /ready for publishing/);
});
