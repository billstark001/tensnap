# Versioning and release sources

TenSnap uses independent package patch versions within the shared `0.3` release line. The strict wire protocol version is `0.3`; it is independent of package patch versions. As of 2026-10-19, the package versions are:

| Package or component | Version | Source to edit |
| --- | --- | --- |
| `@tensnap/web` | `0.3.7` | `packages/tensnap-web/package.json` |
| `@tensnap/tauri` | `0.3.6` | `packages/tensnap-tauri/package.json`, `src-tauri/Cargo.toml` and generated `Cargo.lock` |
| `@tensnap/core`, `@tensnap/agent`, `@tensnap/benchmark` | `0.3.6` | Each package's `package.json` |
| `@tensnap/js`, `@tensnap/examples-js`, `@tensnap/web-adapter` | `0.3.4` | Each package's `package.json` |
| `@tensnap/protocol` | `0.3.3` | `packages/protocol/package.json` |
| `@tensnap/network` | `0.3.0` | `packages/network/package.json` |
| `@tensnap/examples-julia` | `0.3.2` | `examples/julia/package.json` |
| Go binding | `0.3.3` | `packages/tensnap-go/protocol/version.go` (`BindingVersion`) |
| Python binding | `0.3.3` | `packages/tensnap-python/tensnap/_version.py` (`__version__`) |
| Julia binding | `0.3.3` | `packages/tensnap-julia/Project.toml` |
| `@tensnap/web-common`, workspace root `tensnap` | `0.3.3` | Each `package.json` |

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

For a batch patch update, compare the release checkout with its upstream baseline and bump each changed package once, including changed examples and the workspace root. A wrapper without a version still uses its native binding source. The 2026-10-19 workbench/recording branch bumps core, agent, Web, Tauri, web-common, web-adapter, benchmark, JS bindings, JS examples and the root once relative to main. The JS bindings/examples changes are type-import cleanup only. Protocol, network and native language bindings retain their versions because their sources are unchanged; the wire and persisted format versions also remain unchanged.

Version changes can also affect environment metadata: keep the local TenSnap entry in the active Julia evaluation manifest aligned with `Project.toml`, and refresh evaluation fingerprints only in the latest active profile version for changed package manifests and locks, without changing that profile version when scientific workloads and measurement semantics are unchanged. Leave superseded profile versions and their hashes untouched. A new profile version is required for scientific/measurement changes; see the [evaluation guide](../../benchmarks/evaluation/README.md#current-checkout-profiles). Recorded evaluation exports retain their original versions, profiles, checksums, and source identities. A version bump does not create new performance evidence.

The version fields in this dated guide describe the current release state; the files in the table are the sources used by builds and runtime handshakes.

## Publishing JavaScript packages

`.github/workflows/js-publish.yml` publishes `@tensnap/network`, `@tensnap/protocol`, `@tensnap/core`, `@tensnap/js`, and `@tensnap/agent`. Pushing `network-vX.Y.Z`, `protocol-vX.Y.Z` or `js-vX.Y.Z` runs tests and publishes the corresponding package after checking that its manifest version matches the tag. `core-vX.Y.Z` and `agent-vX.Y.Z` are release markers only until their npm packages have been bootstrapped and Trusted Publishers configured; they do not trigger a workflow. `pnpm release:network`, `pnpm release:protocol`, `pnpm release:core`, `pnpm release:js`, and `pnpm release:agent` prepare those tags; push the release commit first and each tag separately.

For a batch release, run **js-publish** manually from `main` in GitHub Actions and select any combination of the five packages. At least one must be selected. The workflow tests and builds only the selected packages, then publishes them in dependency order: network, protocol, core, JS bindings, agent. Ensure each package version is bumped and its `CHANGELOG.md` entry is prepared before running it. Before publishing, the workflow checks that selected versions are new and that any omitted workspace dependency already exists on npm at the required version.

The workflow uses GitHub Actions OIDC with npm Trusted Publishing, so it needs no npm token or repository secret. Configure a GitHub Actions Trusted Publisher on npm for each of the five packages: user `billstark001`, repository `tensnap`, workflow filename `js-publish.yml`, and permission to run `npm publish`. The workflow grants `id-token: write` only to the publish job. It uses `pnpm pack` to resolve workspace dependencies in the network, protocol, core, and JS packages, then runs npm CLI `npm publish` on those tarballs; the agent publishes its generated `dist` directory. Each published manifest names this GitHub repository.

An npm package must already exist before its Trusted Publisher can be configured. `@tensnap/protocol` and `@tensnap/js` already exist; `@tensnap/network`, `@tensnap/core`, and `@tensnap/agent` need a one-time interactive first publish by an npm maintainer with 2FA, followed by the same Trusted Publisher configuration. First bootstrap network and publish protocol at the required versions, then bootstrap core, and publish agent only after core exists at the required version. Do not start an automated release for a package until its npm Trusted Publisher is configured.

After the required protocol version is live, a maintainer can bootstrap the two missing packages from a release checkout while signed in to npm:

```bash
pnpm --dir packages/core build
pnpm --dir packages/core pack --out /tmp/tensnap-core.tgz
npm publish /tmp/tensnap-core.tgz --access public
pnpm --dir packages/tensnap-agent build
npm publish ./packages/tensnap-agent/dist --access public
```

The interactive first publish uses the maintainer's npm login and 2FA. Subsequent versions use the GitHub OIDC workflow after each package's Trusted Publisher has been configured.

`@tensnap/network` starts at **0.3.0** and has its own patch version. It must be bootstrapped on npm before dependents that import it; build and pack `packages/network` first. Existing package versions are unchanged by its introduction.

## Resuming a batch and bootstrapping staged packages

When retrying a partially completed release, select only unpublished package versions. Leave already published dependencies out of the selection; the preflight verifies that their required versions exist. Selecting an already published version intentionally fails before any package is uploaded.

For an initial staged publish, explicitly use public access. The agent publishes its generated `dist` manifest, which contains resolved dependency versions and public access metadata:

```bash
pnpm --dir packages/tensnap-agent build
pnpm --dir packages/tensnap-agent/dist stage publish --access public
```

Configure the package's trusted publisher for `billstark001/tensnap`, workflow `js-publish.yml`, with direct `npm publish` allowed before running the batch. Staging a new package creates its initial registry entry; it does not complete the stable release. A scoped publish without public access can default to restricted access and fail with HTTP 402 on accounts without a private-package plan.
