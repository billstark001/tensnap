# Julia API Reference

This reference describes the current `TenSnap.jl` simulator-side binding package
in `packages/tensnap-julia`.

The Julia binding is a native Julia package with a `Project.toml`; it is not an
npm workspace package. It exposes protocol v0.3 over WebSocket with JSON and
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
Scenario(; host = "localhost", port = 8765, use_msgpack = false,
    model_id = "tensnap.julia.model", state_schema_version = nothing,
    restore_hooks = nothing)
```

The scenario owns parameters, actions, charts, environments, assets, screenshot
requests, the registered model, lifecycle callbacks, and connected WebSocket
clients.

`Scenario(...)` registers the built-in renderer-driven actions:

- `start`: runs one `step!(scenario)` and returns `continue = true`.
- `step`: runs one `step!(scenario)` and returns `continue = false`.
- `reset`: runs `reset!(scenario)` and returns `continue = false`.

The first simulated tick emitted by `step!` is time `1`; reset returns the
scenario to time `0`. Reset updates stable action/parameter/layer declarations,
deletes the previous agent set before creating current agents, clears chart
history, and publishes current monitor values without duplicate create frames.

Each connection receives `simulator_info` before any other simulator message.
It includes protocol/binding versions, stable `model_id`, optional model/schema
metadata, a per-scenario `instance_id`, and sorted capabilities. The instance id
survives reconnect/reset but changes for a replacement `Scenario`. Keep
`model_id` stable and change `state_schema_version` when projected/checkpoint
state becomes incompatible.

A model step may return its mutated model or `nothing`; TenSnap treats either
as a successful step. Return `false` only when the simulator should stop a
continuous action.

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
- `add_parameters!(scenario, parameters...)`
- `parameters_from_fields(model; target=identity, include=nothing, exclude=(), metadata=Dict(), rename=Dict())`
- `remove_parameter!(scenario, id)`

Renderer `param_change` messages update the parameter through its setter when
one is present, then emit `param_sync`.

For common scalar model fields, `parameters_from_fields(...)` can generate
getter/setter-backed parameters:

```julia
add_parameters!(scenario, parameters_from_fields(model;
    include = [:speed, :enabled, "config.mode"],
    rename = Dict(:enabled => "isEnabled"),
    metadata = Dict(
        :speed => (; min = 0, max = 5, step = 0.5,
            allow_runtime_change = false,
            setter = set_speed!),
        "config.mode" => (; options = ["low", "high"]),
    ),
))
```

It auto-discovers `Number`, `Bool`, and `AbstractString` fields. Fields with
`options` metadata are emitted as enum parameters. Mutable structs and
dictionaries get setters; read-only targets such as `NamedTuple` get getters
only. Pass `target = ref -> ref[]` or an equivalent selector when the parameters
live under a wrapper such as `Ref` or an `Agents.jl` properties object.
Explicit `include` entries may be direct fields or dotted paths.
Metadata may include `allow_runtime_change = false` and custom `getter` or
`setter` functions when changing a field should be staged for the next reset or
needs side effects such as updating a derived runtime cache.

### Actions

```julia
add_action!(scenario, action("shuffle", m -> shuffle!(m.agents); label = "Shuffle"))
```

Helpers:

- `action(id, handler; label=id, continuous=false, continue_on_return=false)`
- `add_action!(scenario, action)`
- `remove_action!(scenario, id)`

When `continue_on_return=true`, the handler return value controls the
`action_result.should_continue` flag.

### Charts

```julia
add_chart!(scenario, chart("population", m -> length(m.agents);
    label = "Population",
    color = "#228be6",
))
```

`chart(...)` accepts scalar values, dictionaries, tuples, or vectors. Dictionary
keys and `series` ids become chart series ids.

Grouped charts use the existing `series` keyword and a getter that returns a
dictionary, tuple, or vector aligned with those series ids:

```julia
add_chart!(scenario, chart("evacuation_counts",
    m -> Dict("alive" => m.alive, "evacuated" => m.evacuated, "dead" => m.dead);
    label = "Evacuation Counts",
    series = [
        Dict("id" => "alive", "label" => "Alive", "color" => "#F59E0B"),
        Dict("id" => "evacuated", "label" => "Evacuated", "color" => "#16A34A"),
        Dict("id" => "dead", "label" => "Dead", "color" => "#9CA3AF"),
    ],
))
```

Helpers:

- `chart(id, getter; label=id, color="#228be6", series=nothing)`
- `add_chart!(scenario, chart)`
- `remove_chart!(scenario, id)`

### Monitors

Monitors (introduced in protocol v0.3) publish one replace-only current value;
use charts for history. They are useful for a small structured status summary:

```julia
add_monitor!(scenario, monitor("bar_status", m -> Dict(
    "attending" => m.attendance,
    "capacity" => m.capacity,
    "over_capacity" => max(m.attendance - m.capacity, 0),
); label = "Bar status", render_hint = "table"))
```

Helpers:

- `monitor(id, getter; label=id, render_hint=nothing)`
- `add_monitor!(scenario, monitor)`
- `remove_monitor!(scenario, id)`

`render_hint` can be `"auto"`, `"tree"`, `"table"`, or `"text"`.

Replacing monitor metadata emits `monitor_delete` then `monitor_create`;
`monitor_update` is reserved for current values. Charts, environments, and
layers use the same strict create semantics rather than treating create as an
upsert.

### Scene restore and checkpoints

```julia
hooks = restore_hooks(
    payload -> restore_projected!(model, payload);
    checkpoint_capture = _ -> snapshot(model),
    checkpoint_restore = data -> restore_snapshot!(model, data),
)
scenario = Scenario(
    model_id = "my.stable.model",
    state_schema_version = "1",
    restore_hooks = hooks,
)
```

Checkpoint callbacks work with model data only. Byte vectors use
`application/octet-stream`; other protocol data uses MessagePack. JSON clients
receive a data URL and MessagePack clients receive bytes. Restore validates
identity/schema/instance guards, applies checkpoint data before projected
fields, replays actions/parameters/environments/items/monitors/time without any
chart messages, caches request IDs, and rolls back through checkpoint hooks
when a later phase fails. `scene.restore.checkpoint` is declared only when both
checkpoint hooks exist. Projected restore is optional; use
`restore_hooks(nothing; checkpoint_capture=..., checkpoint_restore=...)` for a
checkpoint-only model.

## Environments and Layers

### Builders

- `environment(id; type="2d", layers=Layer[])`
- `layer(id, type, items; data=nothing, dependency_layer_ids=Dict(), item_key_fields=String[])`
- `agents_layer(id, getagents=agents_getter; projector=autoagentprojector(), data=nothing, dependency_layer_ids=Dict(), item_key_fields=["id"])`
- `grid_layer(id, items; data=nothing, item_key_fields=["x", "y"])`
- `patch_layer(id, items; data=nothing, item_key_fields=["x", "y"])`
- `edge_layer(id, items; data=nothing, dependency_layer_ids=Dict(), item_key_fields=["source", "target"])`
- `trajectory_layer(id, items; length=nothing, width=nothing, color=nothing,
  z_index=nothing, on_agent_delete=nothing, on_state_sync=nothing,
  on_reset=nothing, data=nothing, dependency_layer_ids=Dict("agent"=>"agents"))`

Trajectory lifecycle defaults are agent-delete `"delete"`, state-sync
`"preserve"`, and reset `"clear"`. `"retain"` and preserved resets close the
current segment before later points are appended.

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

`agents_layer(...; item_id = ..., changed = ...)` can opt into an incremental
source. When both functions are provided, `replace_layer_items!` projects only
new or changed raw agents. Without them, the default remains full-list
projection followed by field-level diffing.

## Projectors

- `dictprojector(fields=nothing; rename=Dict())`
- `propertyprojector(fields...; rename=Dict())`
- `autoagentprojector(; id=:id, x=:x, y=:y, color=nothing, size=nothing, icon="circle", fields=(), data_fields=())`
- `agents_getter(model)`

`autoagentprojector()` supports plain structs and common `Agents.jl` conventions:
`id`, `pos`, `heading`, and optional color/size/icon fields. `Agents.jl` is not
a package dependency. When passed to `agents_layer`, it automatically follows
the containing environment: a `uniform` environment omits `x`, `y`, and
`heading`, while a `2d` environment retains them. Use `data_fields` for model
properties that should appear in the renderer's agent-details `data` object;
`fields` preserves the existing top-level projection behavior.

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
