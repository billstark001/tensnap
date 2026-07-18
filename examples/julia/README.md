# Julia Examples

Runnable Julia simulator entry points live here, separate from the Julia binding package in `packages/tensnap-julia`.

## Commands

```bash
pnpm --dir examples/julia run instantiate
pnpm --dir examples/julia run demo:el-farol
pnpm --dir examples/julia run demo:schelling
pnpm --dir examples/julia run demo:schelling:makie
pnpm --dir examples/julia run standalone:schelling
pnpm --dir examples/julia run test
```

The root package forwards the TenSnap demos:

```bash
pnpm run dev:julia:el-farol
pnpm run dev:julia:schelling
pnpm run dev:julia:schelling:makie
pnpm run standalone:julia:schelling
```

The publication adapters and their locked environment are separate, under
`../../benchmarks/schelling/v1/subjects/julia/` and
`../../benchmarks/schelling/v1/environments/julia/`. The examples do not expose
hidden browser revision/state signals or benchmark JSON output, and they do not
require the benchmark `Manifest.toml`.

The example code is split by responsibility: `schelling.jl` owns scientific
dynamics and `SchellingConfig`; `schelling_study.jl` owns reusable trials and
sweeps; `schelling_tensnap.jl` builds a configurable TenSnap scenario; and
`schelling_makie_app.jl` builds the native teaching UI. Benchmark entry points
call these factories instead of copying the model or app.

This file split is a repository reuse choice, not a requirement of the Julia
binding. `schelling_viz.jl`, `schelling_viz_makie.jl`, and
`schelling_standalone.jl` remain the user-facing launchers; they are thin so the
publication adapters can reuse the same scenario, native app and study loop
without adding benchmark JSON or hidden DOM probes to the examples. A one-off
Julia example can combine these pieces in a single file.

## Schelling Standalone Scientific Task

`schelling_standalone.jl` runs the same heavy threshold-sweep task as the
Python, NetLogo, and Go standalone scripts. For each similarity threshold it
runs several seeds and prints CSV columns for final satisfaction, segregation,
last-step movement, steps used, and convergence count. After all scientific rows
are computed, it prints a separate performance row with `total_ticks`,
`elapsed_ms`, `tpms`, and `mspt`; timing is wrapped around each trial's step
loop only, with no per-tick instrumentation in the model hot path.

```bash
cd examples/julia
julia --project=. schelling_standalone.jl --steps 1000 --warmup-steps 25 \
  --seeds 8 --thresholds 0.30,0.50,0.70,0.90 --mode convergence
```

The WGLMakie UI exposes live similarity and speed controls plus density and
group-balance settings that take effect on reset. TenSnap exposes grid size,
density, balance and similarity parameters through its normal parameter API.

## Environment

Common environment parsing lives in `utils.jl` and is shared by all Julia entry points.

- `TENSNAP_SERVER_PORT`: WebSocket port for TenSnap examples, default `8765`.
- `TENSNAP_USE_MSGPACK`: `true` by default.
- `TENSNAP_SCHELLING_WIDTH`: grid width, default `50`.
- `TENSNAP_SCHELLING_HEIGHT`: grid height, default `50`.
- `TENSNAP_SCHELLING_DENSITY`: initial occupied density, default `0.8`.
- `TENSNAP_SCHELLING_BALANCE`: share of occupied agents in group 1, default `0.5`.
- `TENSNAP_SCHELLING_THRESHOLD`: similarity threshold, default `0.7`.
- `TENSNAP_SCHELLING_SEED`: optional integer seed.
- `BONITO_HOST`: Makie host, default `127.0.0.1`.
- `BONITO_PORT`: Makie port, default `8080`.
- `BONITO_TICKS_PER_SECOND`: Makie run-loop speed, default `5`.
