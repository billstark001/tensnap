# Projection ownership and publication copies

This is the item-projection contract shared by the Python, Go, Julia, and JS bindings. It applies to full sync, incremental item changes, reset/reconnect replay, and diff-cache seeding. It does not change the wire protocol.

## Independent projections

Model state remains mutable and model-owned. Built-in item projectors return independent snapshots by default: later model mutations cannot change a returned record, its nested dictionaries/arrays, or its binary data. A fresh outer record with model-owned nested values is not independent.

Custom projector callbacks keep the safe default. The binding detaches their new or changed records before retaining or publishing them. A callback may explicitly declare that its complete output already meets the independent-snapshot contract; the binding then skips that publication copy. This is a lifetime promise, not a unique pointer implementation or a runtime ownership check.

After publication, records and all their nested values are read-only by convention. Diff caches, pending sends, and observers may share them. The producer may reuse immutable values or unchanged previously published fields, but must never overwrite shared storage, including reusable scratch dictionaries, lists, slices, and byte buffers. Consumers needing mutable state must make their own copy. Model callbacks that restore decoded data must likewise detach anything they will mutate from a retained replay/diff snapshot.

Project only acyclic portable protocol values. Go additionally preserves typed maps, slices, arrays, pointers, and exported struct fields while detaching them; private mutable state and custom marshalers should be projected into ordinary protocol containers explicitly.

## Layer configuration

| Purpose | JS/TS | Python / Julia | Go builder |
| --- | --- | --- | --- |
| Declare projector output independent | `projectorOwnsValues` | `projector_owns_values` | `.ProjectorOwnsValues(bool)` |
| Enable built-in projector detachment | `projectorDeepCopy` | `projector_deep_copy` | `.ProjectorDeepCopy(bool)` |
| Override publication detachment | `deepCopy` | `deep_copy` | `.DeepCopy(bool)` |

Ownership defaults to the built-in projector's capability and to false for custom callbacks. Built-in detachment defaults to true. Publication detachment defaults to the inverse of the resolved ownership capability. Configure these options when constructing the layer, before it retains state.

| Configuration | Projector | Publication boundary |
| --- | --- | --- |
| Built-in defaults | Detaches selected mutable values | Reuses the independent projection |
| Custom defaults | May borrow model values | Detaches new/changed records |
| Custom with ownership declared true | Caller supplies an independent projection | Reuses it |
| Built-in with publication copy true | Detaches | Also requests publication detachment |
| Built-in detachment false, publication automatic | Borrows | Detaches before retention/publication |
| Both copy controls false | Borrows | Retains borrowed values; stability is the caller's responsibility |

The copy controls select where ownership is established; they do not promise fresh object identity or an exact allocation count. A publication override affects that boundary only: `deep_copy=false` does not turn off an owning built-in projector, and `deep_copy=true` does not reconfigure a custom callback. An explicit publication true requests a safe detachment; implementations may still reuse equal previously owned fields/records. It does not promise an allocation for every unchanged value. A false override can invalidate diff baselines if the producer later mutates an alias. Setting both flags explicitly also allows intentional second copies or fully borrowed operation.

For map/matrix source layers, the framework injects `data.value` from the model separately from custom visual fields. Declaring the visual callback independent does not make that injected value independent: the source wrapper detaches it by default. `projector_deep_copy=false` (or its language equivalent) also disables that protection when deliberately borrowing the source value. Python indexed sources have the same custom-projector ownership option; their callback returns the complete projected record.

### Examples

```ts
builder.env('world').agentLayer('agents', {
  items: (model) => model.agents,
  project: (_model, agent) => ({ id: agent.id, data: structuredClone(agent.data) }),
  projectorOwnsValues: true,
});
```

```python
@agent_layer(
    "agents",
    item_projector=lambda agent: {"id": agent.id, "data": deepcopy(agent.data)},
    projector_owns_values=True,
)
class Model:
    ...
```

```go
layer := binding.NewAgentLayer[*Model, *Agent]("agents").
    Items(func(m *Model) []*Agent { return m.Agents }).
    Project(func(_ *Model, a *Agent) map[string]any {
        return abm.SnapshotItem(map[string]any{"id": a.ID, "data": a.Data}, true)
    }).ProjectorOwnsValues(true)
```

```julia
agents_layer("agents", m -> m.agents;
    projector = a -> Dict{String, Any}("id" => a.id, "data" => deepcopy(a.data)),
    projector_owns_values = true)
```

The custom examples deliberately perform the one necessary copy inside the callback. Prefer built-in field declarations when they express the same projection.

## Low-level boundaries

Direct publication entry points are safe by default; pass the no-copy override only for already independent, stable values. JS `changes()` returns projected records directly and bypasses `project()`, so its custom output keeps publication copying unless layer ownership is explicitly declared. Built-in source wrappers declare that guarantee for their own records.

- JS `ctx.createItems`, `updateItems`, `deleteItems`, and `syncRecordChanges` take an optional final `deepCopy` boolean; `syncRecords` takes `options.deepCopy`. These control publication copying, not an earlier projector call. `projectFields(fields, deepCopy=true)` selects the standalone function's ownership capability. The layer's `projectorDeepCopy` configures projectors it constructs from `fields`, identity items, or source declarations; it does not reconfigure a function supplied as `project` or `updateProject`. Default identity projection is independent.
- Python `LayerBinding.build_item_list(model, deep_copy=None)` and `KeyedSource.snapshot(model, deep_copy=None)` use the resolved layer/source policy unless overridden. `deep_copy=False` at these entry points suppresses publication copying only; an owning projector still detaches its output. `seed_item_deltas_from_state(state, deep_copy=True)` accepts an explicit false when seeding from the same published records, as initialization and replay do internally. Built-in `make_attr_projector`, `make_dict_projector`, and `ProjectionPlan.compile` accept `deep_copy=True`. `copy_for_publication(value, deep_copy=True)` is the internal copy primitive.
- Go `ItemDiffTracker.DeepCopy` and `NaiveItemDiffTracker.DeepCopy` default to true through their constructors. Set the property before the first seed/compute; `Reset` preserves it. Ordinary `Seed`, `SeedSnapshots`, and `Compute` honor the property where available. `ComputeBorrowed` instead always materializes independent new/changed records, even when `DeepCopy=false`, and can reuse equal previous owned fields. The precise tracker accepts `(items, idFn, changedFn, projFn)`; the naive tracker accepts `(count, projectIndex)`. Both consume and detach one projection before invoking the next projector. They require any existing baseline to be independent and cannot repair aliases retained earlier in an unsafe mode. `SeedOwnedSnapshots` / `SeedOwned` explicitly retain already published snapshots. `abm.SnapshotItem(item, bool)` / `SnapshotValue(value, bool)` detach at manual boundaries. Standalone tag projectors accept `binding.TagDeepCopy(bool)`; layer builders use `.ProjectorDeepCopy(bool)` for their composed output.
- Julia `dictprojector`, `propertyprojector`, and `autoagentprojector` accept `deep_copy=true`. Manual `create_items!`, `update_items!`, and `delete_items!` accept the keyword `deep_copy=true`, independent of an automatic layer's policy. Layer configuration resolves the policy once. Ownership and wire normalization are separate capabilities: custom-owned output and manual no-copy calls still normalize symbols, tuple contents, and dictionary keys. Known normalized built-in item payloads bypass repeated normalization; MessagePack wraps binary leaves lazily without rebuilding the snapshot tree.

No per-item options dictionaries are needed in diff trackers. Projectors/layers declare their ownership capability; copy policy is resolved outside per-item loops and stored on persistent trackers where appropriate. JS resolves its layer policy per publication batch; class-dispatched Python projections cache it per item class. Internal full-sync/replay paths seed the cache with the same stable published records instead of copying them again.

Go previously kept shallow map copies, allowing an in-place nested map/slice update to rewrite the old baseline and disappear from a diff. Both tracker modes now detach nested state by default. Julia projections also detach binary buffers and mutable values nested inside tuples.

## Incremental materialization

Standalone built-in projector calls still return independent nested snapshots. Eligible automatic layer scans can use a private borrowed view of that same compiled selection while comparing against the layer's previous independent snapshot. After selecting one item's fields, the scan compares and materializes its record synchronously before advancing to the next item's selectors. Temporary borrowed projections must not escape into retained caches, pending messages, observers, or an asynchronous suspension.

JS bound-session scans use this path for built-in field, identity, and map/matrix projections when publication copying is disabled by the resolved policy. Layers with a function-valued `key` retain the original eager projection path, so the key callback receives the projector's configured output rather than a private borrowed view. Explicit `updates()` and `changes()` retain their existing publication paths. Python item/inferred projectors and keyed-source plans, Go built-in layer trackers, and Julia automatic agent/map/matrix layers have corresponding materialization paths. Bulk/custom callbacks are not automatically treated as built-in selections.

Unchanged nested fields can reuse the previous read-only values. Some paths also retain the entire previous record when it compares equal; others allocate a new outer record. Record identity is not a cross-binding guarantee. Changed records may reuse equal previously owned fields and detach only new/changed mutable fields. This sharing is between independent, read-only snapshots; it never relies on a mutable model container retaining the same identity. Thus in-place nested mutation remains detectable. Scalar values do not need a recursive copy, and ownership policy is resolved outside per-item options containers.

The optimization does not evaluate a projector or field selector a second time just to decide whether copying is needed. Custom item callbacks retain their existing safe/owned policy; bulk `items_projector` callbacks keep their layer-level invocation pattern. Explicit forced publication-copy modes retain their separate detachment boundary; explicit borrowing controls are not silently strengthened. The optimized built-in scan is an implementation detail, not a new public borrowing mode. Python handler initialization and full replay cache seeding retain already published snapshots without another deepcopy.

Without precise changed-item/revision accessors, unchanged mutable graphs still need content comparison. This optimization reduces copying and allocation; it does not make a generic full scan proportional only to the number of changed items. Initial publication still has to establish an independent snapshot.

Go's eligible composed built-in scans reuse an outer selection map within one batch. The tracker consumes it before the next selection and stores independent records; the scratch map never becomes a published payload or baseline. Changed-field materialization consumes the existing diff rather than comparing the same fields again. Standalone projectors and explicit copy modes keep their configured detachment boundaries.

Go trackers also retain key-set scratch capacity across diff scans. They clear key references when each scan returns, resize storage when the population changes substantially, and release it on `Reset`. This trades retained empty table capacity for less cumulative allocation and GC work; it is not a guarantee of lower idle/live heap usage. The scratch set holds no snapshot values.

Go compares common scalar values, ordinary `map[string]any` / `[]any`, and common scalar slices through standard-library map/slice helpers. Comparison preserves `reflect.DeepEqual` semantics, including exact types, nil versus empty containers, NaNs, and same-container identity. Other types and deep/cyclic comparison inputs retain the reflection fallback; snapshots themselves still require acyclic portable values. Struct copying caches immutable type-level field plans in a process-local `sync.Map`, including only exported fields that need recursive traversal. It never caches model values, comparison results, or per-call traversal state. Private mutable struct state remains outside the supported projection contract.

## Focused benchmarks

Run from the repository root, except the Go command's explicit subshell. No sockets, renderer, or rAF scheduling are included. Set `TENSNAP_BENCH_PHASE=sync` for JS/Go, or `--phase sync` (Python) / `--phase=sync` (Julia), to measure full snapshot production and retention rather than incremental diffing; these focused scripts do not send frames to a renderer. Changed diff/sync cases mutate approximately 1% of items per pass, with at least one item; initial baseline seeding is outside the timed loop. Modes distinguish built-in projection, the same built-in field selection with detachment deferred to publication (`boundary`), custom safe publication, custom independent projection, and forced publication copying. The JS script bundles standalone projection/copy/diff helpers and runs them through Vitest's native module runner to avoid export-getter instrumentation. It does not instantiate a bound session or exercise that session's private borrowed-view optimization. Python, Go, and Julia use their automatic binding/layer paths. Use a session-level benchmark, such as the retained three-revision runs under `benchmark-results/`, to assess the JS session optimization; helper timings are not a substitute for it.

```bash
TENSNAP_BENCH_ITEMS=1000 pnpm --dir packages/tensnap-js bench:projection -t '1000 nested changed'
python packages/tensnap-python/benchmarks/item_diff.py --case changed-nested --projection builtin --count 1000 --iterations 100 --repeat 5
(cd packages/tensnap-go && go test ./binding -run '^$' -bench '^BenchmarkProjectionOwnership$/^1000$/^nested$/^changed$/' -benchmem -benchtime=500ms -count=5)
(cd packages/tensnap-go && go test ./abm -run '^$' -bench '^(BenchmarkProjectionEqual|BenchmarkSnapshotStruct)$' -benchmem -benchtime=500ms -count=5)
julia --project=packages/tensnap-julia packages/tensnap-julia/benchmarks/projection_ownership.jl --count=1000 --shape=nested --changes=changed --mode=all --iterations=100 --repeat=5
```

Python also accepts `--projection boundary|custom|owned|double`; Julia accepts `--phase=encode --encoding=json|msgpack` for encoding an already published snapshot. Select scalar and unchanged cases separately. On macOS, prefix timed runs with `caffeinate -di` and keep power conditions consistent.

Go `-benchmem` reports cumulative allocated bytes and allocation counts; Julia's `@allocated` reports cumulative managed bytes. The standalone JS/Python commands above report timing, not a comparable allocation metric. In a separately instrumented experiment, V8 allocation sampling is an estimate, while Python `tracemalloc` incremental peak measures extra simultaneously live traced memory, not cumulative allocation traffic. Compare the same metric within one language and keep instrumentation out of the timed runs.

These modes are not interchangeable before/after implementations. Eligible built-in automatic scans compare private borrowed selections against previous owned snapshots before materializing changed fields. The JS helper benchmark deliberately measures standalone projectors, whose independent-output guarantee still requires materialization on each call. Standalone calls and forced double-copy modes still perform their configured detachment. Use precise changed-item/revision accessors where available to avoid reprojecting unchanged items. A reduced copy count alone does not establish an overall speedup; compare the same projection, correctness guarantees, and workload.

## Remaining transport and non-item lifetimes

- JS WebSocket output currently copies `Uint8Array` into `Buffer`; the browser transport also constructs another `Uint8Array`. A zero-copy send view is safe only with a defined input lifetime and a transport-consumption boundary. A pooled encoder's borrowed scratch view cannot become a pending asynchronous frame without such a lease. The session codec returns owned MessagePack output; the item ownership changes do not remove these transport copies. Separately, the Node JSON receive path can copy an existing `Buffer` before UTF-8 decoding. Decoding that buffer synchronously already produces an independent string, so that intermediate byte copy does not require a new asynchronous ownership convention to remove.
- Python's `BatchedMessageQueue` retains encoded immutable `str`/`bytes`, not model dictionaries. `server.broadcast` encodes before queuing and shares that encoded frame across recipients. This queue is not an additional repeated-deepcopy boundary.
- Go's MessagePack codec copies its pooled encoder buffer into owned output before returning the encoder to its pool. The synchronous emitter encodes and writes a frame, while the tracker retains its detached item baseline long after that call. A snapshot policy and a socket-write policy solve different lifetimes.
- Julia's broadcast currently calls encoding for each client. A later optimization could encode once per distinct policy/encoding and share a stable frame. It must preserve per-client encoding selection, ordering, error handling, and snapshot lifetime.
- JS `createLinkedEndpoints` currently queues the original message reference in a microtask, without cloning it. Thus even a delay shorter than a network send can expose a mutable alias. Native browser `postMessage`, custom emitter callbacks, and recording/worker transfers need their own lifetime audits: passing a reference, structured cloning, and transferring a backing buffer have different ownership effects. A transport-independent declaration must not assume they are interchangeable.
- Monitor values, chart histories, layer metadata, assets, checkpoints, replay caches, and restore inputs can have the same aliasing problem even when item diffing is safe. Audit each retained value and every handoff to user callbacks, rather than adding blanket deep copies at each layer.
