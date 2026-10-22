# Binding ownership and layer topology

This document is the shared contract for the Python, Go, Julia, and JS model bindings. The protocol package remains the authority for wire payloads and built-in layer schemas. This contract covers where declarative metadata lives, how local bindings are resolved, and when layer dependency graphs are checked.

## Shared contract

1. A binding declaration has one owner. Environment metadata belongs to an environment; layer type, dependency IDs, projection, item keys, and inverse restore callbacks belong to a layer. Model identity, lifecycle, checkpoint, and whole-scene restore belong to the model or scenario. Item projectors belong to item types or to the layer that names them. Actions, charts, and monitors belong to their decorated member or explicit registry entry.
2. A layer-local restore declaration inherits its layer identity. Detached declarations must name their target explicitly. Never bind to the nearest, most recently registered, or first layer. Duplicate IDs within one environment and ambiguous matches are errors. No `of` keyword is added.
3. A dependency arrow always points from dependent layer to prerequisite layer. `dependency_layer_ids.agent` on an edge or trajectory names the agent layer in the **same environment**. Dependencies are create-time topology, not mutable layer metadata. Independent roots and each root's prerequisites are traversed in declaration order, with prerequisites emitted before dependents. Bulk layer replacement and teardown delete dependents first. Declaration order never creates an implicit dependency.
4. A complete environment rejects duplicate IDs, missing dependencies, dependencies of the wrong role/type, and cycles before it is published. Partial binding declarations may temporarily refer to a layer supplied when the environment is assembled. A projected restore validates the complete incoming topology before changing model state.
5. Topology validation and sorting happen when a declaration is assembled or its topology changes. Compiled order is reused for every simulation tick, item diff, state sync, and metadata refresh. A normal runtime event must never run a graph traversal or topology validation. Restore requests may validate their _incoming_ snapshot once per request. If a binding exposes mutable topology, supported mutation APIs must invalidate the compiled order; direct mutation of an already compiled declaration is unsupported.
6. Metadata reads must use the owning object and check the expected metadata type. Declaration writers must reject unsupported owner kinds and must not mutate an inherited or unrelated declaration as a side effect.
7. Environment and layer IDs are separate components of an identity. IDs may contain `/`, `:`, or other separators. Use structured tuple keys or an injective encoding for cross-environment caches and restore plans; a human-readable `environment/layer` diagnostic is not a key and must never be split to recover IDs.

## Python binding

- `@env`, layer decorators, `@params`, `@scene_restore`, and `@checkpoint` attach class-owned metadata. `@layer_restore` may modify only a layer declared on that same class; it requires `layer_id` when more than one local layer matches. The model instance is a readback target, not a metadata owner.
- `@agent`, `@edge`, `@trajectory_item`, `@action`, `@chart`, and `@monitor` attach to their corresponding class or callable/getter. Property metadata belongs to its getter. Readers accept a class or instance for class metadata, and a declared member for member metadata.
- Class registry writes copy an inherited list before adding a local entry. `get_scene_restore_binding` reads a typed, class-owned declaration. Layer ordering is compiled when the environment registry changes and reused while building state; standalone layer readback permits dependencies supplied by another class later in registration.

### Python parameter resolution and accessor ownership

Resolve parameter declarations by source field name before assigning public IDs. Class values, instance values and constructor metadata are not independent declarations of the same field. Separate declaration selection from live readback: an instance supplies the current value even when the declaration or default lives on its class. The field declaration tier (`@param` and class `Annotated`) takes priority over constructor annotations. Ordered custom bindings override that tier; scalar inference is last. Incompatible types or IDs within one field tier are errors, as are duplicate source fields and public IDs within a batch. Providers using `__tensnap_parameter_metadata__` obey the same batch identity checks. Validate the entire parameter batch and known descriptor writability before changing the parameter registry.

Configuration priority is explicit and shared by all discovery surfaces. Class configs follow call-site suggestions, subclass configs follow inherited configs, and later configs win. Resolve private-name policy separately from include/exclude selectors so omitted options do not reject a lower-priority explicit choice. Default Mesa exclusions apply only to automatic candidates. `BindParameterConfig` tracks omission separately from concrete defaults. Custom `Parameter` objects are complete metadata definitions; do not infer omission by comparing a value to its default. The public [Python API](../api-reference/python-api.md#parameter-declarations-and-discovery) specifies the exact merging rules.

Inspect member metadata statically, using effective MRO members and typed getter metadata, before evaluating properties. Chart and monitor declarations suppress automatic parameter inference, including scalar results; explicit parameter declarations can opt into a second role. Include selectors alone do not change a member's role. Known getter-only properties and parameter descriptors cannot be registered as editable controls without an explicit setter. Constructor controls have their own staged setter; runtime editability and setter availability are distinct concerns.

Metadata containers and runtime accessors have different ownership. Clone mutable metadata at discovery, registration and wire publication boundaries. Retain callable objects by reference, including bound owners; never deep-copy a binding wholesale. Wire serialization uses an allowlist before copying data, so callbacks and model resources are never traversed. Omitted instantiate accessors retain the original callback; an explicit callback replaces it and explicit `None` clears it. Reset/restore rebinds generated accessors to the live registration target and retains the identity of explicit callbacks.

The implementation has one dependency direction:

- `bindings/_parameter_declarations.py` owns declaration descriptors, supplied-field tracking and ordered configuration.
- `bindings/_parameter_resolution.py` selects one effective definition and type, and validates batch identities. Both model discovery and constructor binding use it.
- `bindings/_parameter_discovery.py` adapts namespaces and objects, reads static roles, and validates known accessor constraints. `utils/member_metadata.py` supplies shared static member reads.
- `bindings/basic/parameter.py` exports the public parameter API; it has no alternate scanner or legacy helper forwarding.
- `bindings/lifecycle.py` owns construction inputs and staged values. It does not implement another type inference or metadata merge path.
- Lifecycle planning and `add_all` share the same parameter-selection policy. An undecorated model's explicit field or constructor-annotation declaration must not be rediscovered as an additional staged constructor control. Constructor-only metadata belongs in `bind_kwargs`; matching model-owned declarations retain their own accessors and editability.
- `models/parameter.py` owns runtime parameter objects and wire-safe copying. `scenario.py` owns registry mutation and generated default accessors.

Parameter discovery and declaration compilation happen at registration, reconstruction and restore boundaries, not per simulation tick. Regression tests should check model-visible writes and readback, callback identity with non-copyable owners, metadata isolation, role exclusion without getter evaluation, duplicate-ID failure without partial registration, and constructor/reset/restore behavior. Keep these modules under Ruff and Pyright checks rather than adding file-wide exclusions.

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

Item mutability follows the [projection ownership contract](./projection-ownership.md): built-in projectors return independent snapshots, custom callbacks keep safe publication copying unless they explicitly declare independent output, and published records are read-only. That page also distinguishes item lifetime from transport/frame lifetime.
