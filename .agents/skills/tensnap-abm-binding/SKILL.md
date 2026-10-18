---
name: tensnap-abm-binding
description: Build, review, or debug TenSnap model bindings in Python/Mesa, Go, Julia, and JavaScript/TypeScript, including state projection, controls, replay, and restore.
license: MIT
metadata:
  author: billstark001
  distribution: '@tensnap/agent'
  repository: 'https://github.com/billstark001/tensnap'
---

# TenSnap ABM Binding

Use the binding owned by the model's language. Preserve stable identity, validated protocol payloads, current values, incremental updates, replay, and an explicit inverse when renderer state can restore model state. Do not force a map or matrix binding onto models whose agents already have stable object identities.

## Find the contract

Start with the API reference for the model’s language; consult shared contracts when the task touches them. All references linked below are included with this skill and work offline without a TenSnap checkout:

- Language APIs: [Python/Mesa](references/docs/api-reference/python-api.md), [Go](references/docs/api-reference/go-api.md), [Julia](references/docs/api-reference/julia-api.md), and [JS/TS](references/docs/api-reference/js-api.md).
- Wire rules: [protocol specification](references/packages/protocol/SPECIFICATION.md) and [generated payload schemas](references/protocol-types.md).
- Shared contracts: [projection ownership](references/docs/maintainer-guide/projection-ownership.md), [binding ownership and topology](references/docs/maintainer-guide/binding-ownership-and-topology.md), and [networking](references/docs/user-guide/networking.md).

Use the binding package for the model’s language and check its version against the bundled API reference and advertised protocol version. The skill’s distribution version identifies the accompanying npm bundle; language bindings are separate dependencies. Implementing Python, Go, or Julia bindings does not require Node.js or the agent CLI. Optional CLI smoke tests use Node.js 22 or newer and `@tensnap/agent`.

When modifying TenSnap itself, repository paths mentioned here or in the references refer to the source checkout, not the installed skill. The wire source of truth is `packages/protocol/src/{schemas,layers,types}.ts`; inspect `codec.ts` for encoding work. Runtime code is in `packages/core/src/scenario` and `packages/core/src/environment`; runnable examples are in `examples/{python,python_mesa,go,julia,js}`. Change schemas, core, affected bindings, and generated protocol docs together only when the wire contract changes. Regenerate with `pnpm --dir packages/protocol export:protocol`. Installed users should use the bundled references instead of searching for those repository paths.

## Choose the binding

- Use an ordinary agent layer for entities with stable identities. For a model-owned mapping or matrix, use a map/matrix source layer instead of allocating wrapper agents. Python also has `indexed_agent_layer` for stable IDs over columnar storage. These source layers reuse the existing `agent` item messages; they do not require a new protocol layer type.
- Within each language, prefer the ordinary and source agent builders' direct field selectors, computed fields, and constants for simple projections. Reserve a full `project` callback for projections that need it. String selector versus string literal rules differ by language; check its API page.
- A map source needs canonical, unique encoded IDs and deterministic snapshot order. Keep a present `false` value distinct from a missing key. A matrix needs a declared axis convention, stable `cell:row:col` IDs, and renderer coordinates derived from its shape. Julia callbacks use 1-based indices; renderer coordinates and the other bindings use zero-based indices.
- Map/matrix source layers keep the reversible value in `data.value`. Validate complete restore input, including duplicate keys, dimensions, and coordinates, before mutating the model. Use an explicit replacement callback when the source container cannot be changed in place.
- Built-in renderer layer types are `background`, `grid`, `edge`, `trajectory`, and `agent`. Agent and trajectory items use `id`; edges use the ordered `source`/`target` pair. Grid/background are metadata-only. Edge and trajectory dependencies on an agent layer belong to create-time `dependency_layer_ids.agent`; never put them in mutable metadata.
- Agent items can carry coordinates, heading, color, icon, size, data, and graph hints. Trajectory items are configuration; trace points are renderer state unless explicitly restored. Custom layer types need namespaced IDs and deliberate item-key semantics.

## Preserve projection ownership

Built-in item projectors return independent nested snapshots by default. Custom callbacks retain safe publication copying unless the layer explicitly declares independent output. Resolve copying policy when constructing persistent trackers or once per layer batch (once per item class for inferred projectors), and avoid per-item options containers. Use the language's layer copy controls for overrides; do not silently disable safe copying on arbitrary callbacks.

Published records, nested containers, and buffers are read-only and may be shared by caches and pending sends. Reuse already published records when internally seeding a cache. A new outer record is insufficient when its nested values still alias mutable model state. For a custom-owned map/matrix visual projector, detach framework-injected `data.value` separately unless the caller explicitly disables that protection. Restore callbacks must detach decoded containers they intend to mutate from retained baselines.

Test later model mutation against retained initial and update payloads, nested in-place diff detection, binary subviews, full sync/replay seeding, and explicit safe/owned/double/no-copy policies. Use the built-in layer scan capability to compare against previous owned records before materializing changed fields; preserve the standalone projector guarantee and explicit copy overrides. After selecting one item's fields, materialize its borrowed record before advancing to the next item; never expose the private borrowed projection to observers or retain it across awaits. JS layers with function-valued keys keep the original eager projection path. Equal nested fields may be shared, but do not promise whole-record identity. A publication copy override does not reconfigure a projector, and Go `ComputeBorrowed` always materializes independent values regardless of the tracker's ordinary `DeepCopy` property. Measure scalar versus nested and changed versus unchanged workloads separately; eager whole-scan detachment can regress sparse updates even if downstream copies disappear. Prefer existing precise change/revision accessors when available; do not assume fewer copies guarantees a faster whole pipeline. The JS focused helper benchmark invokes standalone projectors, so use a bound-session benchmark to validate automatic scan optimizations. Do not reinterpret dated benchmark evidence as a description of the current implementation. Cache only immutable type metadata when optimizing reflection plans; model-dependent values, comparison results, and cycle-detection state belong to each call.

## Register the rest of the model

- Parameters need stable IDs, labels, types, current values, and setters when runtime edits apply. Automatic discovery should not expose structural configuration accidentally. Accepted `param_change` values are optimistic: send `param_sync` only when rejected or canonicalized; use `param_update` for definition changes such as enum choices.
- Actions need stable IDs. Flush visible state changes before `action_result`; renderer-driven continuous actions reply to each `action_invoke`.
- Charts retain history and may contain named series. Monitors publish one replace-only current value, including structured status; choose a chart if history is needed. Declare monitor metadata once, update its value with `monitor_update`, and replace changed metadata with `monitor_delete` then `monitor_create`. A create is not an upsert. Replay current monitor values after sync, reset, and restore. `render_hint` accepts `auto`, `tree`, `table`, or `text`.
- Assets, screenshots, logs, and model time have their own existing binding or emitter paths. Use `asset:<id>` for asset-backed agent icons after publishing the asset. Check the language API before implementing lower-level emission.
- Projected scene restore is opt-in and needs a validated inverse; exact checkpoints need paired capture/restore hooks for private state such as RNG. Keep checkpoint callbacks on model data: the binding owns wire encoding. Change `state_schema_version` when saved data becomes incompatible. Restore should replay final declarations, items, monitors, and time; chart history is not reconstructed from a projected scene snapshot. Keep model ownership and layer-local inverses separate.

## Language entry points

- **Python/Mesa:** `SimulationScenario.add_all(...)` collects `@env`, layer, `@agent`/`@edge`/`@trajectory_item`, `@params`/`@param`, `@action`, `@chart`, and `@monitor` declarations. Use `@map_agent_layer`, `@matrix_agent_layer`, or `@indexed_agent_layer` for model-owned sources. `@scene_restore`, `@layer_restore`, and `@checkpoint` declare inverses; `BoundModelReinitializer` handles constructor-driven resets. Python's generated projector inlines only source-identifiable, simple expression lambdas; check `inline_diagnostics` when a callable remains a callback.
- **Go:** `binding.NewModel(...)` with `WithInit`, `WithStep`, `WithReset`, `WithParams`, `WithEnvs`, `WithCharts`, and `WithMonitors`. Use `NewAgentLayer`, `NewMapAgentLayer`, or `NewMatrixAgentLayer`; all three support `Field`, `Select`, and `Const`, and matrix `Flat(shape, at)` adapts flat storage. `RestoreSource` supplies their validated inverse. Use model and layer restore/checkpoint options where needed.
- **Julia:** `Scenario`, `environment`, `agents_layer`, `map_agent_layer`, `matrix_agent_layer`, `parameter`, `action`, `chart`, and `monitor` with `add_monitor!`. `autoagentprojector` and source-layer `fields` support direct selectors and fixed values; use `literal(...)` for a fixed string inside `fields`. Matrix `orientation` must state whether storage is `:row_col` or `:x_y`. Use `restore_hooks` and layer restore declarations for inverses.
- **JS/TS:** Prefer `modelBuilder(...).env(...).agentLayer(...)`, `.mapAgentLayer(...)`, or `.matrixAgentLayer(...)`, with direct `fields`, `color`, `icon`, and `size` where appropriate. Add `.monitor(...)` for current values; `defineMonitors(...)` serves the lower-level declarative surface. Use paired `checkpoint` hooks and the documented `sceneRestore` strategy for restoration. `TypedArray` matrix storage needs `shape`, and may provide `at`.

## Validate behavior

In an external model project, run its binding tests and smoke simulator; use the bundled API references for setup. In a TenSnap checkout, start with focused binding tests, then run the relevant package and example suites. Check initial sync, a step, reset/reconnect replay, item diffing, monitor current values, and restore without partial mutation on invalid input. Verify layer keys and dependencies, parameter edits, chart values, action ordering, and model time where the task touches them.

For key/diff changes, include numeric `1` versus string `"1"`, IDs containing separators, compound keys, and identical layer IDs in different environments. Internal cache keys must preserve wire identity; string concatenation is not a safe tuple encoding. Check duplicate listener registration and cleanup when adapting transports.

For the repository commands below, run Python tests in a development environment installed from `packages/tensnap-python[dev]`; an unrelated global interpreter may resolve incompatible dependencies. The server needs `websockets>=13.0` for `websockets.asyncio`. For a focused run without the package-wide coverage report, pass `-o addopts=''` to pytest.

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

For a running simulator, use `tensnap-agent` (or `npx --no-install tensnap-agent` for a project dependency) to inspect a scene, invoke one step, and render a snapshot when visual behavior matters. Stop the smoke session afterward. Do not assume NetLogo parity unless requested.
