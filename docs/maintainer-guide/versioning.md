# Versioning and release sources

TenSnap uses independent package patch versions within the shared `0.3` release line. The strict wire protocol version is `0.3`; it is independent of package patch versions. As of 2026-10-02, the package versions are:

| Package or component | Version | Source to edit |
| --- | --- | --- |
| `@tensnap/protocol`, `@tensnap/core`, `@tensnap/js`, `@tensnap/agent`, `@tensnap/web`, `@tensnap/benchmark`, `@tensnap/tauri` | `0.3.1` | Each package's `package.json` |
| `@tensnap/examples-js`, `@tensnap/examples-julia` | `0.3.1` | Each example's `package.json` |
| Go binding | `0.3.1` | `packages/tensnap-go/protocol/version.go` (`BindingVersion`) |
| Python binding | `0.3.1` | `packages/tensnap-python/tensnap/_version.py` (`__version__`) |
| Julia binding | `0.3.1` | `packages/tensnap-julia/Project.toml` |
| `@tensnap/web-adapter`, `@tensnap/web-common`, workspace root `tensnap` | `0.3.0` | Each `package.json` |

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
2. Edit each package's source listed above. Use `scripts/release.mjs` for a component release; it updates the relevant source before committing and tagging. For Tauri, the helper keeps Cargo metadata and its lockfile aligned.
3. Update `CHANGELOG.md` using its package-specific heading format, and update the dated version snapshot in this guide.
4. Run `pnpm run check:versions` and the affected package tests before tagging.

The version fields in this dated guide describe the current release state; the files in the table are the sources used by builds and runtime handshakes.
