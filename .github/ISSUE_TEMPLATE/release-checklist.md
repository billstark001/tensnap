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
- [ ] Current versions and sources checked against `docs/maintainer-guide/versioning.md`
- [ ] `pnpm run check:versions` passes

### npm Packages and Examples

- [ ] Each affected package's `package.json` version updated once (see `docs/maintainer-guide/versioning.md` for current versions)
- [ ] Protocol wire version remains `0.3` unless the wire contract changes
- [ ] For a JavaScript batch release, select 1–4 packages in `js-publish`; confirm omitted workspace dependencies are already published at the required versions
- [ ] Each selected npm package has a Trusted Publisher for `billstark001/tensnap` and `js-publish.yml`; bootstrap unpublished packages interactively first

### Go Binding

- [ ] Binding version updated in `packages/tensnap-go/protocol/version.go` (see versioning guide)
- [ ] Nested-module tag uses `packages/tensnap-go/vX.Y.Z`

### Python Package

- [ ] Version updated in `packages/tensnap-python/tensnap/_version.py` (see versioning guide)
- [ ] Wheel metadata version matches the Python binding version
- [ ] PyPI trusted publishing configured

### Julia Package

- [ ] Version updated in `packages/tensnap-julia/Project.toml` (see versioning guide)
- [ ] Native Julia package tests passing
- [ ] Registrator comment prepared with `@JuliaRegistrator register subdir=packages/tensnap-julia`

### Tauri App

- [ ] Version updated in `packages/tensnap-tauri/package.json`
- [ ] Cargo version and lockfile match `package.json`
- [ ] `tauri.conf.json` still reads `../package.json`
- [ ] Tested on all target platforms

### Web App

- [ ] Build tested locally
- [ ] Netlify secrets configured

## Release Steps

- [ ] Create the package tag, or select the packages for a manual JavaScript batch
- [ ] Push the release commit, then push each tag in a separate command (`git push origin <tag>`), or run `js-publish` manually from the release commit. Do not batch tags: GitHub Actions does not create tag-push events when more than three tags are pushed together.
- [ ] Monitor the matching GitHub Actions workflow (`python-publish` for `py-v*`; `js-publish` for `protocol-v*` and `js-v*`; core and agent require manual dispatch after npm setup)
- [ ] Verify deployment/release
- [ ] Test deployed version
- [ ] Update GitHub release notes (if applicable)

## Post-release

- [ ] Announcement posted
- [ ] Documentation site updated
- [ ] Close milestone
