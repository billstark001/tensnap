#!/usr/bin/env node

// Keep ecosystem installs self-contained without maintaining a second set of API docs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const check = process.argv.includes('--check');
const references = {
  'tensnap-agent': [
    'docs/user-guide/agent-runtime.md',
    'docs/api-reference/recording-storage.md',
    'packages/protocol/SPECIFICATION.md',
  ],
  'tensnap-abm-binding': [
    ...['python', 'go', 'julia', 'js'].map((language) => `docs/api-reference/${language}-api.md`),
    'docs/user-guide/networking.md',
    'docs/maintainer-guide/projection-ownership.md',
    'docs/maintainer-guide/binding-ownership-and-topology.md',
    'docs/maintainer-guide/reproducibility.md',
    'packages/protocol/SPECIFICATION.md',
  ],
};

function sync(path, content) {
  const output = resolve(root, path);
  if (check) {
    let current;
    try {
      current = readFileSync(output, 'utf8');
    } catch {
      /* report missing snapshots below */
    }
    if (current !== content)
      throw new Error(
        `Stale skill resource: ${path}. Run pnpm --filter @tensnap/agent skills:sync.`,
      );
  } else {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, content);
  }
}

for (const [skill, files] of Object.entries(references)) {
  for (const file of files)
    sync(`.agents/skills/${skill}/references/${file}`, readFileSync(resolve(root, file), 'utf8'));
  sync(`.agents/skills/${skill}/LICENSE`, readFileSync(resolve(root, 'LICENSE'), 'utf8'));
}

const temporary = mkdtempSync(join(tmpdir(), 'tensnap-skill-reference-'));
try {
  const output = join(temporary, 'protocol-types.md');
  execFileSync(
    process.execPath,
    [resolve(root, 'packages/protocol/scripts/export-protocol.mjs'), output],
    { cwd: root },
  );
  // The schema exporter timestamps its output; keep the checked-in snapshot deterministic.
  const generated = readFileSync(output, 'utf8').replace(/^\| Generated At \|.*\n/m, '');
  // Match the repository's Markdown formatting, including fenced TypeScript blocks.
  const content = execFileSync(
    'pnpm',
    [
      'exec',
      'oxfmt',
      '--stdin-filepath',
      '.agents/skills/tensnap-abm-binding/references/protocol-types.md',
    ],
    { cwd: root, input: generated, encoding: 'utf8' },
  );
  sync('.agents/skills/tensnap-abm-binding/references/protocol-types.md', content);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
