#!/usr/bin/env node

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleSkill } from './skills-build.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const WORKSPACE_ROOT = resolve(ROOT, '..', '..');
const DIST = resolve(ROOT, 'dist');
const ROOT_LICENSE = resolve(WORKSPACE_ROOT, 'LICENSE');
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const manifestDependencies = manifest.dependencies ?? {};
const publishedDependencies = resolvePublishedDependencies(manifestDependencies);
const workspaceDependencies = new Set(
  Object.entries(manifestDependencies)
    .filter(([, version]) => typeof version === 'string' && version.startsWith('workspace:'))
    .map(([name]) => name),
);

execFileSync(process.execPath, [resolve(ROOT, 'scripts/sync-skills.mjs'), '--check'], {
  stdio: 'inherit',
});

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readWorkspacePackageVersions() {
  const packagesDir = resolve(WORKSPACE_ROOT, 'packages');
  return new Map(
    readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(packagesDir, entry.name, 'package.json'))
      .filter((packageJsonPath) => existsSync(packageJsonPath))
      .map((packageJsonPath) => {
        const packageJson = readJson(packageJsonPath);
        return [packageJson.name, packageJson.version];
      }),
  );
}

function resolvePublishedDependencies(dependencies) {
  const workspaceVersions = readWorkspacePackageVersions();
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, version]) => {
      if (typeof version === 'string' && version.startsWith('workspace:')) {
        const publishedVersion = workspaceVersions.get(name);
        if (!publishedVersion) {
          throw new Error(`Cannot resolve workspace dependency ${name}`);
        }
        return [name, publishedVersion];
      }
      return [name, version];
    }),
  );
}

const sharedBuildOptions = {
  absWorkingDir: ROOT,
  bundle: true,
  external: Object.keys(publishedDependencies),
  format: 'esm',
  legalComments: 'none',
  platform: 'node',
  sourcemap: true,
  target: 'node22',
};

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

await build({
  ...sharedBuildOptions,
  entryPoints: ['src/index.ts', 'src/runtime/index.ts', 'src/session/index.ts'],
  outbase: 'src',
  outdir: DIST,
});

await build({
  ...sharedBuildOptions,
  // The executable must also run from a source checkout, where workspace package
  // exports point at TypeScript. Bundle those packages into the CLI while keeping
  // native and third-party runtime dependencies external.
  external: Object.keys(publishedDependencies).filter((name) => !workspaceDependencies.has(name)),
  banner: {
    js: '#!/usr/bin/env node',
  },
  entryPoints: ['src/bin.ts'],
  entryNames: 'cli',
  outdir: DIST,
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
});

chmodSync(resolve(DIST, 'cli.js'), 0o755);
copyFileSync(ROOT_LICENSE, resolve(DIST, 'LICENSE'));
writeFileSync(
  resolve(DIST, 'README.md'),
  readFileSync(resolve(ROOT, 'README.md'), 'utf8')
    .replaceAll(
      '../../docs/user-guide/agent-runtime.md',
      './skills/tensnap-agent/references/docs/user-guide/agent-runtime.md',
    )
    .replace(
      '../protocol/SPECIFICATION.md',
      './skills/tensnap-agent/references/packages/protocol/SPECIFICATION.md',
    ),
);

const skillsRoot = resolve(DIST, 'skills');
mkdirSync(skillsRoot);
const skillNames = ['tensnap-agent', 'tensnap-abm-binding'];
const skills = skillNames.map((name) => {
  const source = resolve(WORKSPACE_ROOT, '.agents/skills', name);
  const target = resolve(skillsRoot, name);
  return bundleSkill(source, target, name, manifest.version);
});
writeFileSync(
  resolve(skillsRoot, 'manifest.json'),
  JSON.stringify(
    { schemaVersion: 1, package: manifest.name, version: manifest.version, skills },
    null,
    2,
  ) + '\n',
);

writeFileSync(
  resolve(DIST, 'package.json'),
  JSON.stringify(
    {
      name: manifest.name,
      version: manifest.version,
      type: manifest.type,
      description: manifest.description,
      repository: manifest.repository,
      main: './index.js',
      exports: {
        '.': './index.js',
        './runtime': './runtime/index.js',
        './session': './session/index.js',
      },
      bin: {
        'tensnap-agent': './cli.js',
      },
      files: [
        'cli.js',
        'cli.js.map',
        'chunks',
        'index.js',
        'index.js.map',
        'runtime',
        'session',
        'skills',
        'README.md',
        'LICENSE',
      ],
      scripts: {
        cli: 'node ./cli.js',
      },
      dependencies: publishedDependencies,
      keywords: manifest.keywords,
      license: 'SEE LICENSE IN LICENSE',
      publishConfig: {
        access: 'public',
      },
      engines: {
        node: manifest.engines.node,
      },
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
