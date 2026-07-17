# TenSnap.jl

Julia bindings for TenSnap's WebSocket visualization protocol.

The package mirrors the Python and Go bindings at the protocol level while using Julia-friendly, explicit builders instead of macro-heavy APIs.  Models can be plain Julia mutable structs, dictionaries, or models from packages such as `Agents.jl`; the binding only needs functions that initialize, step, reset, and project model state into TenSnap items.

For the full API surface, see [../../docs/api-reference/julia-api.md](../../docs/api-reference/julia-api.md).

## Install from this repository

```julia
using Pkg
Pkg.develop(path="packages/tensnap-julia")
```

## Core concepts

```julia
using TenSnap

scenario = Scenario(port=8765)
register_model!(scenario, model; init=init!, step=step!, reset=reset!)

add_parameter!(scenario, parameter("attendance_threshold";
    type="number", value=60, min=0, max=100, step=1,
    getter=m -> m.threshold,
    setter=v -> (model.threshold = Int(v)),
))

add_chart!(scenario, chart("attendance", m -> m.attendance; label="Attendance"))

env = environment("world"; type="2d")
add_layer!(env, agents_layer("people", m -> m.agents;
    projector=autoagentprojector(color=a -> a.attending ? "#2f9e44" : "#adb5bd"),
))
add_environment!(scenario, env)

run!(scenario)
```

## Agents.jl compatibility

`agents_layer` is deliberately generic:

- pass `m -> allagents(m)` when using `Agents.jl`;
- pass `m -> m.agents` for a plain Julia model;
- provide any projector returning dictionaries with fields such as `id`, `x`, `y`, `color`, `size`, `heading`, and `icon`.

`autoagentprojector()` understands common `Agents.jl` conventions including `id` and tuple/vector `pos` fields, but it does not require `Agents.jl` to be installed.


## Runtime features

TenSnap.jl now covers the core protocol helpers available in the Python and Go bindings:

- fine-grained environment and layer create/delete helpers via `add_environment!`, `remove_environment!`, `add_layer!`, and `remove_layer!`;
- item-level create/update/delete helpers plus automatic incremental layer diffing from `item_key_fields`;
- asset cache helpers with `publish_asset!` / `delete_asset!`, including renderer `asset_sync` handling;
- screenshot request plumbing with `request_screenshot!` for connected renderers that support `screenshot_response`.
- monitor create/value/delete helpers and strict delete-then-create metadata replacement;
- reset replay with declaration updates, old-agent deletion, chart clearing,
  and current monitor values;
- chart-free scene restore with projected hooks, model-data checkpoint hooks,
  request-id caching, and checkpoint rollback;
- first-class trajectory `length`, `width`, `color`, `z_index`,
  `on_agent_delete`, `on_state_sync`, and `on_reset` keywords.

Every connection starts with `simulator_info`. Use stable `model_id` and
`state_schema_version` values for compatible restores; `instance_id` is managed
per `Scenario` and survives reconnect/reset.

## Transport

The implementation supports JSON and MessagePack WebSocket transport. Incoming frames are auto-detected, and responses follow each client's observed encoding after the first message. Use `Scenario(use_msgpack=true)` for `tensnap-agent`'s default MessagePack mode, or `Scenario(use_msgpack=false)` for JSON-first clients.

## Examples

The examples live outside the Julia package so the root `pnpm` workspace does not need a separate npm-scoped Julia package.

```bash
TENSNAP_SERVER_PORT=8765 pnpm --dir examples/julia run demo:el-farol
TENSNAP_SERVER_PORT=8765 pnpm --dir examples/julia run demo:schelling
pnpm --dir examples/julia run demo:schelling:makie
```

## Release

Release preparation is wired through the repository release helper:

```bash
pnpm run release:julia -- 0.3.0
```

The helper updates `packages/tensnap-julia/Project.toml`, runs native Julia
package tests, commits the version bump if needed, and creates an annotated
`tensnap-julia-vX.Y.Z` tag. For Julia General registration from this monorepo
layout, use Registrator with:

```text
@JuliaRegistrator register subdir=packages/tensnap-julia
```
