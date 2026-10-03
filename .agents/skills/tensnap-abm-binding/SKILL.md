---
name: tensnap-abm-binding
description: Use when adding, reviewing, or debugging TenSnap simulator bindings or protocol-visible ABM state in Python/Mesa, Go, Julia, or JS, including layers, parameters, actions, charts, monitors, restore, and replay.
---

# TenSnap ABM Binding

Use the binding owned by the model's language. Preserve stable identity, validated
protocol payloads, current values, incremental updates, replay, and an explicit
inverse when renderer state can restore model state. Do not force a map or matrix
binding onto models whose agents already have stable object identities.

## Find the contract

Read the files relevant to the task; the protocol package is the wire source of
truth, not an older maintainer-guide snapshot.

- Wire rules and schemas: `packages/protocol/SPECIFICATION.md`,
  `packages/protocol/src/schemas.ts`, `packages/protocol/src/layers.ts`, and
  `packages/protocol/src/types.ts`; inspect `codec.ts` for encoding work.
- Binding ownership and dependency direction:
  `docs/maintainer-guide/binding-ownership-and-topology.md`.
- Language APIs: `docs/api-reference/python-api.md`, `go-api.md`, `julia-api.md`,
  and `js-api.md` in the same directory.
- Runtime behavior: `packages/core/src/scenario` and
  `packages/core/src/environment`.
- Runnable examples: `examples/python`, `examples/python_mesa`, `examples/go`,
  `examples/julia`, and `examples/js`.

Change protocol schemas, core, affected bindings, and generated protocol docs
together only when the wire contract really changes. Regenerate the reference
with `pnpm --dir packages/protocol export:protocol` for such a change.

## Choose the binding

- Use an ordinary agent layer for entities with stable identities. For a
  model-owned mapping or matrix, use a map/matrix source layer instead of
  allocating wrapper agents. Python also has `indexed_agent_layer` for stable
  IDs over columnar storage. These source layers reuse the existing `agent`
  item messages; they do not require a new protocol layer type.
- Within each language, prefer the ordinary and source agent builders' direct
  field selectors, computed fields, and constants for simple projections.
  Reserve a full `project` callback for projections that need it. String
  selector versus string literal rules differ by language; check its API page.
- A map source needs canonical, unique encoded IDs and deterministic snapshot
  order. Keep a present `false` value distinct from a missing key. A matrix
  needs a declared axis convention, stable `cell:row:col` IDs, and renderer
  coordinates derived from its shape. Julia callbacks use 1-based indices;
  renderer coordinates and the other bindings use zero-based indices.
- Map/matrix source layers keep the reversible value in `data.value`. Validate complete
  restore input, including duplicate keys, dimensions, and coordinates, before
  mutating the model. Use an explicit replacement callback when the source
  container cannot be changed in place.
- Built-in renderer layer types are `background`, `grid`, `edge`, `trajectory`,
  and `agent`. Agent and trajectory items use `id`; edges use the ordered
  `source`/`target` pair. Grid/background are metadata-only. Edge and trajectory
  dependencies on an agent layer belong to create-time
  `dependency_layer_ids.agent`; never put them in mutable metadata.
- Agent items can carry coordinates, heading, color, icon, size, data, and graph
  hints. Trajectory items are configuration; trace points are renderer state
  unless explicitly restored. Custom layer types need namespaced IDs and
  deliberate item-key semantics.

## Register the rest of the model

- Parameters need stable IDs, labels, types, current values, and setters when
  runtime edits apply. Automatic discovery should not expose structural
  configuration accidentally. Accepted `param_change` values are optimistic:
  send `param_sync` only when rejected or canonicalized; use `param_update` for
  definition changes such as enum choices.
- Actions need stable IDs. Flush visible state changes before `action_result`;
  renderer-driven continuous actions reply to each `action_invoke`.
- Charts retain history and may contain named series. Monitors publish one
  replace-only current value, including structured status; choose a chart if
  history is needed. Declare monitor metadata once, update its value with
  `monitor_update`, and replace changed metadata with `monitor_delete` then
  `monitor_create`. A create is not an upsert. Replay current monitor values
  after sync, reset, and restore. `render_hint` accepts `auto`, `tree`, `table`,
  or `text`.
- Assets, screenshots, logs, and model time have their own existing binding or
  emitter paths. Use `asset:<id>` for asset-backed agent icons after publishing
  the asset. Check the language API before implementing lower-level emission.
- Projected scene restore is opt-in and needs a validated inverse; exact
  checkpoints need paired capture/restore hooks for private state such as RNG.
  Keep checkpoint callbacks on model data: the binding owns wire encoding.
  Change `state_schema_version` when saved data becomes incompatible. Restore
  should replay final declarations, items, monitors, and time; chart history is
  not reconstructed from a projected scene snapshot. Keep model ownership and
  layer-local inverses separate.

## Language entry points

- **Python/Mesa:** `SimulationScenario.add_all(...)` collects `@env`, layer,
  `@agent`/`@edge`/`@trajectory_item`, `@params`/`@param`, `@action`, `@chart`,
  and `@monitor` declarations. Use `@map_agent_layer`,
  `@matrix_agent_layer`, or `@indexed_agent_layer` for model-owned sources.
  `@scene_restore`, `@layer_restore`, and `@checkpoint` declare inverses;
  `BoundModelReinitializer` handles constructor-driven resets. Python's
  generated projector inlines only source-identifiable, simple expression
  lambdas; check `inline_diagnostics` when a callable remains a callback.
- **Go:** `binding.NewModel(...)` with `WithInit`, `WithStep`, `WithReset`,
  `WithParams`, `WithEnvs`, `WithCharts`, and `WithMonitors`. Use
  `NewAgentLayer`, `NewMapAgentLayer`, or `NewMatrixAgentLayer`; all three
  support `Field`, `Select`, and `Const`, and matrix `Flat(shape, at)`
  adapts flat storage. `RestoreSource` supplies their validated inverse.
  Use model and layer restore/checkpoint options where needed.
- **Julia:** `Scenario`, `environment`, `agents_layer`, `map_agent_layer`,
  `matrix_agent_layer`, `parameter`, `action`, `chart`, and `monitor` with
  `add_monitor!`. `autoagentprojector` and source-layer `fields` support direct
  selectors and fixed values; use `literal(...)` for a fixed string inside
  `fields`. Matrix `orientation` must state whether storage is `:row_col` or
  `:x_y`. Use `restore_hooks` and layer restore declarations for inverses.
- **JS/TS:** Prefer `modelBuilder(...).env(...).agentLayer(...)`,
  `.mapAgentLayer(...)`, or `.matrixAgentLayer(...)`, with direct `fields`,
  `color`, `icon`, and `size` where appropriate. Add `.monitor(...)` for current
  values; `defineMonitors(...)` serves the lower-level declarative surface.
  Use paired `checkpoint` hooks and the documented `sceneRestore` strategy for
  restoration. `TypedArray` matrix storage needs `shape`, and may provide `at`.

## Validate behavior

Start with focused binding tests, then run the relevant package and example
suites. Check initial sync, a step, reset/reconnect replay, item diffing,
monitor current values, and restore without partial mutation on invalid input.
Verify layer keys and dependencies, parameter edits, chart values, action
ordering, and model time where the task touches them.

```bash
# Python
(cd packages/tensnap-python && pytest)
# Go package and examples
(cd packages/tensnap-go && go test ./...)
(cd examples/go && go test ./...)
# Julia package and examples
pnpm run test:julia
# JS binding and examples
pnpm --filter @tensnap/js test
pnpm --dir examples/js run test
```

For a running simulator, use the existing agent CLI to inspect a scene, invoke
one step, and render a snapshot when visual behavior matters. Stop the smoke
session afterward. Do not assume NetLogo parity unless requested.
