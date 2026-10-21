# Julia Examples

Runnable Julia simulator entry points live here, separate from the Julia binding package in `packages/tensnap-julia`.

`el_farol_viz.jl` demonstrates a layer-local `restore=(replace=...,)` inverse for patrons and paired `restore_hooks` for an exact checkpoint of history and random state. The visualization registers its parameter, chart, monitor, and layer with the Julia binding builders; state inverse functions are in `el_farol_state.jl`.

## Commands

```bash
pnpm --dir examples/julia run instantiate
pnpm --dir examples/julia run demo:el-farol
pnpm --dir examples/julia run demo:schelling
pnpm --dir examples/julia run demo:schelling:makie
pnpm --dir examples/julia run standalone:schelling
pnpm --dir examples/julia run test
```

The `test` command first runs the example reproducibility/clock/checkpoint checks in `test_examples.jl`, then native binding tests through `test_package.jl`. It does not execute benchmark batches. The root package forwards the TenSnap demos:

```bash
pnpm run dev:julia:el-farol
pnpm run dev:julia:schelling
pnpm run dev:julia:schelling:makie
pnpm run standalone:julia:schelling
```

The publication adapters are under `../../benchmarks/schelling/v1/subjects/julia/`; the current full evaluation uses the lock in `../../benchmarks/evaluation/environments/julia/`. Older standalone profiles retain their original `../../benchmarks/schelling/v1/environments/julia/` environment. The examples do not expose hidden browser revision/state signals or benchmark JSON output, and they do not require the benchmark `Manifest.toml`.

The example code is split by responsibility: `schelling.jl` owns scientific dynamics and `SchellingConfig`; `schelling_study.jl` owns reusable trials and sweeps; `schelling_tensnap.jl` builds a configurable TenSnap scenario; and `schelling_makie_app.jl` builds the native teaching UI. Benchmark entry points call these factories instead of copying the model or app.

This file split is a repository reuse choice, not a requirement of the Julia binding. `schelling_viz.jl`, `schelling_viz_makie.jl`, and `schelling_standalone.jl` remain the user-facing launchers; they are thin so the publication adapters can reuse the same scenario, native app and study loop without adding benchmark JSON or hidden DOM probes to the examples. A one-off Julia example can combine these pieces in a single file.

## Schelling Standalone Scientific Task

The standalone study shares the scientific transitions with the other language examples. CSV includes satisfaction, segregation, last movement, steps and separate `satisfied_runs`, `jammed_runs`, and `limit_runs`. In convergence mode, no movement stops the run; it can indicate satisfaction or a blocked full grid. Performance timing and warmup are supplied only by benchmark subjects.

```bash
cd examples/julia
julia --project=. schelling_standalone.jl --steps 1000 \
  --seeds 8 --thresholds 0.30,0.50,0.70,0.90 --mode convergence
```

The WGLMakie UI exposes live similarity and speed controls plus density and group-balance settings that take effect on reset. TenSnap exposes grid size, density, balance and similarity parameters through its normal parameter API.

## Environment

Common environment parsing lives in `utils.jl` and is shared by all Julia entry points.

- `TENSNAP_SERVER_PORT`: WebSocket port for TenSnap examples, default `8765`.
- `TENSNAP_USE_MSGPACK`: `true` by default.
- `TENSNAP_SCHELLING_WIDTH`: grid width, default `50`.
- `TENSNAP_SCHELLING_HEIGHT`: grid height, default `50`.
- `TENSNAP_SCHELLING_DENSITY`: initial occupied density, default `0.8`.
- `TENSNAP_SCHELLING_BALANCE`: share of occupied agents in group 1, default `0.5`.
- `TENSNAP_SCHELLING_THRESHOLD`: similarity threshold, default `0.7`.
- `TENSNAP_SCHELLING_SEED`: integer initialization seed, default `7`.
- `BONITO_HOST`: Makie host, default `127.0.0.1`.
- `BONITO_PORT`: Makie port, default `8080`.
- `BONITO_TICKS_PER_SECOND`: Makie run-loop speed, default `5`.

## Reproducibility

Seeds are ordinary initialization parameters. Editing a seed affects the next reset, and each instance owns its RNG. See the [example guide](../README.md) and [reproducibility contract](../../docs/maintainer-guide/reproducibility.md). Scientific code and normal launchers perform no publication audit file I/O; independent audit adapters live beside benchmark subjects.

Run `instantiate` once after checkout or dependency changes. Ordinary launch commands do not run `Pkg.develop` or `Pkg.instantiate`. Schelling uses the native vector container for its fixed population, preserving traversal order across serialization. It advances through `Agents.step!`; `Agents.abmtime` is its authoritative scientific clock. Schema-3 Schelling and schema-2 bar checkpoints use Julia serialization and require matching source/package/runtime versions. The bar is an El Farol-inspired adaptive-expectations variant: a five-week attendance mean, inertia 0.7 and noise σ=8; diagnostic scores do not select competing predictors.
