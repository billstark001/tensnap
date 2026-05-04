#!/usr/bin/env node
/**
 * release.mjs
 * Release helper for Tensnap components.
 * Usage: node scripts/release.mjs <component> [version]
 *
 * Components:
 *   go      - Release Go module
 *   python  - Release Python package to PyPI
 *   agent   - Release agent CLI package
 *   app     - Release Tauri desktop app
 *   web     - Deploy web app (automatic on main)
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

// #region Helpers

function log(msg) { console.log(msg); }
function die(msg) { console.error(`Error: ${msg}`); process.exit(1); }

function git(...args) {
  execFileSync('git', args, { cwd: ROOT, stdio: 'inherit' });
}

function gitQuiet(...args) {
  execFileSync('git', args, { cwd: ROOT, stdio: 'ignore' });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function toRepoPath(filePath) {
  return filePath.startsWith(`${ROOT}/`) ? filePath.slice(ROOT.length + 1) : filePath;
}

function updateJsonVersion(filePath, version) {
  const data = readJson(filePath);
  if (data.version === version) {
    return false;
  }
  data.version = version;
  writeJson(filePath, data);
  return true;
}

function hasTrackedDiff(filePaths) {
  try {
    gitQuiet('diff', '--quiet', 'HEAD', '--', ...filePaths);
    return false;
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 1) {
      return true;
    }
    throw error;
  }
}

function commitFilesIfNeeded(filePaths, message) {
  const repoPaths = filePaths.map(toRepoPath);
  if (!hasTrackedDiff(repoPaths)) {
    return false;
  }
  git('commit', '-m', message, '--only', '--', ...repoPaths);
  return true;
}

function tagExists(tagName) {
  try {
    gitQuiet('rev-parse', '-q', '--verify', `refs/tags/${tagName}`);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 1) {
      return false;
    }
    throw error;
  }
}

function createTag(tagName) {
  if (tagExists(tagName)) {
    die(`Tag ${tagName} already exists`);
  }
  git('tag', tagName);
}

function finalizeRelease({ componentLabel, version, filePaths, commitMessage, tagName }) {
  const committed = commitFilesIfNeeded(filePaths, commitMessage);
  if (!committed) {
    log(`  ${componentLabel} version files already match v${version}; tagging current HEAD.`);
  }

  createTag(tagName);

  log(`\nCreated tag ${tagName}`);
  log(`Push with:\n  git push origin main && git push origin ${tagName}`);
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
  if (patched === src) {
    return false;
  }
  writeFileSync(filePath, patched, 'utf8');
  return true;
}

// #endregion

// #region Commands

function releaseHelp() {
  log(`
Usage: node scripts/release.mjs <component> [version]

Components:
  go      - Release Go module
  python  - Release Python package to PyPI
  agent   - Release agent CLI package
  app     - Release Tauri desktop app
  web     - Deploy web app (automatic on main)

Examples:
  node scripts/release.mjs go     0.1.0
  node scripts/release.mjs python 0.1.0
  node scripts/release.mjs agent  0.1.0
  node scripts/release.mjs app    0.1.0
`.trim());
}

function releaseGo(version) {
  if (!version) die('Version required for Go release');

  log(`Preparing Go module v${version} release...`);

  const tagName = `packages/tensnap-go/v${version}`;
  createTag(tagName);

  log(`\nCreated tag ${tagName}`);
  log(`Push with:\n  git push origin main && git push origin ${tagName}`);
}

function releasePython(version) {
  if (!version) die('Version required for Python release');

  log(`Preparing Python package v${version} release...`);

  const pyprojectPath = join(ROOT, 'packages', 'tensnap-python', 'pyproject.toml');
  const changed = patchTomlVersion(pyprojectPath, version);
  if (changed) {
    log(`  Updated ${toRepoPath(pyprojectPath)}`);
  }

  finalizeRelease({
    componentLabel: 'Python package',
    version,
    filePaths: [pyprojectPath],
    commitMessage: `Release Python package v${version}`,
    tagName: `py-v${version}`,
  });
}

function releaseAgent(version) {
  if (!version) die('Version required for agent release');

  log(`Preparing agent CLI v${version} release...`);

  const pkgPath = join(ROOT, 'packages', 'tensnap-agent', 'package.json');
  const changed = updateJsonVersion(pkgPath, version);
  if (changed) {
    log(`  Updated ${toRepoPath(pkgPath)}`);
  }

  finalizeRelease({
    componentLabel: 'Agent CLI',
    version,
    filePaths: [pkgPath],
    commitMessage: `Release agent CLI v${version}`,
    tagName: `agent-v${version}`,
  });
}

function releaseApp(version) {
  if (!version) die('Version required for app release');

  log(`Preparing Tauri app v${version} release...`);

  // Update package.json
  const pkgPath = join(ROOT, 'packages', 'tensnap-tauri', 'package.json');
  if (updateJsonVersion(pkgPath, version)) {
    log(`  Updated ${toRepoPath(pkgPath)}`);
  }

  // Update Cargo.toml
  const cargoPath = join(ROOT, 'packages', 'tensnap-tauri', 'src-tauri', 'Cargo.toml');
  if (patchTomlVersion(cargoPath, version)) {
    log(`  Updated ${toRepoPath(cargoPath)}`);
  }

  // Update tauri.conf.json
  const tauriConfPath = join(ROOT, 'packages', 'tensnap-tauri', 'src-tauri', 'tauri.conf.json');
  if (updateJsonVersion(tauriConfPath, version)) {
    log(`  Updated ${toRepoPath(tauriConfPath)}`);
  }

  finalizeRelease({
    componentLabel: 'Tauri app',
    version,
    filePaths: [pkgPath, cargoPath, tauriConfPath],
    commitMessage: `Release Tauri app v${version}`,
    tagName: `app-v${version}`,
  });
}

function releaseWeb() {
  log('Web app deploys automatically on push to main.');
  log('Just commit and push your changes to the main branch.');
}

// #endregion

// #region Entry point

const [, , component, version] = process.argv;

if (!component) {
  releaseHelp();
  process.exit(1);
}

switch (component) {
  case 'go': releaseGo(version); break;
  case 'python': releasePython(version); break;
  case 'agent': releaseAgent(version); break;
  case 'app': releaseApp(version); break;
  case 'web': releaseWeb(); break;
  default:
    console.error(`Error: Unknown component '${component}'\n`);
    releaseHelp();
    process.exit(1);
}

// #endregion