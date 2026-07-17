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

### Julia Package

- [ ] Version updated in `packages/tensnap-julia/Project.toml`
- [ ] Native Julia package tests passing
- [ ] Registrator comment prepared with `@JuliaRegistrator register subdir=packages/tensnap-julia`

### Tauri App

- [ ] Version updated in `packages/tensnap-tauri/package.json`
- [ ] Version updated in `packages/tensnap-tauri/src-tauri/Cargo.toml`
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
