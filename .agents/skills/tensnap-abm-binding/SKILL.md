---
name: tensnap-abm-binding
description: Use when adding, reviewing, or debugging an agent-based model binding to TenSnap in this repository, including Python/Mesa, Go, Julia, or JS bindings, scenario registration, parameters, charts, actions, layers, and validation.
---

# TenSnap ABM Binding

Use this skill to bind an agent-based model (ABM) to TenSnap or to review whether an existing binding is correct.

## First Read

Read only the files needed for the language and task.

- Protocol shape: `docs/maintainer-guide/protocol-v0.2.md`
- Python API: `docs/api-reference/python-api.md`
- Go API: `docs/api-reference/go-api.md`
- Julia API: `docs/api-reference/julia-api.md`
- JS API: `docs/api-reference/js-api.md`
- Architecture: `docs/maintainer-guide/architecture.md`
- Python examples: `examples/python`, `examples/python_mesa`, `examples/python_dqn`
- Go examples: `examples/go`
- Julia examples: `examples/julia`
- JS examples: `examples/js`

## Binding Workflow

1. Identify the model's state, agents/items, environment shape, parameters, actions, and chart outputs.
2. Pick the binding layer for the language instead of hand-writing protocol messages.
3. Register metadata before runtime stepping, then make steps mutate model state and let TenSnap emit deltas.
4. Keep protocol/runtime metadata types in model/protocol modules; keep decorators/builders in binding modules.
5. Preserve existing public imports when moving binding APIs. Add compatibility re-exports when changing import paths.
6. Validate registration shape before visual polish: environment id, layer ids, parameter ids, action ids, chart ids, and one step of data.

## Python

Use `tensnap` decorators and `SimulationScenario`.

Common decorators:

- `@env(...)`
- `@grid_layer(...)`
- `@agent_layer(...)`
- `@edge_layer(...)`
- `@trajectory_layer(...)`
- `@agent(...)`
- `@edge(...)`
- `@params(...)` / `BindParametersConfig(...)`
- `@param(...)` / `BindParameterConfig(...)`
- `@chart(...)`
- `@action(...)`

Typical shape:

```python
scenario = SimulationScenario(port=8765)
model = MyModel()
scenario.add_all(model)
await scenario.register_model_handler(model_init=init, model_step=model.step, model_reset=reset)
await scenario.run()
```

For constructor-driven reset/init, use the current reinitializer API and check docs for the latest neutral import path. Older Mesa examples may import it from `tensnap.bindings.mesa`.

For grouped charts, use existing `data_list` metadata unless a newer property-group API is available. A grouped chart getter should return a dict keyed by series id or a list/tuple aligned to `data_list`.

Avoid accidental parameter exposure with `scenario.add_all(...)`: undecorated objects default to no parameters unless explicit config is provided. For config objects, prefer explicit include lists or declarative metadata.

## Go

Use `packages/tensnap-go/binding` for declarative model binding and `packages/tensnap-go/abm` for lower-level model/emitter integration.

Typical pieces:

- `binding.NewModel(...)`
- `binding.WithInit(...)`
- `binding.WithStep(...)`
- `binding.WithReset(...)`
- `binding.WithParams(...)`
- `binding.WithEnvs(...)`
- `binding.WithCharts(...)`
- tag helpers such as `MustParamsFromTags(...)` and `ProjectTagsRequired(...)`

Validate with:

```bash
cd packages/tensnap-go
go test ./...
```

## Julia

Use explicit builders in `packages/tensnap-julia/src/components.jl`.

Typical pieces:

- `Scenario(...)`
- `parameter(...)`
- `action(...)`
- `chart(...)`
- `environment(...)`
- `agents_layer(...)`, `grid_layer(...)`, `edge_layer(...)`

Julia charts already support `series` for grouped chart metadata.

Validate with:

```bash
pnpm run test:julia
```

## JS

JS bindings are not as complete as Python/Go/Julia. Prefer typed declarative definitions and avoid assuming decorator parity.

Useful helpers:

- `defineScenario(...)`
- `defineEnvironment(...)`
- `defineLayer(...)`
- `defineParameters(...)`
- `defineActions(...)`
- `defineCharts(...)`

Validate relevant packages with:

```bash
pnpm --filter @tensnap/js test
pnpm --filter @tensnap/core test
```

## Registration Checklist

- Environment metadata is registered once with the expected id and type.
- Each layer has a stable id, layer type, item identity keys, and item projector.
- Parameters have labels, types, current values, and setters when runtime changes should mutate state.
- Actions are registered with stable ids and complete before their visible state changes are considered done.
- Charts have stable group/series ids and emit values after init/reset/step as expected.
- Reset rebuilds authoritative model state and clears/replays chart/environment state.
- State sync with an already-connected renderer returns current parameters, actions, env summaries, and chart metadata.

## Validation

Run the smallest targeted tests first, then broaden.

Python:

```bash
cd packages/tensnap-python
pytest
```

Go:

```bash
cd packages/tensnap-go
go test ./...
```

TypeScript:

```bash
pnpm --filter @tensnap/core test
pnpm --filter @tensnap/js test
```

End-to-end simulator smoke:

```bash
pnpm --filter @tensnap/agent dev -- runtime up --context demo --simulator-url ws://localhost:8765
pnpm --filter @tensnap/agent dev -- scene inspect --context demo
pnpm --filter @tensnap/agent dev -- scene step --context demo
pnpm --filter @tensnap/agent dev -- scene render snapshot --context demo
```

## Pitfalls

- Do not change protocol wire shapes without updating `packages/core`, docs, and language bindings together.
- Do not register the same config object twice.
- Do not leave long-running simulator or agent sessions active after a smoke check.
- Do not expose structural config fields such as coordinate tuples as basic scalar parameters unless the UI/editor supports them.
- Do not treat NetLogo parity as required for a Python DQN binding task unless the user explicitly asks for it.
