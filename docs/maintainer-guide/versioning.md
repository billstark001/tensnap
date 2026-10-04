# Versioning and release sources

TenSnap uses independent package patch versions within the shared `0.3` release line. The strict wire protocol version is `0.3`; it is independent of package patch versions. As of 2026-10-04, the package versions are:

| Package or component | Version | Source to edit |
| --- | --- | --- |
| `@tensnap/web`, `@tensnap/tauri` | `0.3.3` | Each package's `package.json`; Tauri also mirrors the version in `src-tauri/Cargo.toml` and `Cargo.lock` |
| `@tensnap/protocol`, `@tensnap/core`, `@tensnap/js`, `@tensnap/agent`, `@tensnap/benchmark` | `0.3.2` | Each package's `package.json` |
| `@tensnap/examples-js`, `@tensnap/examples-julia` | `0.3.2` | Each example's `package.json` |
| Go binding | `0.3.2` | `packages/tensnap-go/protocol/version.go` (`BindingVersion`) |
| Python binding | `0.3.2` | `packages/tensnap-python/tensnap/_version.py` (`__version__`) |
| Julia binding | `0.3.2` | `packages/tensnap-julia/Project.toml` |
| `@tensnap/web-adapter`, `@tensnap/web-common`, workspace root `tensnap` | `0.3.1` | Each `package.json` |

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
2. Edit each package's source listed above. Use `scripts/release.mjs` for a component release; it updates the relevant source before committing and tagging. The `protocol`, `core`, `js`, and `agent` components each retain their own version and tag. For Tauri, the helper keeps Cargo metadata and its lockfile aligned.
3. Update `CHANGELOG.md` using its package-specific heading format, and update the dated version snapshot in this guide.
4. Run `pnpm run check:versions` and the affected package tests before tagging.

The version fields in this dated guide describe the current release state; the files in the table are the sources used by builds and runtime handshakes.

## Publishing JavaScript packages

`.github/workflows/js-publish.yml` publishes `@tensnap/protocol`, `@tensnap/core`, `@tensnap/js`, and `@tensnap/agent`. Pushing `protocol-vX.Y.Z` or `js-vX.Y.Z` runs tests and publishes the corresponding package after checking that its manifest version matches the tag. `core-vX.Y.Z` and `agent-vX.Y.Z` are release markers only until their npm packages have been bootstrapped and Trusted Publishers configured; they do not trigger a workflow. `pnpm release:protocol`, `pnpm release:core`, `pnpm release:js`, and `pnpm release:agent` prepare those tags; push the release commit first and each tag separately.

For a batch release, run **js-publish** manually from `main` in GitHub Actions and select any combination of the four packages. At least one must be selected. The workflow tests and builds only the selected packages, then publishes them in dependency order: protocol, core, JS bindings, agent. Ensure each package version is bumped and its `CHANGELOG.md` entry is prepared before running it. Before publishing, the workflow checks that selected versions are new and that any omitted workspace dependency already exists on npm at the required version.

The workflow uses GitHub Actions OIDC with npm Trusted Publishing, so it needs no npm token or repository secret. Configure a GitHub Actions Trusted Publisher on npm for each of the four packages: user `billstark001`, repository `tensnap`, workflow filename `js-publish.yml`, and permission to run `npm publish`. The workflow grants `id-token: write` only to the publish job. It uses `pnpm pack` to resolve workspace dependencies in the protocol, core, and JS packages, then runs npm CLI `npm publish` on those tarballs; the agent publishes its generated `dist` directory. Each published manifest names this GitHub repository.

An npm package must already exist before its Trusted Publisher can be configured. `@tensnap/protocol` and `@tensnap/js` already exist; `@tensnap/core` and `@tensnap/agent` need a one-time interactive first publish by an npm maintainer with 2FA, followed by the same Trusted Publisher configuration. First publish protocol at the required version, then bootstrap core, and publish agent only after core exists at the required version. Do not start an automated release for a package until its npm Trusted Publisher is configured.

After the required protocol version is live, a maintainer can bootstrap the two missing packages from a release checkout while signed in to npm:

```bash
pnpm --dir packages/core build
pnpm --dir packages/core pack --out /tmp/tensnap-core.tgz
npm publish /tmp/tensnap-core.tgz --access public
pnpm --dir packages/tensnap-agent build
npm publish ./packages/tensnap-agent/dist --access public
```

The interactive first publish uses the maintainer's npm login and 2FA. Subsequent versions use the GitHub OIDC workflow after each package's Trusted Publisher has been configured.
