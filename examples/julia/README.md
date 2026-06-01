# Julia Examples

Runnable Julia simulator entry points live here, separate from the Julia binding package in `packages/tensnap-julia`.

## Commands

```bash
pnpm --dir examples/julia run instantiate
pnpm --dir examples/julia run demo:el-farol
pnpm --dir examples/julia run demo:schelling
pnpm --dir examples/julia run demo:schelling:makie
pnpm --dir examples/julia run test
```

The root package forwards the TenSnap demos:

```bash
pnpm run dev:julia:el-farol
pnpm run dev:julia:schelling
pnpm run dev:julia:schelling:makie
```

## Environment

Common environment parsing lives in `utils.jl` and is shared by all Julia entry points.

- `TENSNAP_SERVER_PORT`: WebSocket port for TenSnap examples, default `8765`.
- `TENSNAP_USE_MSGPACK`: `true` by default.
- `TENSNAP_SCHELLING_WIDTH`: grid width, default `50`.
- `TENSNAP_SCHELLING_HEIGHT`: grid height, default `50`.
- `TENSNAP_SCHELLING_DENSITY`: initial occupied density, default `0.8`.
- `TENSNAP_SCHELLING_THRESHOLD`: similarity threshold, default `0.7`.
- `TENSNAP_SCHELLING_SEED`: optional integer seed.
- `BONITO_HOST`: Makie host, default `127.0.0.1`.
- `BONITO_PORT`: Makie port, default `8080`.
- `BONITO_TICKS_PER_SECOND`: Makie run-loop speed, default `5`.
