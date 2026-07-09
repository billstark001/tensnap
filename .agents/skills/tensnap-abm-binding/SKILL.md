---
name: tensnap-abm-binding
description: Use when adding, reviewing, or debugging an agent-based model binding to TenSnap in this repository, including Python/Mesa, Go, Julia, or JS bindings, protocol messages, parameters, charts, actions, layers, and validation.
---

# TenSnap ABM Binding

Use this skill when work touches simulator bindings, protocol-facing payloads,
or renderer-visible ABM state. Treat the binding as a contract between a model
runtime and the TenSnap renderer: stable ids, validated protocol payloads,
incremental updates, replayable state, and clear ownership boundaries matter
more than convenience shortcuts.

## First Read

Read only the sources needed for the task, but always locate protocol truth in
the protocol package rather than old maintainer-guide protocol snapshots.

- Protocol package overview: `packages/protocol/README.md`
- Protocol schemas and payload docs: `packages/protocol/src/schemas.ts`
- Built-in layer contracts: `packages/protocol/src/layers.ts`
- Protocol type surface: `packages/protocol/src/types.ts`
- Protocol codecs: `packages/protocol/src/codec.ts`
- Generated protocol reference: run `pnpm --dir packages/protocol export:protocol`
  to write `packages/protocol/dist/protocol-types.md`, or pass an output path
  as the first argument.
- Renderer Scenario and layer registry: `packages/core/src/scenario`
- Renderer environment/storage behavior: `packages/core/src/environment`
- Python API: `docs/api-reference/python-api.md`
- Go API: `docs/api-reference/go-api.md`
- Julia API: `docs/api-reference/julia-api.md`
- JS API: `docs/api-reference/js-api.md`
- Architecture: `docs/maintainer-guide/architecture.md`
- Runnable examples: `examples/python`, `examples/python_mesa`,
  `examples/python_dqn`, `examples/go`, `examples/julia`, `examples/js`

## Protocol Rules

- Do not invent wire shapes in a binding. Add or update schemas in
  `packages/protocol/src/*`, update core and bindings together, then regenerate
  protocol docs.
- Generic messages stay generic: `env_layer_create`, `item_create`,
  `item_update`, and `item_delete` support custom layer types. Built-in layer
  specifics live in `packages/protocol/src/layers.ts`.
- The built-in layer types are `background`, `grid`, `edge`, `trajectory`, and
  `agent`.
- Built-in item keys:
  - agent: `id`
  - edge: `source` + `target`
  - trajectory: `id`
  - grid/background: metadata-only, no item channel
- Edge and trajectory layers depend on an agent layer through
  `dependency_layer_ids.agent` at create time. Do not mutate dependencies with
  `env_layer_update`.
- `param_change` is optimistic. Accepted values do not trigger `param_sync`.
  Emit `param_sync` only when the simulator rejects the edit or canonicalizes it
  to a different value. Emit `param_update` for definition changes such as enum
  option or label changes.
- Action execution should flush visible state mutations before the matching
  `action_end`. Continuous loops are renderer-driven with `action_start`
  requests and `action_end` replies.

## Binding Workflow

1. Identify model state, agents/items, environment shape, parameters, actions,
   charts, assets, reset semantics, and expected replay behavior.
2. Pick the binding helper for the language instead of hand-writing protocol
   messages.
3. Register metadata before runtime stepping. Steps mutate model state; the
   binding emits deltas.
4. Keep protocol/runtime payload types in protocol/model modules and keep
   decorators/builders in binding modules.
5. Preserve user state during reset by rebuilding the authoritative model and
   replaying current metadata/items/charts.
6. Validate registration before visual polish: environment id, layer ids, layer
   types, dependency ids, item keys, parameter ids, action ids, chart ids, and
   one step of data.
7. If protocol docs are relevant to the change, regenerate with
   `pnpm --dir packages/protocol export:protocol` and inspect the generated
   Markdown for the changed payloads.

## Layers

- Prefer built-in layer builders when the model maps to agent/grid/edge/
  trajectory/background semantics.
- Agent items may include `x`, `y`, `heading`, `color`, `icon`, `size`, `data`,
  and graph-force hints. Renderer graph layers may update positions internally.
- Edge items must include `source` and `target`; delete payloads for edges must
  use object keys, not joined strings.
- Trajectory layer items are per-agent config records. Actual trace points are
  renderer storage state derived from agent motion unless explicitly restored
  from snapshots.
- Grid and background layers are metadata-only. Register/update metadata rather
  than emitting item messages.
- Custom layer types should use namespaced ids such as `mypkg.heatmap` and must
  define key semantics before emitting item diffs.

## Parameters

- Parameters need stable ids, labels, types, current values, and setters when
  runtime edits should mutate model state.
- Enum parameters may update `options` and `labels` at runtime via full
  `param_update` payloads.
- Sliders and other frequently edited controls must not receive a sync echo for
  every accepted value; doing so makes frontend controls fight the simulator.
- If a setter fails, rejects, clamps, or normalizes a value, send `param_sync`
  with the simulator's current canonical value.
- Avoid exposing structural config fields accidentally. Use explicit include
  lists or declarative metadata when automatic discovery is available.

## Python

Use `tensnap` decorators and `SimulationScenario`.

Common decorators and helpers:

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

For constructor-driven reset/init, use the lifecycle reinitializer APIs. For
grouped charts, return a dict keyed by series id or a list/tuple aligned with
`data_list`.

Validate with:

```bash
cd packages/tensnap-python
pytest
```

## Go

Use `packages/tensnap-go/binding` for declarative model binding and
`packages/tensnap-go/abm` for lower-level model/emitter integration.

Typical pieces:

- `binding.NewModel(...)`
- `binding.WithInit(...)`
- `binding.WithStep(...)`
- `binding.WithReset(...)`
- `binding.WithParams(...)`
- `binding.WithEnvs(...)`
- `binding.WithCharts(...)`
- layer builders such as agent/grid/edge/trajectory/background
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
- `parameter(...)` and `update_parameter!(...)`
- `action(...)`
- `chart(...)`
- `environment(...)`
- `agents_layer(...)`, `grid_layer(...)`, `edge_layer(...)`,
  `trajectory_layer(...)`, `background_layer(...)`

Julia charts support `series` for grouped chart metadata.

Validate with:

```bash
pnpm run test:julia
```

## JS

Use typed declarative definitions and avoid assuming decorator parity with the
Python API.

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
- Every layer has a stable id, layer type, item identity keys, item projector,
  and dependency mapping when required.
- Parameters have labels, types, current values, runtime-change flags, and
  setters when UI edits should mutate state.
- Actions are registered with stable ids and complete after their visible state
  changes have been emitted.
- Charts have stable group/series ids and emit values after init/reset/step as
  expected.
- Reset rebuilds authoritative model state and clears/replays chart and
  environment state.
- State sync with an already-connected renderer returns current parameters,
  actions, env summaries, chart metadata, layer creates, and item snapshots.

## Validation

Run the smallest targeted tests first, then broaden.

TypeScript:

```bash
pnpm --dir packages/protocol typecheck
pnpm --dir packages/protocol test
pnpm --dir packages/core test
pnpm --dir packages/tensnap-js test
```

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

Julia:

```bash
pnpm run test:julia
```

End-to-end simulator smoke:

```bash
pnpm --filter @tensnap/agent dev -- runtime up --context demo --simulator-url ws://localhost:8765
pnpm --filter @tensnap/agent dev -- scene inspect --context demo
pnpm --filter @tensnap/agent dev -- scene step --context demo
pnpm --filter @tensnap/agent dev -- scene render snapshot --context demo
```

## Pitfalls

- Do not change protocol wire shapes without updating `packages/protocol`,
  `packages/core`, generated docs, and every affected binding.
- Do not register the same config object twice.
- Do not leave long-running simulator or agent sessions active after a smoke
  check.
- Do not expose tuple/vector config fields as scalar parameters unless the
  frontend editor supports them.
- Do not use compatibility aliases as the solution to a protocol mismatch.
- Do not treat NetLogo parity as required unless the user explicitly asks for
  it.
