# Python API Reference

See [IPv4/IPv6 networking](../user-guide/networking.md) for `ip_family` configuration, dual listeners, and ephemeral ports.

This reference describes the current TenSnap Python surface for protocol v0.3.

The recommended workflow is:

1. Attach environment, layer, item, parameter, chart, and action bindings under `tensnap.bindings`.
2. Register those bindings with `SimulationScenario`.
3. Let `SimulationScenario` own protocol sync and incremental updates.

## Quick Start

```python
import asyncio

from tensnap import (
    SimulationScenario,
    action,
    agent,
    agent_layer,
    chart,
    env,
    grid_layer,
    params,
)


@agent(x="position[0]", y="position[1]")
class Bird:
    def __init__(self, bird_id: int, position: tuple[int, int]):
        self.id = bird_id
        self.position = position


@grid_layer()
@agent_layer("birds")
@env(id="main")
class Aviary:
    def __init__(self):
        self.width = 20
        self.height = 10
        self.birds = [Bird(1, (2, 3)), Bird(2, (4, 5))]

    def step(self) -> None:
        for bird in self.birds:
            x, y = bird.position
            bird.position = (x + 1, y)

    @chart("population", "Population")
    def population(self) -> int:
        return len(self.birds)

    @action("scramble", "Scramble")
    def scramble(self) -> None:
        self.birds.reverse()


@params(include=["speed", "paused"])
class Config:
    speed = 1.0
    paused = False


scenario = SimulationScenario(port=8765)
model = Aviary()
config = Config()

scenario.add_all(model)
scenario.add_all(config)


async def main() -> None:
    await scenario.register_model_handler(model_step=model.step)
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
```

## `tensnap.bindings`

`tensnap.bindings` is the unified attach/readback surface.

### Attach decorators and configs

- `env(...)`: attach environment metadata to a class.
- `grid_layer(...)`: attach a grid layer config.
- `agent_layer(...)`: attach an agent layer config.
- `map_agent_layer(...)`: bind entries of a model-owned mapping as keyed agent items.
- `matrix_agent_layer(...)`: bind cells of a rectangular, row-indexed matrix as keyed agent items.
- `indexed_agent_layer(...)`: bind stable IDs to columnar or otherwise indexed model state.
- `edge_layer(...)`: attach an edge layer config.
- `trajectory_layer(...)`: attach a trajectory layer config.
- `background_layer(...)`: attach a background layer config.
- `agent(...)`: attach an item projector for agent-like objects.
- `edge(...)`: attach an item projector for edge-like objects.
- `trajectory_item(...)`: attach an item projector for trajectory config objects.
- `param(...)` / `BindParameterConfig(...)`: attach explicit parameter metadata.
- `params(...)` / `BindParametersConfig(...)`: configure automatic parameter discovery. `BindParametersConfig.EXCLUDE_ALL` is the built-in exclude-all config.
- `chart(...)`: attach chart metadata to a function or method.
- `action(...)`: attach action metadata to a function or method.

### Readback helpers

- `environment_binding(target) -> EnvironmentBinding | None`
- `layer_bindings(target) -> list[LayerBinding]`
- `layer_configs(target) -> list[BindLayerConfig]`
- `bindings(target) -> tuple[EnvironmentBinding | None, list[LayerBinding]]`
- `parameters(target, *cfg_suggest)`
- `charts(target)`
- `actions(target)`

These helpers accept classes, instances, modules, or plain dictionaries where that shape makes sense.

### Trajectory lifecycle fields

`trajectory_layer(...)` exposes every v0.3 trajectory metadata field directly:

```python
@trajectory_layer(
    agent_layer_id="agents",
    length=30,
    width=2,
    color="#2563EB",
    z_index=3,
    on_agent_delete="retain",
    on_state_sync="preserve",
    on_reset="clear",
)
class Model: ...
```

The lifecycle defaults are `delete`, `preserve`, and `clear`, respectively. `retain` closes an agent's current segment when the agent is deleted; reusing that id starts a separate segment. `on_state_sync="preserve"` retains renderer history across an authoritative state sync, while `on_reset="preserve"` keeps old segments but closes them before the reset state is replayed.

### Projector field forms

Layer metadata and item fields accept a compact set of forms:

- omit a field, pass `None`, or pass `auto()` to discover a same-name field once from the class or initialized instance
- pass a selector string such as `x="position[0]"` when the source path differs from the output field
- pass known literal strings such as `coord_offset="float"` or `icon="circle"` directly
- pass `value(...)` for non-obvious literal values, `attr(...)` for explicit selectors, `skip()` to suppress a field, or a callable such as `size=lambda agent: agent.radius`

Default layer source discovery follows the same idea: `agent_layer("birds")` reads `model.birds`, while `agent_layer("cells", item_iterable_projector="map_cells")` is only needed when the layer id and source member differ.

### Layer declaration conventions

Use a direct keyword for a built-in layer metadata field, such as `@grid_layer("grid", width=20)` or `@map_agent_layer("patches", z_index=3)`. Use `metadata={...}` for custom metadata, or when metadata is assembled as a mapping. This is the same layer metadata namespace: declaring one key in both places raises `TypeError`. Unknown direct options are rejected; custom keys belong inside `metadata`. The existing same-name field inference still applies to omitted built-in metadata fields. For example, `@grid_layer("grid")` can read `model.width` and `model.height`.

```python
@map_agent_layer("patches", z_index=3, metadata={"temperature": 21})
@grid_layer("grid", width=20, metadata={"height": 10})
class Model: ...
```

Layer metadata describes the layer; visual item fields belong in `fields`, `project`, or the source layer's direct `color`, `icon`, and `size` shortcuts. Shortcut strings are literal values; strings in `fields` are selectors. A fixed string in `fields` can be written as `value("square")`, while numeric and boolean constants can be used directly. `attr("value.color")` is an explicit selector. This is the same distinction used for ordinary agent projector fields. A shortcut can also be a callback receiving `(model, key, value)` for map and indexed layers, or `(model, row, col, value)` for matrix layers. A field cannot appear in both `fields` and a shortcut, and `project` cannot be combined with either `fields` or a shortcut. These conflicts fail when the layer is declared.

### Model-owned keyed sources

These decorators project model data without allocating agent wrapper objects. They use the existing v0.3 agent item messages and do not change the protocol. `project(model, key, value)` or `fields={...}` supplies visual fields. Matrix `project` instead receives `(model, row, col, value)`. A field selector can start at `model`, `key`, `value`, `row`, or `col`; for example, `"value.color"` follows an attribute path. A bare path such as `"color"` selects from the source value. Selectors are compiled when the layer is registered.

```python
from tensnap import (
    SimulationScenario,
    SourceBatch,
    SourceChange,
    env,
    map_agent_layer,
    matrix_agent_layer,
    scene_restore,
)


@scene_restore(validate=lambda _payload: None)
@map_agent_layer(
    "flags",
    color=lambda _model, _key, value: "#22c55e" if value else "#ef4444",
    revision="revision",
    changes="changes_since",
)
@matrix_agent_layer(
    "cells",
    color=lambda _model, _row, _col, value: (
        "#60a5fa" if value == "water" else "#a3e635"
    ),
)
@env("world")
class Model:
    def __init__(self):
        self.flags = {"gate": False}
        self.cells = [["land", "water"], ["water", "land"]]
        self.revision = 0
        self.events = []

    def changes_since(self, cursor):
        return SourceBatch(
            self.revision,
            [change for revision, change in self.events if revision > cursor],
        )

    def open_gate(self):
        self.flags["gate"] = True
        self.revision += 1
        self.events.append((self.revision, SourceChange("update", "gate")))


model = Model()
scenario = SimulationScenario(model_id="example.keyed-sources")
scenario.add_all(model)
```

Map and matrix layers read a model attribute named by the layer id when `source` is omitted; supply `source=` when the names differ. Matrix cells default to `icon="square"` and `size=1.0`; a projector or direct shortcut can override either. Map IDs default to string or JSON-safe integer keys. For integer `(x, y)` mapping keys, `key_codec=xy_key_codec("patch")` provides stable `patch:x:y` IDs and a checked inverse for restore. Other key types can use a `SourceKeyCodec(encode, decode)` or the `encode_key` / `decode_key` pair. An entry with value `False` remains an item; only a missing key is absent. Matrix IDs have the form `cell:row:col`, where row zero is the top row. Cell `x` is the column and cell `y` is `height - 1 - row`. Matrix layer metadata derives `width`, `height`, and `coord_offset="int"` from the source; callers cannot override these fields. `sparse_default=...` omits cells equal to that value; it is distinct from a present cell whose value happens to be false unless false is explicitly chosen as the sparse default. A shape change falls back to a full scan.

The initial state and reset use full projections; restore consumes a complete projected layer snapshot. Incremental updates use `revision` and `changes` together when available. The change method receives the last published cursor and returns a non-consuming `SourceBatch` of `SourceChange(operation, key)` entries, where `operation` is `"create"`, `"update"`, or `"delete"`. Return `None` if the log no longer covers that cursor; the binding then scans and compares the current source. Without a change method, it always scans and compares. An unchanged item emits no update, and the cursor advances only after item messages are sent. Change logs must record in-place value mutations too.

Incremental caches and source snapshots own nested projected dictionaries and lists. Full scans detect in-place nested changes and reuse unchanged cache records without deep-copying them again. Explicit dirty getters and change logs still control which items are visited; they must report those mutations.

`map_agent_layer` and `matrix_agent_layer` include `data.value` by default, allowing projected restore to reconstruct the owned mapping or matrix. Use `encode_value` and `decode_value` for values that need a wire representation. Their default inverse replaces a simple model attribute named by `source`; pass `replace=` for a custom setter or `restore=False` for display-only state. A custom visual `project` or `fields` definition can add fields but should not replace `id`, matrix `x`/`y`, or `data.value`. Projected restore validates keys, matrix dimensions, coordinates, duplicates, and missing dense cells before replacing either container. The model must also declare `@scene_restore(validate=...)` to opt into scene restore. `indexed_agent_layer` is display-only by default; use an explicit `@layer_restore` when its storage has an inverse. Exact checkpoint restore for private state such as RNG remains separate.

Field selectors, literal values, and eligible expression lambdas are compiled into one projection function. A lambda is inlined only when its source is unambiguous and its body uses fixed positional arguments without external names, defaults, inner scopes, or assignment expressions. Other callables run normally. The generated function's `inline_diagnostics` dictionary gives the reason for each callable field. Literal objects are bound in the compiler's environment rather than reconstructed from `repr`. Same-line lambda ambiguity falls back on Python 3.10; newer interpreters use code-position metadata when it is present.

Layer constructor keyword arguments use `Unpack[TypedDict]` typing (PEP 692). Concrete built-in layer option sets are closed and their item projector fields retain the layer's item-key type. Extensible metadata accepts a PEP 728 `extra_items` TypedDict or a `Mapping` whose values are `ProjectorFieldForInit`, preserving typed metadata keys. Pyright checks these contracts alongside library source. Shared splitters keep same-name metadata inference while rejecting unknown direct options at runtime. Python 3.10 or later is required; `typing-extensions>=4.13.0` provides the PEP 728 runtime support before Python 3.15.

## `SimulationScenario`

`SimulationScenario` is the recommended high-level API.

### Constructor

```python
scenario = SimulationScenario(
    host="localhost",
    port=8765,
    use_msgpack=False,
    step_interval=0.05,
    model_id="my.stable.model",
    state_schema_version="1",
)
```

Before any other simulator frame, each connection receives `simulator_info` with protocol/binding versions, the stable `model_id`, a per-process `instance_id`, optional model metadata/schema version, and the sorted declared capabilities. Keep `model_id` stable across releases of the same model and change `state_schema_version` when projected restore/checkpoint data becomes incompatible. The `instance_id` remains stable across reconnects and resets but changes for a replacement simulator instance.

### State stores

- `scenario.environments`: environment registry keyed by environment id.
- `scenario.parameters`: registered parameters keyed by parameter id.
- `scenario.actions`: registered action metadata keyed by action id.
- `scenario.charts`: registered chart getters keyed by chart id.

`SimulationScenario` registers the built-in renderer-driven actions `start`, `step`, and `reset` during construction. Reset reconciles action, parameter, environment, layer, chart, and monitor definitions with strict CRUD; stable agents are deleted before the reset snapshot is created, while stable trajectory configs are diffed so renderer `on_reset` policy remains authoritative.

### Combined registration

- `add_all(target, cfg_suggest=None, dry_run=False) -> dict[str, list[str]]`
- `remove_all() -> dict[str, list[str]]`
- `remove_by_dict(removals) -> dict[str, list[str]]`

`add_all(...)` is the normal high-level path. It registers any available environment/layer, action, and chart bindings on the target and returns changed registry ids grouped by kind. For undecorated targets with no explicit parameter config, it uses `BindParametersConfig.EXCLUDE_ALL` so incidental public attributes are not exposed. Attach `@params(...)` or pass a `BindParametersConfig(...)` to opt fields into parameter discovery.

`dry_run=True` returns the registry ids that would be registered without mutating scenario state. It is useful for planning custom registration lifecycles.

### Environment and layer registration

- `add_environment_binding(binding: EnvironmentBinding | EnvironmentRegistration, dry_run=False) -> dict[str, list[str]]`
- `add_environment(target: object, dry_run=False) -> dict[str, list[str]]`
- `add_layer_binding(env_id: str, binding: LayerBinding, target: object, dry_run=False) -> dict[str, list[str]]`
- `add_bound_layers(env_id: str, target: object, dry_run=False) -> dict[str, list[str]]`
- `set_layer_target(env_id: str, layer_id: str, target: object) -> None`
- `remove_layer(env_id: str, layer_id: str) -> dict[str, list[str]]`
- `remove_environment(env_id: str) -> dict[str, list[str]]`

`add_all(...)` is the normal path when your class is decorated with `env(...)` and one or more layer decorators. `add_environment_binding(...)` + `add_layer_binding(...)` is the manual path when you build bindings imperatively.

### Parameters, charts, and actions

- `add_parameters(target, cfg_suggest=None, dry_run=False) -> dict[str, list[str]]`
- `remove_parameters(param_ids) -> dict[str, list[str]]`
- `remove_all_parameters() -> dict[str, list[str]]`
- `add_charts(target, dry_run=False) -> dict[str, list[str]]`
- `remove_charts(chart_ids) -> dict[str, list[str]]`
- `remove_all_charts() -> dict[str, list[str]]`
- `add_actions(target, dry_run=False) -> dict[str, list[str]]`
- `remove_action(action_id) -> dict[str, list[str]]`
- `remove_all_actions() -> dict[str, list[str]]`

Automatic parameter discovery excludes private names by default. Pass `BindParametersConfig(include_private=True)` if you want `_private` fields included.

Objects can provide `__tensnap_parameter_metadata__(*configs)` to participate in parameter discovery without exposing ordinary attributes. `BoundModelReinitializer` uses this hook for constructor keyword parameters.

### Projection ownership

Built-in field, attribute, inferred agent, and map/matrix/indexed projectors return independent snapshots by default. Custom `item_projector`, `item_dynamic_projector`, `items_projector`, and source `project` callbacks keep safe publication copying unless the layer declares `projector_owns_values=True`. That declaration covers all nested values, including buffers; the producer must not mutate returned data after publication.

Item-bearing layer decorators accept `projector_deep_copy=True` and `deep_copy=None` alongside `projector_owns_values=None`. The first controls built-in detachment; the second overrides publication copying, whose automatic default is the inverse of ownership. Disabling built-in detachment alone keeps safe copying at publication. `LayerBinding.copy_items` stores the resolved publication policy. `build_item_list(model, deep_copy=None)` and `KeyedSource.snapshot(model, deep_copy=None)` can override publication copying for one call; passing false does not turn off an already owning projector. Internal initialization/full-sync/replay seeding passes `deep_copy=False` for the same already published records, while direct `seed_item_deltas_from_state(...)` calls still default to true. Standalone attribute/dictionary projectors and `ProjectionPlan.compile` also accept `deep_copy=True`. A callable explicitly constructed in borrowing mode does not acquire an ownership guarantee merely from `projector_deep_copy=True` on the layer; keep automatic publication copying unless its producer guarantees independent output.

Eligible built-in item, dynamic/inferred, and keyed-source scans compare current selections with previous owned snapshots before materializing changed fields. Equal nested fields may be shared with old read-only snapshots; outer-record identity is not an API guarantee. Standalone projector calls still return independent output, and custom/bulk `items_projector` callbacks retain their configured publication policy.

Map/matrix source wrappers protect their separately injected `data.value` even when custom visual fields are declared independent. The complete four-binding contract, explicit no-copy/double-copy configurations, and benchmark commands are in [projection ownership](../maintainer-guide/projection-ownership.md).

### Monitors and scene restore

Binding ownership, layer dependency direction, and one-time topology validation follow the [binding ownership contract](../maintainer-guide/binding-ownership-and-topology.md).

- `add_monitors(target, dry_run=False)` / `remove_monitors(ids)`
- `broadcast_monitors(ws=None)`
- `configure_scene_restore(restore, checkpoint_capture=None, checkpoint_restore=None)`
- `scene_restore(..., checkpoint_capture=..., checkpoint_restore=...)`
- `@layer_restore(create=..., update=..., delete=...)` on a class with a layer binding
- `@scene_restore(time=...)` and `@checkpoint(capture=..., restore=...)`
- `@scene_restore(time=RestoreValue(apply=..., validate=...))` for a model-aware time inverse

Monitor values are replace-only current state. Metadata changes use `monitor_delete` followed by `monitor_create`; `monitor_update` changes only the value/revision. Use charts when history is required.

Projected restore is opt-in through `restore(payload)`. Exact checkpoint support is advertised only when both checkpoint callbacks are configured. Capture returns model data and restore receives decoded model data; TenSnap infers `application/octet-stream` for bytes and MessagePack for other protocol data. The wire `{encoding, data}` object is never passed to model callbacks. Use `restore=None` (for example `@scene_restore(None, checkpoint_capture="capture", checkpoint_restore="restore_checkpoint")`) when the model supports exact checkpoints but has no projected-state inverse.

Capture stores only the data returned by the model checkpoint hook. Registering constructor controls does not add lifecycle fields or change the checkpoint encoding. To retain staged UI parameter values, save them with the scene snapshot and supply the existing `parameters` overlay on restore, when projected restore is supported. This overlay uses the protocol array form, for example `[{"id": "seed", "value": 42}]`. A model promising checkpoint-only recovery of pending initialization choices must include those choices in its own checkpoint, alongside the active model and RNG state.

Restore validates identity/schema/instance guards before mutation, applies the checkpoint before projected fields, replays the complete final declarations, environment items, monitor values and time without chart messages, caches each `request_id`, and uses a pre-restore checkpoint for rollback when both hooks are available.

For a declarative inverse, attach `@layer_restore` to the class that declares the layer. The binding uses that layer's ID, item projection, item keys, and dependencies to validate and reconcile complete snapshots. If a class declares multiple layers, specify `layer_id`. `delete` receives a key record such as `{"id": "a"}`; `create` and `update` receive complete projected item records.

```python
@checkpoint(capture="capture_checkpoint", restore="restore_checkpoint")
@scene_restore(
    time="restore_time", before_apply="prepare_model", after_apply="rebuild_indices"
)
@layer_restore(create="create_item", update="update_item", delete="delete_item")
@agent_layer("agents", items_projector=lambda model: model.agent_records())
@env("main")
class Model: ...
```

Use `@layer_restore(replace="restore_items")` for an array-backed layer and `@layer_restore(metadata="restore_metadata")` for a metadata-only layer. `time` may be omitted when only the scenario owns time. A checkpoint includes private RNG, scheduler, and collector state when exact continuation is required. `RestoreValue` gives a time inverse access to the model and an optional pre-apply validator. Both callbacks receive `(model, value)` and may be async. For a Mesa model using its default one-step schedule, import `mesa_clock_restore` from `tensnap.bindings.mesa` and pass it as `time=`. TenSnap validates that the projected time is a nonnegative integer and moves Mesa's next step event to the following tick. This works with Mesa 3.0 through 4.0.0a0; Mesa 3.0–3.3 use `steps`, Mesa 3.4 uses `steps` and `time`, and event-backed Mesa 3.5/4.0 uses `time` plus its default schedule. Models with a separate simulator, other pending events, or additional recurring event generators need a model-owned checkpoint that restores the complete scheduler state. The generic clock adapter rejects those event-backed cases before changing the model. If checkpoint import replaces the object registered as a layer target, set `target="get_new_target"` on `@layer_restore` so the binding refreshes it. The existing whole-payload callback remains available.

### Initialization and stochastic state

Seed is an ordinary model initialization parameter; TenSnap owns no generator. Use model-owned `random.Random` / NumPy generators or Mesa's `random` and `rng`. Mark initialization fields with `allow_runtime_change=False`. Constructor-only parameters discovered by `BoundModelReinitializer` default to that metadata; explicit custom metadata may override it. Existing model-owned runtime parameters retain their declarations.

`await scenario.reset()` performs the existing handler reset, chart clear and state reconciliation. Bound actions can await it under serialized action dispatch. `scenario.set_time_step(tick)` sets the protocol clock from a lifecycle/checkpoint callback without publishing or advancing any model; `tick` must be a nonnegative integer. A checkpoint adapter uses this public method after restoring model time. Framework clocks still need their native inverse.

Reuse paired checkpoint hooks for current RNG positions; a seed alone only restarts initialization. See the [reproducibility contract](../maintainer-guide/reproducibility.md).

### Handlers and runtime

- `register_handler(handler) -> None`
- `register_model(model, *, reinitializer=None, model_step=None, model_time=None, after_reinitialize=None, observe=None) -> BoundModelReinitializer`
- `register_model_handler(model_init=None, model_step=None, model_reset=None) -> None`
- `run() -> None`

`DefaultSimulationHandler` initializes lazily at time `0`, emits the first simulated tick as time `1`, computes full environment snapshots for init/reset, and emits layer-level incremental item diffs on subsequent steps. Step broadcasts use metadata-only environment snapshots so item projection is not repeated before the layer diff pass. If `model_reset` is omitted, reset falls back to `model_init`.

For lower-level hosting, `TenSnapServer.run()` serves until `stop()` is called on its event loop or the coroutine is cancelled. Shutdown closes the listener and connected renderers. Failed connection setup removes the client registration, and a pending screenshot request raises `ConnectionError` if every renderer disconnects. The batched outgoing queue schedules isolated messages within its configured flush interval and drains messages added during a send in wire order. `flush()` waits for shared delivery; cancelling one waiter does not cancel other callers' sends.

## Runtime Models

The scenario registry is built from these runtime objects.

### `EnvironmentBinding`

Pure environment binding metadata.

```python
from tensnap.models import EnvironmentBinding

binding = EnvironmentBinding(id="main", type="2d")
```

### `EnvironmentRegistration`

Scenario-owned environment entry containing one `EnvironmentBinding` and a per-environment layer registry.

Key methods:

- `add_layer_binding(...)`
- `remove_layer(...)`
- `clear_layers()`
- `build_state() -> EnvironmentState`

### `LayerBinding`

Pure layer binding metadata and projection rules.

Typical constructor fields:

- `layer_id`
- `layer_type`
- `item_keys`
- `metadata_projector`
- `iterable_getter`
- `item_projector`
- `item_dynamic_projector`
- `item_id_getter`
- `item_changed_getter`
- `items_projector`
- `source`
- `dependency_layer_ids`

`item_id_getter` and `item_changed_getter` are optional. Define them together with `iterable_getter` and an item projector to avoid projecting unchanged items. Leaving them unset keeps the default full-list diff behavior.

### `LayerRegistration`

Scenario-owned layer entry containing one `LayerBinding`, the current target object, and incremental diff cache.

Key methods:

- `set_target(target)`
- `reset_diff_state()`
- `build_state(include_items=True) -> EnvironmentLayerState`
- `build_item_deltas()`
- `commit_item_deltas()`
- `seed_item_deltas_from_state(...)`
- `build_item_delete_payloads(...)`

## Imperative Registration Example

```python
from tensnap.models import EnvironmentBinding, LayerBinding

scenario.add_environment_binding(EnvironmentBinding(id="main", type="2d"))

scenario.add_layer_binding(
    "main",
    LayerBinding(
        layer_id="agents",
        layer_type="agent",
        item_keys=("id",),
        items_projector=lambda model: [
            {"id": agent.id, "x": agent.x, "y": agent.y} for agent in model.agents
        ],
    ),
    my_model,
)
```

## Mesa Integration

The Mesa integration lives under `tensnap.bindings.mesa`, while the generic constructor-driven lifecycle helpers, including `default_cleanup_for_model(...)`, now live under `tensnap.bindings.lifecycle`.

### `SimulationScenario.register_model` and `BoundModelReinitializer`

```python
from tensnap import BoundModelReinitializer, SimulationScenario, bind_kwargs


@bind_kwargs(include=["width", "height", "seed"])
class MyMesaModel:
    # Keep the scientific model's constructor and native step implementation.
    ...


scenario = SimulationScenario(port=8765)
model = MyMesaModel(width=50, height=50)  # seed may use the model's default
await scenario.register_model(model)
await scenario.run()
```

`await scenario.register_model(model, *, reinitializer=None, model_step=None, model_time=None, after_reinitialize=None, observe=None)` registers one model's declarations and lifecycle. It returns the construction strategy. A second model lifecycle on the same scenario is rejected, including mixing this registration with `register_model_handler`. Additional explicit charts, actions or environments can still use the targeted registration APIs. Model declarations may not duplicate existing IDs in their registry. Failed registration removes its own declarations and handler so setup can be corrected and retried.

The scenario registers decorated environments, parameters, actions, charts, monitors and restore hooks. On initialization/reset it rebuilds the model in place, replaces the previous model-owned registry inventory and registers its new declarations. If construction raises before changing the model, the previous controls remain available for correction and retry. Separately registered content remains outside that inventory. Without `model_step`, stepping resolves `model.step` after each reconstruction so Mesa's native wrapper and clock stay current. A custom step callback can supply model-specific stopping or policy behavior.

`BoundModelReinitializer` owns construction choices and cleanup, with no scenario reference or registration methods. Constructor kwargs come from `bind_kwargs(...)`, `__init__` defaults, captured arguments for that instance, model attributes, or explicit `init_kwargs`. Model-owned parameters keep their declarations and stable IDs; only additional constructor kwargs become extra controls. Constructor-only controls default to `allow_runtime_change=False` and store their values separately from strategy methods and attributes.

For non-UI constructor options or positional resources, provide a strategy explicitly:

```python
reinitializer = BoundModelReinitializer(
    model,
    init_kwargs={"collect_data": False},  # excluded by this model's bind_kwargs
)
await scenario.register_model(model, reinitializer=reinitializer)
```

`init_kwargs` retains excluded construction options rather than exposing them as controls. `init_args` retains positional constructor resources without also passing them as keyword arguments. Default Mesa cleanup removes its old step wrapper before reconstruction; a custom `cleanup` callback may be supplied on the strategy.

Checkpoint callbacks still belong to the model and use the existing paired declarations or scenario constructor. After applying a checkpoint, the scenario refreshes construction choices from restored model attributes, then applies explicit projected parameter overrides. Constructor controls without a corresponding restored model attribute retain their current values; checkpoint-only restore does not recover UI values that the model never saved. The scenario re-registers declarations and primes publication state against the restored model. Combined checkpoint/projection requests validate layer topology against the restored configuration. When rollback hooks are available, a failed restore recovers the previous staged constructor controls and initialization status from transaction-local memory; these rollback values are not serialized. A `model_time` callback synchronizes protocol time after registration, initialization/reset, step and restore; it must return a nonnegative integer. For Mesa's default step-count clock, use `model_time=lambda: int(mesa_model_time(model))`.

`after_reinitialize()` runs after reconstruction and declaration registration, for application work such as rebuilding a guide policy. The optional `observe(model)` callback runs after registration, initialization/reset, step and successful restore; it can be asynchronous. Benchmark adapters use it for audit output. Ordinary examples need no observer, and TenSnap neither requires a seed nor manages a model's RNG.

The former reinitializer-owned `register_model`, `configure_reinit`, `reinitialize`, `model_init` and `model_reset` entry points are removed. Replace their registration/setup sequence with `await scenario.register_model(...)`; invoke `await scenario.reset()` for a complete reset. There are no forwarding aliases.

Related generic helpers exported from `tensnap.bindings.lifecycle`:

- `bind_kwargs(...)`
- `get_bind_kwargs(...)`
- `merge_registry_changes(...)`
- `default_cleanup_for_model(...)`

Mesa-specific cleanup helpers that remain under `tensnap.bindings.mesa`:

- `cleanup_mesa_model_step(...)`
- `mesa_clock_restore` for `@scene_restore(time=...)`
- `mesa_model_time(model)` to read the version-appropriate public clock
- `validate_mesa_model_time_restore(model, time)` and `restore_mesa_model_time(model, time)` for the default step schedule

`default_cleanup_for_model(...)` is still exported from `tensnap.bindings.lifecycle` and re-exported from the deprecated Mesa compatibility surface for cases where you want to compose it with additional cleanup callbacks explicitly.

### `MesaSimulationHandler`

Compatibility re-exports from `tensnap.bindings.mesa` remain available for one release cycle, but they now emit deprecation warnings that point to `tensnap.bindings.lifecycle`.

`MesaSimulationHandler` remains deprecated. New constructor-driven examples use `await scenario.register_model(...)`; explicit callback-only applications can still use `register_model_handler(...)`.

## Low-level server lifecycle and deprecated spellings

`TenSnapServer` requires `websockets>=13.0`. `run()` owns the listener until `stop()` is called; await the run task after stopping to wait for connections and the listening socket to close. Pending screenshot requests fail with `ConnectionError` when the last renderer disconnects.

Use `on_action_invoke` for action callbacks and `send_action_result(ws, action_id, request_id=...)` to flush queued scene updates before replying. The published `on_action_start` callback and `send_action_end(...)` helper remain deprecated compatibility entry points and emit `DeprecationWarning` when used. `send_action_end` maps its legacy `tick_id` to `request_id`; an explicit `request_id` takes precedence. The `ACTION_START`, `ACTION_END`, and `ASSET_META` enum aliases remain source-compatible but are deprecated in favor of `ACTION_INVOKE`, `ACTION_RESULT`, and `ASSET_METADATA`.

Import action/chart metadata from `tensnap.models`, and model reinitialization helpers from `tensnap.bindings.lifecycle`. Deprecated imports through the basic decorators and Mesa lifecycle modules still warn and forward to those owners. Private callback spellings and underscore-prefixed metadata constants are not supported import paths.
