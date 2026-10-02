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

- [ ] Each affected package's `package.json` version updated once (current patches are `0.3.0` or `0.3.1`)
- [ ] Protocol wire version remains `0.3` unless the wire contract changes

### Go Binding

- [ ] Binding version updated in `packages/tensnap-go/protocol/version.go` (currently `0.3.1`)
- [ ] Nested-module tag uses `packages/tensnap-go/vX.Y.Z`

### Python Package

- [ ] Version updated in `packages/tensnap-python/tensnap/_version.py` (currently `0.3.1`)
- [ ] Wheel metadata version matches the Python binding version
- [ ] PyPI trusted publishing configured

### Julia Package

- [ ] Version updated in `packages/tensnap-julia/Project.toml` (currently `0.3.1`)
- [ ] Native Julia package tests passing
- [ ] Registrator comment prepared with `@JuliaRegistrator register subdir=packages/tensnap-julia`

### Tauri App

- [ ] Version updated in `packages/tensnap-tauri/package.json`
- [ ] Cargo version and lockfile match `package.json` (currently `0.3.1`)
- [ ] `tauri.conf.json` still reads `../package.json`
- [ ] Tested on all target platforms

### Web App

- [ ] Build tested locally
- [ ] Netlify secrets configured

## Release Steps

- [ ] Create the tag
- [ ] Push the release commit, then push each tag in a separate command (`git push origin <tag>`). Do not batch tags: GitHub Actions does not create tag-push events when more than three tags are pushed together.
- [ ] Monitor the matching GitHub Actions workflow, if the component has one (currently `py-v*` and `agent-v*` only)
- [ ] Verify deployment/release
- [ ] Test deployed version
- [ ] Update GitHub release notes (if applicable)

## Post-release

- [ ] Announcement posted
- [ ] Documentation site updated
- [ ] Close milestone
