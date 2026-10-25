# Versioning and release sources

TenSnap uses independent package patch versions within the shared `0.3` release line. The strict wire protocol version is `0.3`; it is independent of package patch versions. The 2026-10-26 checkout prepares the package versions below. These are source versions, not a claim that new artifacts have been published:

| Package or component | Version | Source to edit |
| --- | --- | --- |
| `@tensnap/web` | `0.3.10` | `packages/tensnap-web/package.json` |
| `@tensnap/tauri` | `0.3.10` | `packages/tensnap-tauri/package.json`, `src-tauri/Cargo.toml` and generated `Cargo.lock` |
| `@tensnap/core` | `0.3.8` | `packages/core/package.json` |
| `@tensnap/agent` | `0.3.10` | `packages/tensnap-agent/package.json` |
| `@tensnap/benchmark` | `0.3.8` | `packages/benchmark/package.json` |
| `@tensnap/js` | `0.3.6` | `packages/tensnap-js/package.json` |
| `@tensnap/examples-js` | `0.3.5` | `examples/js/package.json` |
| `@tensnap/web-common` | `0.3.5` | `packages/web-common/package.json` |
| `@tensnap/web-adapter` | `0.3.6` | `packages/web-adapter/package.json` |
| `@tensnap/protocol` | `0.3.3` | `packages/protocol/package.json` |
| `@tensnap/network` | `0.3.1` | `packages/network/package.json` |
| `@tensnap/examples-julia` | `0.3.4` | `examples/julia/package.json` |
| Go binding | `0.3.4` | `packages/tensnap-go/protocol/version.go` (`BindingVersion`) |
| Python binding | `0.3.7` | `packages/tensnap-python/tensnap/_version.py` (`__version__`) |
| Julia binding | `0.3.4` | `packages/tensnap-julia/Project.toml` |
| Workspace root `tensnap` | `0.3.5` | `package.json` |

The private pnpm wrappers under `packages/tensnap-go`, `packages/tensnap-python`, and `packages/tensnap-julia` have no npm version: they run native build and test commands, while their native sources above define release versions.

## Where versions flow

- JavaScript binding handshakes read `@tensnap/js/package.json`.
- Python distribution metadata is derived by setuptools from `_version.py`; Python's public `__version__` and binding handshake import the same value.
- Julia handshakes use `pkgversion(TenSnap)` from `Project.toml`.
- Go's `abm` and `server` packages use `protocol.BindingVersion`.
- `@tensnap/protocol/src/schemas.ts` defines `PROTOCOL_VERSION = '0.3'` for TypeScript schemas and consumers. Go, Python, and Julia each define their own protocol constant because their published artifacts are independent. The cross-language consistency check compares all four values.
- Tauri's `tauri.conf.json` resolves `../package.json`; its required Cargo package version is separately declared in `src-tauri/Cargo.toml`, with `Cargo.lock` generated from it. The consistency check verifies all three.

## Before a release

1. Bump only the packages affected by the change. If a package was already bumped for that release, do not bump it a second time.
2. Edit each package's source listed above. Use `scripts/release.mjs` for a component release; it updates the relevant source before committing and tagging. The `network`, `protocol`, `core`, `js`, and `agent` components each retain their own version and tag. For Tauri, the helper keeps Cargo metadata and its lockfile aligned.
3. Update `CHANGELOG.md` using its package-specific heading format, and update the dated version snapshot in this guide.
4. Run `pnpm run check:versions` and the affected package tests before tagging.

For a batch patch update, compare the release checkout with its upstream baseline and bump each affected package once, including changed examples and the workspace root when their own package content changes. A wrapper without a version still uses its native binding source. This checkout prepares the versions in the table above. The 2026-10-25 binding audit advances Python to 0.3.7 for opt-in edge/trajectory data and record preservation, Go to 0.3.4 for shared item-layer infrastructure and field selectors, JS to 0.3.6 for common item fields and standalone visual shortcuts, and agent to 0.3.10 for its updated offline APIs and skills. Root advances to 0.3.5 to pin repository-wide Python lint/format checks to the supported Python 3.10 minimum. Agent runtime behavior is unchanged; Julia retains its runtime version because its item pipeline is already shared and only regression tests/documentation changed. No wire or persisted format changes are involved. The 2026-10-26 full release advances Tauri from 0.3.9 to 0.3.10 to produce a new set of four-platform desktop artifacts while retaining the published 0.3.9 assets.

Previous release preparation: The Python parameter-binding patch advances Python from 0.3.4 to 0.3.6. Publication of 0.3.5 stopped in the Python 3.14 test matrix before uploading; 0.3.6 corrects wrapped-constructor annotation discovery. Keep the failed-attempt `py-v0.3.5` tag unchanged and publish from the new `py-v0.3.6` tag. Agent advances from 0.3.8 to 0.3.9 because its offline skill bundle includes the revised binding contract. Repository-wide cleanup advances benchmark from 0.3.7 to 0.3.8 for archive/adapter lint and formatting fixes and root from 0.3.3 to 0.3.4 for conformance runner fixes. Julia and Julia examples advance from 0.3.3 to 0.3.4 for consistent source/test formatting and expanded checks; the Julia syntax trees are unchanged. Python examples have no independently versioned package. The full release also advances Tauri from 0.3.8 to 0.3.9 to build a new set of platform installers without replacing the published 0.3.8 assets. The other components retain their prepared versions. Documentation corrections and current-profile hash refreshes do not change scientific workloads or recorded evidence. The wire and binding-owned persisted formats remain unchanged; current Schelling example checkpoints use schema 3.

The JS package publishes exact workspace dependency versions. The agent's executable bundles workspace code, while its library entry points retain external dependencies: publishing network alone does not update the old CLI. Rebuild and publish network, core, JS and agent in that order so the CLI and external library entry points receive the fixes and the new core query-schema entry. The Tauri version prepares a new build of the embedded Web/shared UI; changing its version alone does not produce an installer.

Version changes can also affect environment metadata: keep the local TenSnap entry in the active Julia evaluation manifest aligned with `Project.toml`, and refresh evaluation fingerprints only in the latest active profile version for changed package manifests and locks, without changing that profile version when scientific workloads and measurement semantics are unchanged. Leave superseded profile versions and their hashes untouched. A new profile version is required for scientific/measurement changes; see the [evaluation guide](../../benchmarks/evaluation/README.md#current-checkout-profiles). Recorded evaluation exports retain their original versions, profiles, checksums, and source identities. A version bump does not create new performance evidence.

The version fields in this dated guide describe the current checkout; the files in the table are the sources used by builds and runtime handshakes.

## Publishing JavaScript packages

`.github/workflows/js-publish.yml` publishes `@tensnap/network`, `@tensnap/protocol`, `@tensnap/core`, `@tensnap/js`, and `@tensnap/agent`. Pushing `network-vX.Y.Z`, `protocol-vX.Y.Z` or `js-vX.Y.Z` runs tests and publishes the corresponding package after checking that its manifest version matches the tag. `core-vX.Y.Z` and `agent-vX.Y.Z` are release markers only and do not trigger this workflow; publish those packages through manual dispatch from `main`. `pnpm release:network`, `pnpm release:protocol`, `pnpm release:core`, `pnpm release:js`, and `pnpm release:agent` prepare those tags; push the release commit first and each tag separately.

For a batch release, run **js-publish** manually from `main` in GitHub Actions and select any combination of the five packages. At least one must be selected. The workflow tests and builds only the selected packages, then publishes them in dependency order: network, protocol, core, JS bindings, agent. Ensure each package version is bumped and its `CHANGELOG.md` entry is prepared before running it. Before publishing, the workflow checks that selected versions are new and that any omitted workspace dependency already exists on npm at the required version.

The workflow uses GitHub Actions OIDC with npm Trusted Publishing, so it needs no npm token or repository secret. Configure a GitHub Actions Trusted Publisher on npm for each of the five packages: user `billstark001`, repository `tensnap`, workflow filename `js-publish.yml`, and permission to run `npm publish`. Leave the environment unset unless the publish job declares the same GitHub environment. The workflow grants `id-token: write` only to the publish job. Its prerequisite check uses `node scripts/verify-js-publish.mjs --oidc` to exchange the GitHub identity for an npm token for every selected package before building or uploading any of them. These tokens are discarded; npm obtains fresh credentials for each publish. It uses `pnpm pack` to resolve workspace dependencies in the network, protocol, core, and JS packages, then runs npm CLI `npm publish` on those tarballs; the agent publishes its generated `dist` directory. Each published manifest names this GitHub repository.

A [new Trusted Publisher expires](https://docs.npmjs.com/trusted-publishers/#trusted-publisher-configuration-expiry) if it does not complete its first successful publish within two days. An expired configuration must be deleted and recreated on npm, followed by a successful publish within that window. On 2026-10-22, an expired configuration caused the `network` release to fail with `E404` even though the package already existed. The OIDC preflight now reports token-exchange failures for all selected packages with their HTTP statuses and recovery steps, instead of letting npm fall back to an unusable credential and fail during upload.

All five packages already exist on npm. The registry check on 2026-10-21 found network 0.3.0, protocol 0.3.3, core 0.3.6, JS 0.3.4 and agent 0.3.6 as the published latest versions. The newer source versions in the table are prepared patches. Their existing registry entries do not establish the current Trusted Publisher configuration; verify that configuration before a later publish. Interactive first-publish/bootstrap instructions apply only to a new package that does not yet exist on npm.

## Resuming a batch

When retrying a partially completed release, select only unpublished package versions. Leave already published dependencies out of the selection; the preflight verifies that their required versions exist. Selecting an already published version intentionally fails before any package is uploaded.

Version/changelog preparation and a branch push do not publish packages. The `network-v*`, `protocol-v*`, `js-v*` and `app-v*` tags trigger publishing or app builds; do not create/push them or dispatch release workflows during a preparation-only change. A feature-branch push also leaves the Web deployment, which runs on `main`, untouched.
