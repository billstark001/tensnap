# Binding ownership and layer topology

This document is the shared contract for the Python, Go, Julia, and JS model bindings. The protocol package remains the authority for wire payloads and built-in layer schemas. This contract covers where declarative metadata lives, how local bindings are resolved, and when layer dependency graphs are checked.

## Shared contract

1. A binding declaration has one owner. Environment metadata belongs to an environment; layer type, dependency IDs, projection, item keys, and inverse restore callbacks belong to a layer. Model identity, lifecycle, checkpoint, and whole-scene restore belong to the model or scenario. Item projectors belong to item types or to the layer that names them. Actions, charts, and monitors belong to their decorated member or explicit registry entry.
2. A layer-local restore declaration inherits its layer identity. Detached declarations must name their target explicitly. Never bind to the nearest, most recently registered, or first layer. Duplicate IDs within one environment and ambiguous matches are errors. No `of` keyword is added.
3. A dependency arrow always points from dependent layer to prerequisite layer. `dependency_layer_ids.agent` on an edge or trajectory names the agent layer in the **same environment**. Dependencies are create-time topology, not mutable layer metadata. Independent roots and each root's prerequisites are traversed in declaration order, with prerequisites emitted before dependents. Bulk layer replacement and teardown delete dependents first. Declaration order never creates an implicit dependency.
4. A complete environment rejects duplicate IDs, missing dependencies, dependencies of the wrong role/type, and cycles before it is published. Partial binding declarations may temporarily refer to a layer supplied when the environment is assembled. A projected restore validates the complete incoming topology before changing model state.
5. Topology validation and sorting happen when a declaration is assembled or its topology changes. Compiled order is reused for every simulation tick, item diff, state sync, and metadata refresh. A normal runtime event must never run a graph traversal or topology validation. Restore requests may validate their _incoming_ snapshot once per request. If a binding exposes mutable topology, supported mutation APIs must invalidate the compiled order; direct mutation of an already compiled declaration is unsupported.
6. Metadata reads must use the owning object and check the expected metadata type. Declaration writers must reject unsupported owner kinds and must not mutate an inherited or unrelated declaration as a side effect.

## Python binding

- `@env`, layer decorators, `@params`, `@scene_restore`, and `@checkpoint` attach class-owned metadata. `@layer_restore` may modify only a layer declared on that same class; it requires `layer_id` when more than one local layer matches. The model instance is a readback target, not a metadata owner.
- `@agent`, `@edge`, `@trajectory_item`, `@action`, `@chart`, and `@monitor` attach to their corresponding class or callable/getter. Property metadata belongs to its getter. Readers accept a class or instance for class metadata, and a declared member for member metadata.
- Class registry writes copy an inherited list before adding a local entry. `get_scene_restore_binding` reads a typed, class-owned declaration. Layer ordering is compiled when the environment registry changes and reused while building state; standalone layer readback permits dependencies supplied by another class later in registration.

## Go binding

- `Model` options own model-wide lifecycle and checkpoint hooks. `Env` owns its layers. Each layer builder owns its `Restore` inverse, `DependencyLayer` references, metadata, and item projection. There is no positional target lookup among builders.
- `Env.Scenario` checks and compiles its layer order once. Subsequent scenario refreshes update dynamic metadata without rerunning topology validation. Builder topology should be finalized before the first scenario compilation.

## Julia binding

- `Scenario` owns model-wide restore/checkpoint hooks. `Environment` owns its `Layer` values; each `Layer` owns its `restore`, dependencies, metadata, and item projection. A callback tuple passed as a layer's `restore` cannot bind to another layer by position.
- `add_environment!` compiles the layer order. `add_layer!` checks the revised graph before publishing and stores the new order. `remove_layer!` requires dependents to be removed first. Sync/reset iterate the compiled `e.layers` vector. `add_layer!(environment, layer)` is for assembly before registration; after registration use `add_layer!(scenario, env_id, layer)` so changes are validated and published. Direct mutation of `e.layers` after registration bypasses validation and is unsupported.

## JS binding

- Model options own lifecycle and checkpoint hooks. `EnvironmentBuilder` owns its layers; `LayerOptions.restore`, `dependencyLayerIds`, projectors, and keys belong to that exact layer. Generic `defineEnvironment` and `ScenarioRegistry` check complete layer topology at registration.
- A bound model caches layer order by binding identity. Rebuilding dynamic metadata/parameters on a tick uses the cached order; the registry accepts that already validated definition without another graph traversal. A new binding or explicit registry registration validates again. Mutating an already compiled binding's layer IDs or dependency IDs is unsupported.

Parameter keyword/type reuse across layer builders is intentionally outside this contract for now.
