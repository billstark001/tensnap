# Deployment Quick Reference

## Prerequisites

### Python Package (PyPI)

- Configure [PyPI Trusted Publishing](https://pypi.org/manage/account/publishing/):
  - Publisher: `billstark001/tensnap`
  - Workflow: `python-publish.yml`

### Web App (Netlify)

Add GitHub secrets:

- `NETLIFY_AUTH_TOKEN`
- `NETLIFY_SITE_ID`

### Tauri App

No setup needed - uses GitHub token automatically.

## Release Commands

```bash
# Python package
./scripts/release.sh python 0.1.0

# Tauri desktop app
./scripts/release.sh app 0.1.0

# Web app (automatic on main branch)
git push origin main
```

## Workflows

- **Python**: `.github/workflows/python-publish.yml` (tag `py-v*`)
- **Web**: `.github/workflows/web-deploy.yml` (push to `main`)
- **Tauri**: `.github/workflows/tauri-build.yml` (tag `app-v*`)

See `docs/maintainer-guide/deployment.md` for details.
