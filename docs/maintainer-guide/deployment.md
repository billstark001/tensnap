# Continuous Delivery Setup

This document describes the CI/CD pipelines for Tensnap project components.

## Overview

Four separate workflows handle deployments:

- **Python Package** → PyPI
- **Agent CLI** → npm
- **Web App** → Netlify
- **Tauri Desktop App** → GitHub Releases

## Python Package (PyPI)

**Workflow**: `.github/workflows/python-publish.yml`

### Trigger

Push tags matching `py-v*` (e.g., `py-v0.1.0`)

### Process

1. Run tests with coverage
2. Build distribution packages
3. Publish to PyPI using trusted publishing

### Setup Required

1. Configure PyPI trusted publishing:
   - Go to <https://pypi.org/manage/account/publishing/>
   - Add GitHub publisher: `billstark001/tensnap`, workflow `python-publish.yml`
   - Environment name: leave empty or use `pypi`

### Release Steps

```bash
node scripts/release.mjs python 0.1.0
```

## Agent CLI (npm)

**Workflow**: `.github/workflows/agent-publish.yml`

### Trigger

Push tags matching `agent-v*` (e.g., `agent-v0.1.0`)

### Process

1. Install workspace dependencies
2. Run `@tensnap/agent` tests
3. Build a publishable `dist/` package bundle
4. Publish `packages/tensnap-agent/dist` to npm

### Setup Required

Add repository secret:

- `NPM_TOKEN`: npm automation token with publish access to `@tensnap/agent`

### Release Steps

```bash
node scripts/release.mjs agent 0.1.0
```

## Web App (Netlify)

**Workflow**: `.github/workflows/web-deploy.yml`

### Trigger

- Push to `main` branch (when web packages change)
- Manual trigger

### Process

1. Install dependencies
2. Run tests
3. Build production bundle
4. Deploy to Netlify

### Setup Required

Add GitHub secrets:

- `NETLIFY_AUTH_TOKEN`: Personal access token from Netlify
- `NETLIFY_SITE_ID`: Site ID from Netlify dashboard

### Manual Deploy

```bash
# Push to main or trigger workflow manually from GitHub Actions tab
```

## Tauri Desktop App

**Workflow**: `.github/workflows/tauri-build.yml`

### Trigger

Push tags matching `app-v*` (e.g., `app-v0.1.0`)

### Process

Builds for multiple platforms:

- macOS (Apple Silicon & Intel)
- Ubuntu 22.04
- Windows

Creates draft release with installers on GitHub Releases page.

### Setup Required

No additional secrets needed. GitHub token is automatically provided.

### Release Steps

```bash
node scripts/release.mjs app 0.1.0
# Wait for builds to complete, then publish the draft release on GitHub
```

## Notes

- All workflows include caching to speed up builds
- Agent CLI publishes from a generated `dist/package.json` so workspace-only dependencies stay out of the npm artifact
- Tauri builds create draft releases - review before publishing
- Web deploys are automatic on `main` branch updates
- Python package uses PyPI trusted publishing (no API token needed)
