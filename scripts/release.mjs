#!/usr/bin/env node
/**
 * release.mjs
 * Release helper for Tensnap components.
 * Usage: node scripts/release.mjs <component> [version]
 *
 * Components:
 *   python  - Release Python package to PyPI
 *   app     - Release Tauri desktop app
 *   web     - Deploy web app (automatic on main)
 */

import { execFileSync, execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) { console.log(msg); }
function die(msg) { console.error(`Error: ${msg}`); process.exit(1); }

function git(...args) {
  execFileSync('git', args, { cwd: ROOT, stdio: 'inherit' });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/**
 * Replace the first occurrence of a TOML key=value line in a file.
 * Only replaces bare top-level `key = "..."` lines (not inside a section).
 */
function patchTomlVersion(filePath, version) {
  const src = readFileSync(filePath, 'utf8');
  const versionPattern = /^(version\s*=\s*)"[^"]*"/m;
  const match = src.match(versionPattern);
  if (!match) die(`Could not find 'version = "..."' in ${filePath}`);
  const patched = src.replace(versionPattern, `$1"${version}"`);
  writeFileSync(filePath, patched, 'utf8');
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function releaseHelp() {
  log(`
Usage: node scripts/release.mjs <component> [version]

Components:
  python  - Release Python package to PyPI
  app     - Release Tauri desktop app
  web     - Deploy web app (automatic on main)

Examples:
  node scripts/release.mjs python 0.1.0
  node scripts/release.mjs app    0.1.0
`.trim());
}

function releasePython(version) {
  if (!version) die('Version required for Python release');

  log(`Preparing Python package v${version} release...`);

  const pyprojectPath = join(ROOT, 'packages', 'tensnap-python', 'pyproject.toml');
  patchTomlVersion(pyprojectPath, version);

  git('add', pyprojectPath);
  git('commit', '-m', `Release Python package v${version}`);
  git('tag', `py-v${version}`);

  log(`\nCreated tag py-v${version}`);
  log(`Push with:\n  git push origin main && git push origin py-v${version}`);
}

function releaseApp(version) {
  if (!version) die('Version required for app release');

  log(`Preparing Tauri app v${version} release...`);

  // Update package.json
  const pkgPath = join(ROOT, 'packages', 'tensnap-tauri', 'package.json');
  const pkg = readJson(pkgPath);
  pkg.version = version;
  writeJson(pkgPath, pkg);
  log(`  Updated ${pkgPath.replace(ROOT + '/', '')}`);

  // Update Cargo.toml
  const cargoPath = join(ROOT, 'packages', 'tensnap-tauri', 'src-tauri', 'Cargo.toml');
  patchTomlVersion(cargoPath, version);
  log(`  Updated ${cargoPath.replace(ROOT + '/', '')}`);

  // Update tauri.conf.json
  const tauriConfPath = join(ROOT, 'packages', 'tensnap-tauri', 'src-tauri', 'tauri.conf.json');
  const tauriConf = readJson(tauriConfPath);
  tauriConf.version = version;
  writeJson(tauriConfPath, tauriConf);
  log(`  Updated ${tauriConfPath.replace(ROOT + '/', '')}`);

  git('add', pkgPath, cargoPath, tauriConfPath);
  git('commit', '-m', `Release Tauri app v${version}`);
  git('tag', `app-v${version}`);

  log(`\nCreated tag app-v${version}`);
  log(`Push with:\n  git push origin main && git push origin app-v${version}`);
}

function releaseWeb() {
  log('Web app deploys automatically on push to main.');
  log('Just commit and push your changes to the main branch.');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const [, , component, version] = process.argv;

if (!component) {
  releaseHelp();
  process.exit(1);
}

switch (component) {
  case 'python': releasePython(version); break;
  case 'app': releaseApp(version); break;
  case 'web': releaseWeb(); break;
  default:
    console.error(`Error: Unknown component '${component}'\n`);
    releaseHelp();
    process.exit(1);
}
