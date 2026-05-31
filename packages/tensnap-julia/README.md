# TenSnap.jl

Julia bindings for TenSnap's WebSocket visualization protocol.

The package mirrors the Python and Go bindings at the protocol level while using Julia-friendly, explicit builders instead of macro-heavy APIs.  Models can be plain Julia mutable structs, dictionaries, or models from packages such as `Agents.jl`; the binding only needs functions that initialize, step, reset, and project model state into TenSnap items.

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

## Transport

The current implementation supports JSON WebSocket transport, which is the same default transport used by the Python and Go examples.  MessagePack can be added later without changing the scenario-facing API.

## Examples

The El Farol example follows the repository convention of splitting pure model dynamics from visualization wiring:

```bash
TENSNAP_SERVER_PORT=8765 julia --project=packages/tensnap-julia examples/julia/el_farol_viz.jl
```
