# Versioning and release sources

TenSnap uses independent package patch versions within the shared `0.3` release line. The strict wire protocol version is `0.3`; it is independent of package patch versions. The 2026-10-21 checkout prepares the package versions below. These are source versions, not a claim that new artifacts have been published:

| Package or component | Version | Source to edit |
| --- | --- | --- |
| `@tensnap/web` | `0.3.9` | `packages/tensnap-web/package.json` |
| `@tensnap/tauri` | `0.3.7` | `packages/tensnap-tauri/package.json`, `src-tauri/Cargo.toml` and generated `Cargo.lock` |
| `@tensnap/core` | `0.3.6` | `packages/core/package.json` |
| `@tensnap/agent` | `0.3.8` | `packages/tensnap-agent/package.json` |
| `@tensnap/benchmark` | `0.3.7` | `packages/benchmark/package.json` |
| `@tensnap/js` | `0.3.5` | `packages/tensnap-js/package.json` |
| `@tensnap/examples-js`, `@tensnap/web-common` | `0.3.4` | Each package's `package.json` |
| `@tensnap/web-adapter` | `0.3.5` | `packages/web-adapter/package.json` |
| `@tensnap/protocol` | `0.3.3` | `packages/protocol/package.json` |
| `@tensnap/network` | `0.3.1` | `packages/network/package.json` |
| `@tensnap/examples-julia` | `0.3.2` | `examples/julia/package.json` |
| Go binding | `0.3.3` | `packages/tensnap-go/protocol/version.go` (`BindingVersion`) |
| Python binding | `0.3.3` | `packages/tensnap-python/tensnap/_version.py` (`__version__`) |
| Julia binding | `0.3.3` | `packages/tensnap-julia/Project.toml` |
| Workspace root `tensnap` | `0.3.3` | `package.json` |

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

For a batch patch update, compare the release checkout with its upstream baseline and bump each affected package once, including changed examples and the workspace root when their own package content changes. A wrapper without a version still uses its native binding source. This checkout prepares network 0.3.1, JS 0.3.5, agent 0.3.8, benchmark/Tauri 0.3.7 and Web 0.3.9. Core, protocol, shared UI/adapters, examples packages, native language bindings and the root retain their existing versions; the wire and persisted format versions remain unchanged.

The JS package publishes exact workspace dependency versions. The agent's executable bundles workspace code, while its library entry points retain external dependencies: publishing network alone does not update the old CLI. Rebuild and publish network, JS and agent in that order to deliver this fix. The Tauri version prepares a new build of the embedded Web/shared UI; changing its version alone does not produce an installer.

Version changes can also affect environment metadata: keep the local TenSnap entry in the active Julia evaluation manifest aligned with `Project.toml`, and refresh evaluation fingerprints only in the latest active profile version for changed package manifests and locks, without changing that profile version when scientific workloads and measurement semantics are unchanged. Leave superseded profile versions and their hashes untouched. A new profile version is required for scientific/measurement changes; see the [evaluation guide](../../benchmarks/evaluation/README.md#current-checkout-profiles). Recorded evaluation exports retain their original versions, profiles, checksums, and source identities. A version bump does not create new performance evidence.

The version fields in this dated guide describe the current checkout; the files in the table are the sources used by builds and runtime handshakes.

## Publishing JavaScript packages

`.github/workflows/js-publish.yml` publishes `@tensnap/network`, `@tensnap/protocol`, `@tensnap/core`, `@tensnap/js`, and `@tensnap/agent`. Pushing `network-vX.Y.Z`, `protocol-vX.Y.Z` or `js-vX.Y.Z` runs tests and publishes the corresponding package after checking that its manifest version matches the tag. `core-vX.Y.Z` and `agent-vX.Y.Z` are release markers only and do not trigger this workflow; publish those packages through manual dispatch from `main`. `pnpm release:network`, `pnpm release:protocol`, `pnpm release:core`, `pnpm release:js`, and `pnpm release:agent` prepare those tags; push the release commit first and each tag separately.

For a batch release, run **js-publish** manually from `main` in GitHub Actions and select any combination of the five packages. At least one must be selected. The workflow tests and builds only the selected packages, then publishes them in dependency order: network, protocol, core, JS bindings, agent. Ensure each package version is bumped and its `CHANGELOG.md` entry is prepared before running it. Before publishing, the workflow checks that selected versions are new and that any omitted workspace dependency already exists on npm at the required version.

The workflow uses GitHub Actions OIDC with npm Trusted Publishing, so it needs no npm token or repository secret. Configure a GitHub Actions Trusted Publisher on npm for each of the five packages: user `billstark001`, repository `tensnap`, workflow filename `js-publish.yml`, and permission to run `npm publish`. The workflow grants `id-token: write` only to the publish job. It uses `pnpm pack` to resolve workspace dependencies in the network, protocol, core, and JS packages, then runs npm CLI `npm publish` on those tarballs; the agent publishes its generated `dist` directory. Each published manifest names this GitHub repository.

All five packages already exist on npm. The registry check on 2026-10-21 found network 0.3.0, protocol 0.3.3, core 0.3.6, JS 0.3.4 and agent 0.3.6 as the published latest versions. The newer source versions in the table are prepared patches. Their existing registry entries do not establish the current Trusted Publisher configuration; verify that configuration before a later publish. Interactive first-publish/bootstrap instructions apply only to a new package that does not yet exist on npm.

## Resuming a batch

When retrying a partially completed release, select only unpublished package versions. Leave already published dependencies out of the selection; the preflight verifies that their required versions exist. Selecting an already published version intentionally fails before any package is uploaded.

Version/changelog preparation and a branch push do not publish packages. The `network-v*`, `protocol-v*`, `js-v*` and `app-v*` tags trigger publishing or app builds; do not create/push them or dispatch release workflows during a preparation-only change. A feature-branch push also leaves the Web deployment, which runs on `main`, untouched.
