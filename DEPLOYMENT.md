# Deployment Quick Reference

Use the [versioning guide](docs/maintainer-guide/versioning.md) for current package versions, release sources and npm setup. Release commands change versions, commit and create tags; they are not validation-only commands.

## Validate before a release

From the repository root, install the workspace and native development dependencies, then run the affected suites:

```sh
pnpm run check:versions
pnpm --dir packages/core typecheck
pnpm --dir packages/core test
pnpm --dir packages/tensnap-js typecheck
pnpm --dir packages/tensnap-js test
pnpm --dir packages/tensnap-agent typecheck
pnpm --dir packages/tensnap-agent test
(cd packages/tensnap-python && pytest)
(cd packages/tensnap-go && go test ./...)
pnpm run test:julia
```

`pnpm test` runs the full composite workspace/native test command. Live protocol conformance and performance evaluation are separate; see the [testing guide](docs/maintainer-guide/development-setup.md#testing) and [evaluation guide](benchmarks/evaluation/README.md). Existing evidence uses recorded source and may be verified offline after a documentation change; fresh publication execution requires a clean committed implementation and a new output.

## Publication routes

| Component | Preparation and deployment |
| --- | --- |
| Python | `scripts/release.mjs python VERSION` prepares `py-v*`; `python-publish.yml` tests/types/checks coverage before PyPI Trusted Publishing |
| Go | `scripts/release.mjs go VERSION` prepares `packages/tensnap-go/v*`; no dedicated publishing workflow |
| Julia | `scripts/release.mjs julia VERSION` runs native package tests and prepares `tensnap-julia-v*`; registration uses the binding subdirectory |
| Protocol / core / JS / agent | `js-publish.yml` tests and builds selected packages before npm OIDC publishing; `protocol-v*` and `js-v*` trigger their packages, while core/agent use manual dispatch |
| Web | `web-deploy.yml` tests/builds on `main`, then deploys to Netlify with `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` |
| Tauri | `tauri-build.yml` builds on `app-v*`, using the GitHub token |

The npm workflow uses Trusted Publishing without `NPM_TOKEN`. Packages must first exist on npm and have their Trusted Publisher configured; see the versioning guide for bootstrap status and dependency order. There is no separate `agent-publish.yml` workflow.

## Prepare a reviewed release

Replace `VERSION` with the intended new component version and run only the applicable helper:

```sh
node scripts/release.mjs go VERSION
node scripts/release.mjs python VERSION
node scripts/release.mjs julia VERSION
node scripts/release.mjs protocol VERSION
node scripts/release.mjs core VERSION
node scripts/release.mjs js VERSION
node scripts/release.mjs agent VERSION
node scripts/release.mjs app VERSION
```

After reviewing the resulting commit/tag, push the release commit and each desired tag separately. A JavaScript batch can instead be dispatched from the reviewed `main` revision, selecting the intended packages. Publishing and deployment are distinct from local test or offline evidence verification.
