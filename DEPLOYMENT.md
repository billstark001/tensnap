# Deployment Quick Reference

## Prerequisites

### Python Package (PyPI)

- Configure [PyPI Trusted Publishing](https://pypi.org/manage/account/publishing/):
  - Publisher: `billstark001/tensnap`
  - Workflow: `python-publish.yml`

### Go Module

- No extra secret required.
- Publish by creating a submodule tag: `packages/tensnap-go/v*`

### Agent CLI Package (npm)

Add GitHub secret:

- `NPM_TOKEN`

### JavaScript Bindings Package (npm)

Publish from `packages/tensnap-js` after preparing the release:

```bash
pnpm build
pnpm publish
```

### Web App (Netlify)

Add GitHub secrets:

- `NETLIFY_AUTH_TOKEN`
- `NETLIFY_SITE_ID`

### Tauri App

No setup needed - uses GitHub token automatically.

## Release Commands

```bash
# Go module
node scripts/release.mjs go 0.1.0

# Python package
node scripts/release.mjs python 0.1.0

# JavaScript bindings package
node scripts/release.mjs js 0.1.0

# Agent CLI package
node scripts/release.mjs agent 0.1.0

# Tauri desktop app
node scripts/release.mjs app 0.1.0

# Web app (automatic on main branch)
git push origin main
```

## Workflows

- **Go**: No dedicated workflow yet (publish by pushing tag `packages/tensnap-go/v*`)
- **Python**: `.github/workflows/python-publish.yml` (tag `py-v*`)
- **JavaScript Bindings**: publish manually from `packages/tensnap-js` after tag `js-v*`
- **Agent CLI**: `.github/workflows/agent-publish.yml` (tag `agent-v*`)
- **Web**: `.github/workflows/web-deploy.yml` (push to `main`)
- **Tauri**: `.github/workflows/tauri-build.yml` (tag `app-v*`)

See `docs/maintainer-guide/deployment.md` for details.
