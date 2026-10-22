# Development Setup

Quick guide to set up a development environment for TenSnap.

## Prerequisites

- **Git**: Version control
- **Python 3.10+**: For Python backend
- **Node.js 24+** and **pnpm 12.x**: For the TypeScript 7/Vite 8 workspace
- **Go 1.22+**: For Go bindings and examples
- **Julia 1.9+**: For TenSnap.jl and Julia examples
- **Rust 1.88+ & Cargo**: For the current Tauri dependency graph (optional)

## Setup Steps

### 1. Clone Repository

```bash
git clone https://github.com/billstark001/tensnap.git
cd tensnap
```

### 2. Install Dependencies

**JavaScript/TypeScript:**

```bash
pnpm install  # Installs all workspace packages
```

The workspace compiles with TypeScript 7. `zod-to-ts` still executes the removed pre-v7 JavaScript compiler API, so `.pnpmfile.cjs` gives it a private TypeScript 6 runtime. Do not remove that compatibility dependency until upstream supports the TypeScript 7 APIs; application and library typechecks continue to resolve TypeScript 7.

`pnpm lint` runs Oxlint across repository JavaScript/TypeScript, checks all repository Python files with Ruff and Julia sources with JuliaFormatter, and runs package typechecks and native linters. Oxlint warnings fail the check; use `pnpm lint:js` for the focused zero-warning check. `pnpm lint:python` runs repository-wide Python lint and formatting checks. `pnpm format:js` formats JavaScript/TypeScript with Oxfmt; `pnpm format:md` formats Markdown with `proseWrap: "never"`. `pnpm format` runs both and the Go/Python/Julia formatters. `pnpm format:python` includes all repository Python files, including runtime tests, benchmarks, conformance tools and examples. `pnpm lint:julia` and `pnpm format:julia` cover the equivalent Julia source, test, example and adapter directories.

Oxlint enforces `typescript/consistent-type-imports` globally, including tests. Use static `import type` declarations (or named `type` specifiers) for types. Type-position `import('module').Type` and `typeof import('module')` are forbidden; use a top-level type namespace import for module type queries. Runtime dynamic `import()` remains available for lazy loading.

Use paired `// #region Name` / `// #endregion` comments for foldable source sections. Oxlint's existing `no-warning-comments` rule warns about decorative dash/equal-sign separators in package source; it does not prohibit TODO/FIXME notes, and test fixtures are excluded from this style rule.

Oxfmt excludes generated Lingui modules, Tauri schemas, the conformance matrix, and all `benchmark-results/` evidence, including published reports whose bytes are hashed. Regenerate these files with their owning tools.

Vite and Vitest configs use native ESM: resolve paths from `import.meta.dirname` and import package metadata with `with { type: 'json' }`. To check the native Vite loader explicitly, run `pnpm --filter @tensnap/web exec vite build --configLoader native`; preview supports the same flag. Keep these configs free of CommonJS globals so both the default and native loaders work.

To refresh the npm toolchain, run both root and workspace updates, then verify cross-package tool versions before installing:

```bash
ncu -u
ncu -u -w
pnpm install
pnpm peers check
```

**Python:**

```bash
cd packages/tensnap-python
python -m venv venv
source venv/bin/activate  # Windows: .\venv\Scripts\activate
pip install -e ".[dev]"
```

**Go:**

```bash
cd packages/tensnap-go
go test ./...
```

**Julia:**

```bash
julia --project=packages/tensnap-julia -e 'using Pkg; Pkg.instantiate(); Pkg.test()'
```

## Development Workflow

### Running in Development

**Web frontend:**

```bash
pnpm dev:web  # Starts at http://localhost:3200
```

**Python simulation examples:**

```bash
# Using pnpm scripts from repository root
pnpm dev:py:flock      # Flocking behavior
pnpm dev:py:hk         # Hegselmann-Krause opinion dynamics
pnpm dev:py:sirs:grid  # SIRS epidemic on grid
pnpm dev:py:cgol       # Conway's Game of Life (Mesa)
pnpm dev:py:schelling  # Schelling segregation (Mesa + TenSnap)
pnpm dev:py:schelling:solara # Schelling segregation (Mesa + Solara)
pnpm dev:py:sugarscape # Sugarscape (Mesa)
pnpm dev:py:mushroom   # Mushroom foraging (Mesa)
pnpm standalone:py:schelling # Headless Schelling threshold sweep

# Or run directly from examples directory
cd examples/python
python flock_viz.py

cd examples/python_mesa
python cgol_viz.py
```

**Go simulation examples:**

```bash
pnpm dev:go:schelling
pnpm standalone:go:schelling
```

**JavaScript simulation examples:**

```bash
pnpm dev:js:schelling
pnpm dev:js:wolf-sheep
pnpm standalone:js:schelling
```

**Julia simulation examples:**

```bash
pnpm run dev:julia:el-farol
pnpm run dev:julia:schelling
pnpm run dev:julia:schelling:makie
pnpm run standalone:julia:schelling
```

**Tauri desktop app:**

```bash
pnpm dev:tauri
```

Tauri JavaScript and Rust plugins must be upgraded together. Keep `@tauri-apps/plugin-*` in `packages/tensnap-tauri/package.json` aligned with the corresponding `tauri-plugin-*` crates, run `cargo update` from `packages/tensnap-tauri/src-tauri`, and commit that directory's `Cargo.lock`.

### Project Structure

```
tensnap/
├── benchmarks/              # Versioned benchmark subjects, profiles, locks, and oracles
├── docs/                    # Documentation
├── examples/
│   ├── js/                  # JavaScript examples and local simulator manifests
│   ├── go/                  # Go examples
│   ├── julia/               # Julia examples
│   ├── python/              # Python examples (non-Mesa)
│   └── python_mesa/         # Python examples (Mesa-based)
├── packages/
│   ├── benchmark/           # Generic reproducible benchmark execution harness
│   ├── protocol/            # Protocol payload types, schemas, and codecs
│   ├── core/                # Scenario, runtime, stores, and rendering primitives
│   ├── tensnap-agent/       # Headless shared-session host and automation CLI
│   ├── tensnap-go/          # Go protocol, ABM helpers, and server
│   ├── tensnap-js/          # TypeScript simulator bindings and transports
│   ├── tensnap-julia/       # Julia bindings and WebSocket server
│   ├── tensnap-python/      # Python bindings and runtime integration
│   ├── tensnap-tauri/       # Desktop app (Tauri + Rust)
│   ├── tensnap-web/         # Web frontend (React + Vite)
│   ├── web-adapter/         # Browser-side filesystem/integration helpers
│   └── web-common/          # Shared browser UI/types/helpers
└── package.json             # Workspace root
```

Some Schelling launchers are intentionally thin. Visualization commands delegate to reusable TenSnap/native-UI factories, and standalone commands delegate to reusable study helpers, so the user-facing examples and publication harness execute the same reset, trial, and projection behavior. This is a repository reuse boundary rather than required application structure; see the [benchmark ownership guide](../../benchmarks/README.md).

## Code Quality

### Python

**Linting and formatting:**

```bash
cd packages/tensnap-python
pnpm format        # Format library, tests, benchmarks and Python examples
pnpm format:check  # Check formatting without writing
pnpm lint          # Pyright, Ruff lint and formatting checks
pnpm typecheck     # Pyright alone
```

Python type checks use the root `pyrightconfig.json` in basic mode, targeting Python 3.10. The shared scope is `packages/tensnap-python/tensnap` and `packages/tensnap-python/tests/typing`; runtime tests, examples and build outputs are outside the batch check. Pylance reads the same root configuration when the repository is opened in VS Code. Select the same development interpreter in the editor and terminal so dependencies resolve consistently. The development extra pins the Pyright version used by local checks and CI.

PR CI separately runs the binding and example regression tests on Python 3.10–3.14, building protocol schemas before wire-validation tests. The publication workflow repeats the same supported-version matrix before uploading a Python release.

Pylance can still report diagnostics in an opened runtime test or example outside this batch scope; `include` controls file discovery, not diagnostic suppression. To check such a file from the CLI, pass its path explicitly with `-p pyrightconfig.json` from the repository root. Use `python -c 'import tensnap; print(tensnap.__file__)'` to check runtime imports separately: a different interpreter or an older installed package can resolve differently from the workspace paths used by static analysis.

Run `pnpm --filter @tensnap/python typecheck` from the repository root for types alone, or `pnpm --filter @tensnap/python lint` for the same Pyright and Ruff checks used by CI. Ruff covers every library module, runtime test, package benchmark and Python example, including formatting and Python 3.10 import compatibility in library code. The configuration has no whole-file exclusions; documented rule exceptions preserve public signatures, protocol dispatch structure, numeric test expectations and optional test imports.

Repository-wide frontend/tooling lint can be run from the workspace root:

```bash
pnpm lint
```

### TypeScript

**Linting:**

```bash
pnpm lint  # All workspace packages
```

### Go

```bash
cd packages/tensnap-go
go test ./...
```

### Julia

```bash
pnpm lint:julia    # Check all repository Julia sources
pnpm format:julia  # Format them with two-space indentation
julia --project=packages/tensnap-julia -e 'using Pkg; Pkg.test()'
```

## Testing

Run commands from the repository root with the intended Python environment active. The complete command is:

```bash
pnpm test
```

It checks version consistency, runs workspace package tests (including native Python/Go/Julia wrappers), then runs Go example tests and the Julia examples wrapper. It requires installed native runtimes and dependencies; it is not only a TypeScript test command. The Julia wrapper runs native binding package tests, so the full root command can exercise that suite more than once.

For focused checks:

```bash
pnpm --filter @tensnap/core test
pnpm --filter @tensnap/web test
pnpm --filter @tensnap/agent test
(cd packages/tensnap-python && pytest)
PYTHONPATH=examples pytest -q examples/python_dqn/tests
(cd packages/tensnap-go && go test ./...)
pnpm run test:go:examples
pnpm run test:julia
```

To select individual Vitest files, invoke the runner directly so pnpm's argument separator is not forwarded as a literal `--`:

```bash
pnpm --filter @tensnap/js exec vitest run src/bindings/utils.test.ts
(cd packages/tensnap-python && pytest -q -o addopts='' tests/test_attr_projector.py)
```

Small performance checks can run independently of the publication harness:

```bash
pnpm --filter @tensnap/web exec vitest bench --run src/utils/layout/guideline.bench.ts --reporter=verbose
pnpm --filter @tensnap/web exec vitest bench --run src/utils/view/collision.bench.ts --reporter=verbose
pnpm --filter @tensnap/js exec vitest bench --run src/bindings/fields.bench.ts src/bindings/utils.bench.ts --reporter=verbose
(cd packages/tensnap-go && go test ./abm -run '^$' -bench BenchmarkNaiveItemDiffTrackerCompoundKeys -benchmem)
(cd packages/tensnap-go && go test ./abm -run '^$' -fuzz FuzzNaiveItemDiffTrackerCompoundKeys -fuzztime=30s)
(cd packages/tensnap-go && go test ./abm -run '^$' -fuzz FuzzNaiveItemDiffTrackerReplay -fuzztime=30s)
(cd packages/tensnap-go && go test ./protocol -run '^$' -fuzz FuzzMsgPackCodecDecodeRecovery -fuzztime=30s)
(cd packages/tensnap-python && python benchmarks/item_diff.py --case unchanged-scalar --count 10000)
```

Benchmark files use the installed Vitest runner's `test('...', async ({ bench }) => { await bench(...).run(); })` context API. Compare matching inputs on an otherwise idle machine; a microbenchmark only supports conclusions about the measured path.

Live [conformance checks](../../conformance/README.md) and publication [evaluation profiles](../../benchmarks/evaluation/README.md) are separate from unit suites. The latter use their own committed scientific environment locks and output/work/cache directories. Existing published evidence can be checked with `pnpm evaluation verify --input benchmark-results/evaluation-full-2026-10-09`; this is offline and runs no experiment. Do not run timing profiles concurrently with unit suites.

## Building

```bash
pnpm build:web    # Web frontend → packages/tensnap-web/dist/
pnpm build:tauri  # Desktop app → packages/tensnap-tauri/src-tauri/target/release/
```

## IDE Setup (Optional)

### VS Code

Recommended extensions: Python, Pylance, Ruff, ESLint, Rust Analyzer (for Tauri)

Configure Python interpreter to use `packages/tensnap-python/venv/bin/python`.

## Troubleshooting

**Python module not found:**

```bash
source packages/tensnap-python/venv/bin/activate
pip install -e "./packages/tensnap-python[dev]"
```

**TypeScript errors:**

```bash
pnpm clean
pnpm install
```

**WebSocket connection fails:**

Ensure a simulator server is running first (for example `pnpm dev:py:flock`, `pnpm dev:go:schelling`, `pnpm dev:js:schelling`, or `pnpm run dev:julia:schelling`), then start the web frontend.

**Build fails:**

```bash
pnpm clean
pnpm install
pnpm build:web
```

## Next Steps

- [Architecture Documentation](./architecture.md) - System design and components
- [Protocol package](../../packages/protocol/README.md) - Current renderer/simulator protocol schemas and generated documentation workflow
- [Contributing Guidelines](./contributing.md) - Contribution workflow
