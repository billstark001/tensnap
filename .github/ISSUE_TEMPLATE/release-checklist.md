---
name: Release Checklist
about: Checklist for maintainers preparing a release
title: 'Release [Component] v[X.Y.Z]'
labels: release
assignees: ''
---

## Pre-release Checklist

- [ ] All tests passing
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] Version bumped in appropriate files

### Python Package

- [ ] Version updated in `packages/tensnap-python/pyproject.toml`
- [ ] PyPI trusted publishing configured

### Tauri App

- [ ] Version updated in `packages/tensnap-tauri/package.json`
- [ ] Version updated in `packages/tensnap-tauri/src-tauri/Cargo.toml`
- [ ] Tested on all target platforms

### Web App

- [ ] Build tested locally
- [ ] Netlify secrets configured

## Release Steps

- [ ] Create and push tag
- [ ] Monitor GitHub Actions workflow
- [ ] Verify deployment/release
- [ ] Test deployed version
- [ ] Update GitHub release notes (if applicable)

## Post-release

- [ ] Announcement posted
- [ ] Documentation site updated
- [ ] Close milestone
