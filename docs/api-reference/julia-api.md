# Julia API Reference

This reference describes the current `TenSnap.jl` simulator-side binding package
in `packages/tensnap-julia`.

The Julia binding is a native Julia package with a `Project.toml`; it is not an
npm workspace package. It exposes protocol v0.2 over WebSocket with JSON and
MessagePack support.

## Installation

From this repository:

```julia
using Pkg
Pkg.develop(path="packages/tensnap-julia")
```

## Quick Start

```julia
using TenSnap

mutable struct Agent
    id::Int
    x::Float64
    y::Float64
end

mutable struct Model
    agents::Vector{Agent}
    speed::Float64
    ticks::Int
end

model = Model([Agent(1, 0.0, 0.0)], 1.0, 0)
scenario = Scenario(port = 8765)

register_model!(scenario, model;
    init = m -> (m.ticks = 0; m.agents[1].x = 0),
    step = m -> (m.ticks += 1; m.agents[1].x += m.speed),
    reset = m -> (m.ticks = 0; m.agents[1].x = 0),
)

add_parameter!(scenario, parameter("speed";
    value = model.speed,
    min = 0,
    max = 5,
    step = 0.5,
    getter = m -> m.speed,
    setter = (value, m) -> (m.speed = Float64(value)),
))

add_chart!(scenario, chart("ticks", m -> m.ticks; label = "Ticks"))

env = environment("main"; type = "2d")
add_layer!(env, agents_layer("agents", m -> m.agents;
    projector = autoagentprojector(),
))
add_environment!(scenario, env)

run!(scenario)
```

## Scenario

```julia
Scenario(; host = "localhost", port = 8765, use_msgpack = false, step_interval = 0.05)
```

The scenario owns parameters, actions, charts, environments, assets, screenshot
requests, the registered model, lifecycle callbacks, and connected WebSocket
clients.

`Scenario(...)` registers the built-in renderer-driven actions:

- `start`: runs one `step!(scenario)` and returns `continue = true`.
- `step`: runs one `step!(scenario)` and returns `continue = false`.
- `reset`: runs `reset!(scenario)` and returns `continue = false`.

The first simulated tick emitted by `step!` is time `1`; reset returns the
scenario to time `0`.

## Model Lifecycle

- `register_model!(scenario, model; init=nothing, step=nothing, reset=nothing)`
- `run!(scenario; verbose=true)`
- `sync!(scenario, ws=nothing)`
- `step!(scenario)`
- `reset!(scenario)`
- `clear_charts!(scenario; ids=collect(keys(scenario.charts)))`
- `log!(scenario, level, message)`

`run!` listens on `127.0.0.1` when `host == "localhost"`, matching the Python
and Go local simulator behavior.

## Parameters, Actions, and Charts

### Parameters

```julia
add_parameter!(scenario, parameter("threshold";
    type = "number",
    value = 0.4,
    min = 0,
    max = 1,
    step = 0.05,
    getter = m -> m.threshold,
    setter = (value, m) -> (m.threshold = Float64(value)),
))
```

Helpers:

- `parameter(id; label=id, type="number", value=nothing, min=nothing, max=nothing, step=nothing, options=nothing, getter=nothing, setter=nothing)`
- `add_parameter!(scenario, parameter)`
- `remove_parameter!(scenario, id)`

Renderer `param_change` messages update the parameter through its setter when
one is present, then emit `param_sync`.

### Actions

```julia
add_action!(scenario, action("shuffle", m -> shuffle!(m.agents); label = "Shuffle"))
```

Helpers:

- `action(id, handler; label=id, continuous=false, continue_on_return=false)`
- `add_action!(scenario, action)`
- `remove_action!(scenario, id)`

When `continue_on_return=true`, the handler return value controls the
`action_end.continue` flag.

### Charts

```julia
add_chart!(scenario, chart("population", m -> length(m.agents);
    label = "Population",
    color = "#228be6",
))
```

`chart(...)` accepts scalar values, dictionaries, tuples, or vectors. Dictionary
keys and `series` ids become chart series ids.

Helpers:

- `chart(id, getter; label=id, color="#228be6", series=nothing)`
- `add_chart!(scenario, chart)`
- `remove_chart!(scenario, id)`

## Environments and Layers

### Builders

- `environment(id; type="2d", layers=Layer[])`
- `layer(id, type, items; data=nothing, dependency_layer_ids=Dict(), item_key_fields=String[])`
- `agents_layer(id, getagents=agents_getter; projector=autoagentprojector(), data=nothing, dependency_layer_ids=Dict(), item_key_fields=["id"])`
- `grid_layer(id, items; data=nothing, item_key_fields=["x", "y"])`
- `patch_layer(id, items; data=nothing, item_key_fields=["x", "y"])`
- `edge_layer(id, items; data=nothing, dependency_layer_ids=Dict(), item_key_fields=["source", "target"])`

### Registration Helpers

- `add_environment!(scenario, environment)`
- `remove_environment!(scenario, id)`
- `add_layer!(environment, layer)`
- `add_layer!(scenario, env_id, layer)`
- `remove_layer!(scenario, env_id, layer_id)`

Layer dependencies are emitted before dependent layers during full sync.

### Item Updates

- `create_items!(scenario, env_id, layer_id, items)`
- `update_items!(scenario, env_id, layer_id, items)`
- `delete_items!(scenario, env_id, layer_id, items)`
- `replace_layer_items!(scenario, env_id, layer_id)`

`replace_layer_items!` computes creates, field-level updates, and deletes from
the layer's `item_key_fields`. If no key fields are provided, TenSnap.jl tries
common keys in this order: `id`, `name`, `uid`, `source/target`, `x/y`, then all
item keys.

## Projectors

- `dictprojector(fields=nothing; rename=Dict())`
- `propertyprojector(fields...; rename=Dict())`
- `autoagentprojector(; id=:id, x=:x, y=:y, color=nothing, size=nothing, icon="circle", fields=())`
- `agents_getter(model)`

`autoagentprojector()` supports plain structs and common `Agents.jl` conventions:
`id`, `pos`, `heading`, and optional color/size/icon fields. `Agents.jl` is not
a package dependency.

## Assets and Screenshots

Assets:

- `publish_asset!(scenario, asset_id, data, mime; label=nothing)`
- `delete_asset!(scenario, asset_id)`

String asset data is encoded as bytes. JSON clients receive data URIs; MessagePack
clients receive bytes.

Screenshots:

```julia
payload = request_screenshot!(scenario; env_id = "main", timeout = 5)
```

Exactly one of `env_id` or `chart_id` must be provided. The call waits for a
renderer `screenshot_response`.

## Transport

Incoming frames are auto-detected as JSON or MessagePack. Replies follow the
encoding observed for that client, falling back to `scenario.use_msgpack`.

Use:

- `Scenario(use_msgpack=false)` for JSON-first clients.
- `Scenario(use_msgpack=true)` for MessagePack-first clients such as agent-side tooling.

## Tests and Examples

Package tests:

```bash
julia --project=packages/tensnap-julia -e 'using Pkg; Pkg.test()'
```

Repository scripts:

```bash
pnpm run test:julia
pnpm run dev:julia:el-farol
pnpm run dev:julia:schelling
pnpm run dev:julia:schelling:makie
```

Runnable examples live in `examples/julia`.

