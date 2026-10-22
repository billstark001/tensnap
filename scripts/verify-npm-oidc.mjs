// npm hides token-exchange errors and falls back to other credentials. Check the
// exchange for the entire batch before npm can upload any package.
// https://api-docs.npmjs.com/#tag/OIDC
export async function verifyNpmOidc(packageNames, { env = process.env, request = fetch } = {}) {
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error(
      'GitHub Actions OIDC is unavailable. Grant id-token: write to the publish job.',
    );
  }

  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set('audience', 'npm:registry.npmjs.org');
  const identity = await requestJson(
    request,
    url,
    {
      headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    },
    'GitHub Actions OIDC',
  );
  if (typeof identity?.value !== 'string' || !identity.value) {
    throw new Error('GitHub Actions OIDC returned no identity token.');
  }

  const failures = [];
  for (const name of packageNames) {
    try {
      const exchange = await requestJson(
        request,
        `https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(name)}`,
        { method: 'POST', headers: { Authorization: `Bearer ${identity.value}` } },
        'npm OIDC token exchange',
      );
      if (typeof exchange?.token !== 'string' || !exchange.token) {
        throw new Error('npm OIDC token exchange returned no publish token.');
      }
      // Discard the token; npm obtains its own fresh token when publishing.
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    }
  }
  if (failures.length) {
    throw new Error(
      [
        'npm Trusted Publishing preflight failed; no packages have been published.',
        ...failures,
        'Check each failing package on npm: Trusted Publisher must use billstark001/tensnap,',
        'workflow js-publish.yml, and allow npm publish. Also check any configured environment.',
        'A new publisher expires if its first successful publish is not completed within 2 days;',
        'delete and recreate an expired configuration on npm.',
        'https://docs.npmjs.com/trusted-publishers/',
      ].join('\n'),
    );
  }
}

async function requestJson(request, url, options, label) {
  let response;
  try {
    response = await request(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // Do not include request URLs, headers, or response bodies in errors: they
    // can contain credentials. Report only the operation and HTTP status.
    throw new Error(`${label}: network error or timeout.`);
  }
  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${label}: invalid JSON response.`);
  }
}
