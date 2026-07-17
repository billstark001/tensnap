# TenSnap Protocol Specification

This document specifies protocol version v0.3.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
describe requirements on implementations. This document is intentionally limited
to behavior that cannot be expressed by a schema or understood from one local
code path.

## 1. Contract boundary

`@tensnap/protocol` is the source of truth for communication between a
simulator and a renderer. Its contract is split by concern:

| Concern | Source of truth |
| --- | --- |
| Message and payload shapes, field meanings, defaults, and local validation | JSDoc and Zod schemas in `src/*.ts` |
| JSON/MessagePack encoding, binary normalization, validation policy, and legacy conversion | `src/codec.ts` and `src/binary.ts` |
| Cross-message ordering, lifecycle, transactions, and failure behavior | This document |
| Executable protocol trajectories | `conformance/*.json` |
| Generated API reference | `dist/protocol-types.md` |

The generated API reference is derived from the schemas and their comments. It
is not a second specification. Renderer persistence, project sources, view
layout, and painting behavior are outside the wire contract and belong to
`packages/core` or the host application.

The contract uses **simulator** and **renderer** for message direction. These
roles do not imply which peer opened a socket or which peer is an HTTP client or
server.

The simulator owns authoritative model state and action execution. The renderer
owns the synchronized presentation state, chart history, recordings, snapshots,
and view configuration. A state-sync inventory or renderer snapshot MUST NOT be
treated as authority over simulator state except through an explicit scene
restore.

## 2. Session identity and capabilities

### 2.1 Handshake

The first simulator message in a transport session MUST be `simulator_info`.
The renderer MUST validate and accept it before sending `state_sync`,
`action_invoke`, `scene_restore`, or `scene_capture`.

`model.id` is an opaque, stable identity for a model kind. Implementations
compare the final string exactly; they do not parse, normalize, or reorder it.
It remains stable across model restarts and endpoint changes. `instance_id`
identifies one running authoritative instance: it survives reconnects and
`init`/`reset`, changes when the simulator process or authoritative instance is
replaced, and remains fixed for one transport session.

Projects and snapshots retain `model.id`, `state_schema_version`, and the most
recent `instance_id`. A model mismatch isolates the existing project state and
MUST NOT trigger automatic sync or restore. A matching model with an
incompatible state schema MAY be inspected locally, but MUST NOT be restored to
the simulator.

Identity, binding information, and capabilities are immutable session data.
They cannot be changed by `metadata_update`.

### 2.2 Standard capabilities

The schema accepts namespaced capability strings so the contract can grow
without changing the handshake shape. The following names have defined
semantics:

| Capability | Meaning |
| --- | --- |
| `monitor` | Monitor definitions and current values are supported. |
| `action.target` | Environment, layer, and agent action targets are supported. |
| `action.kwargs` | Declared action arguments are supported. |
| `scene.restore.projected` | Parameters, time, and complete projected environments can be restored. |
| `scene.restore.checkpoint` | Exact model-private checkpoints can be captured and restored. |
| `scene.restore.topology` | Projected restore may create, delete, or change environment/layer topology. |

The presence of a schema field does not declare support. A request that uses an
undeclared optional capability MUST fail visibly, normally with
`unsupported_capability`; an implementation MUST NOT accept it and discard the
unsupported part.

## 3. State synchronization

`state_sync` asks the simulator to replay its authoritative state to the
renderer. Its arrays describe what the renderer currently holds; they are
read-only inventory. In particular, parameter values in the request MUST NOT be
written into the model. Assets continue to use `asset_sync`; chart history,
logs, screenshots, and snapshot data are not sync inventory.

A renderer with no useful inventory sends empty arrays and omitted revisions.
The simulator MUST still be able to perform a full replay.

The replay is a non-nestable transaction:

1. The simulator emits a matching `state_sync_begin`.
2. The renderer applies replay messages to staging state.
3. A matching `state_sync_end` atomically replaces the committed state.

`replace` starts with empty model-owned staging state. `reconcile` starts from
committed state and is valid only when the request and accepted session refer to
the same instance. Unknown revisions, uncertain incremental completeness, or an
instance mismatch require `replace`.

No staged state becomes observable as committed state before the matching end.
An invalid message, a mismatched boundary, or a disconnect discards the staging
state and preserves the last committed state. A `replace` clears old chart
history unless the replay explicitly supplies chart data; a same-instance
`reconcile` preserves chart history while applying explicit chart messages.

The first identity-checked sync received by an uninitialized simulator instance
invokes its initialization hook exactly once before `state_sync_begin`. Merely
opening a transport does not initialize the model, and reconnecting to the same
instance does not initialize it again. A binding that constructs the model
before transport setup may mark the instance initialized.

## 4. State mutation rules

For simulator-owned definitions and entities, creating an existing identity or
updating a missing identity is an error. Deleting a missing identity is an
idempotent no-op. Duplicate identities within one transaction reject the whole
transaction. Layer registries define item primary keys and determine whether a
primitive or composite delete key is valid.

`metadata_update` is a shallow patch: omitted keys retain their values and
`null` is a value, not a delete marker. Monitor updates replace the current
value rather than append history. Chart points for the same series and time are
last-write-wins. An inclusive truncate removes points at or after its boundary;
an exclusive truncate removes points after it. Explicit chart target kinds are
never inferred from a bare ID.

## 5. Actions and model lifecycle

### 5.1 Invocation transaction

The simulator is the final validator of action identity, scope, target,
arguments, and defaults. Validation SHOULD finish before the handler runs so an
input error cannot cause partial mutation. A normal handler failure is visible
through `action_result.error`, but the protocol does not promise rollback of
updates already emitted by that handler.

Every parsed `action_invoke` receives exactly one correlated `action_result`,
including rejected invocations and handler failures. Only an envelope that
cannot be parsed uses an independent `error` message. All state, monitor,
chart, asset, and metadata messages caused by the action MUST be sent before its
result.

An instance processes at most one action at a time by default. Action requests
are not assumed idempotent and MUST NOT be retried automatically after timeout,
disconnect, or an unknown result. An action error terminates the renderer's
current continuous loop, and `should_continue` is ignored when an error is
present.

### 5.2 Continuous execution

The renderer owns scheduling. An action definition with `continuous: true`
declares that repeated invocation is supported; it does not start a simulator
loop. A continuous view sends the next invocation only after a successful
result and the host render barrier. `should_continue: false` vetoes the next
invocation in the current run without changing the action definition.

A renderer may single-step a continuous-capable action. If it allows a user to
repeat an action that did not declare continuous support, it SHOULD warn first;
the simulator must still either execute or reject each individual request.

### 5.3 Reserved action IDs

`init`, `start`, `step`, `stop`, and `reset` are the only reserved action IDs.
They remain ordinary action definitions and do not bypass schema, scope, or
argument validation. Built-in controls use only model-scoped reserved actions
that can be called without user-supplied required arguments.

- `init` explicitly reconstructs the model from binding initial configuration.
  It is distinct from the one-time initialization hook associated with the
  first sync. It does not change `instance_id`.
- `step` advances exactly one model-defined logical step.
- `start` advances one simulator-defined run quantum. It MUST NOT start a
  hidden unbounded simulator loop. A renderer may use repeated `start`
  invocations for Run and fall back to a continuous-capable `step`.
- `stop` is a post-run model hook, not cancellation of an in-flight action. The
  renderer stops scheduling, awaits the current result, and then invokes it.
  Disconnect does not cause a later compensating `stop`.
- `reset` rebuilds dynamic state at the current canonical parameter values and
  restores the model-defined initial time. It does not invoke the initialization
  hook or change model/instance identity. Resulting environment, monitor, chart,
  parameter, and metadata changes are explicit messages sent before the result.

Parameter behavior across lifecycle operations is:

| Operation | Default parameter behavior |
| --- | --- |
| First initialization | Establish binding definitions and canonical values. |
| Explicit `init` | Restore binding initial configuration and publish all changes. |
| `start`, `step`, `stop` | Preserve values unless the action explicitly changes and publishes them. |
| `reset` | Preserve current canonical values unless the model explicitly publishes a correction. |
| `state_sync` | Read-only; never changes simulator parameters. |
| `scene_restore` | Apply only parameters present in the restore payload. |

## 6. Scene capture and restore

A projected scene contains renderer-visible parameters, time, environments,
layers, metadata, and items. It may omit RNG state, scheduler queues, private
indices, or external resources. A checkpoint is model-private state intended
for exact restoration. A model declares projected restore only when its
projection is sufficient to reconstruct a valid model; user interfaces MUST
NOT describe a projected restore as exact.

Each environment in a projected restore is complete rather than an item diff.
Unless topology restore is declared, the restored IDs, types, dependencies, and
layer topology must match the current model. Omitted top-level projected fields
remain unchanged; an empty parameter or environment array is a no-op. Within a
listed item-bearing layer, omitted `items` means an empty collection.

When checkpoint and projected fields are combined, the simulator applies them
in this order:

1. import the checkpoint;
2. apply listed parameters;
3. replace listed complete environments;
4. apply explicit time;
5. rebuild derived indices and validate model invariants;
6. replay the final authoritative state to the renderer.

Restore is a separate non-nestable transaction. The renderer first ends
continuous scheduling and waits for an in-flight action. The simulator validates
and prepares rollback state before `scene_restore_begin`, then replays the
result and ends with a correlated `scene_restore_end`. Only `status: "ok"`
commits renderer staging state. Chart messages are forbidden inside this
transaction; chart preservation, replacement, or truncation is a renderer-local
choice applied only after successful restore.

A disconnect during restore leaves the simulator outcome unknown. The renderer
must state-sync before taking further action and MUST NOT retry automatically.
A repeated restore `request_id` in the same instance MUST NOT apply the restore
again; the simulator returns a cached result or a duplicate-request error.

Checkpoint capture uses `scene_capture` and `scene_capture_result`, normally at
an action boundary. A checkpoint never travels in `action_result` or
`state_sync`.

## 7. Concurrency and failure recovery

- State sync and scene restore are mutually exclusive, one at a time, and may
  not nest.
- Restore and reset wait for the active action. The simulator still rejects a
  conflicting request as busy rather than relying only on renderer behavior.
- Correlation IDs are unique within an instance for the operation that owns
  them.
- Action updates may flow through the renderer's staging/render pipeline, but a
  recording frame is atomic at its matching `action_result`.
- Reconnect never automatically retries actions, restore, capture, or parameter
  changes. Identity acceptance and state sync happen first.
- Custom layers participate in projected restore only when their registry
  defines complete state, primary keys, and restore validation. Other custom
  layers are display-only for restore purposes.

## 8. Encoding, compatibility, and runtime validation

Canonical messages use snake_case core fields. User-defined maps such as
metadata, action arguments, monitor values, item data, and custom layer metadata
are opaque and retain their keys. Ordinary protocol values are JSON-like,
string-keyed, acyclic data. Binary is accepted only by fields whose schemas
declare it; JSON carries encoded strings and MessagePack carries bytes. The
codec normalizes both transports to the same semantic value.

Codec mode is selected once when a session is established. Current peers use
strict mode. Compatibility mode is path-aware and implements only the explicit
aliases in `src/codec.ts`; it never recursively renames arbitrary object keys.
Conflicting canonical and compatibility aliases reject the message. A
representation that cannot preserve the message fails with
`UnsupportedLegacyMessageError` instead of dropping unsupported data.

Runtime schema validation is independent of codec mode and defaults to `off`.
When enabled, an endpoint validates each message at most once with the complete
directional envelope schema; payload validation is already included. Binary
normalization continues when validation is off.

- `warning` reports structured issues and continues normal processing. A
  warning observer is non-fatal.
- `error` throws `ProtocolValidationError` and rejects the message. A renderer
  stops the affected continuous run locally rather than relying on another
  potentially invalid protocol message.

Hosts expose validation independently for each direction. The Web renderer
surfaces warnings and errors to the user; the Agent runtime records them as
runtime warnings/errors and events, and synchronous Agent commands return a
visible command error.

## 9. Publication cost requirements

Optional object families have zero publication cost when a model did not
register them. A step, reset, sync, or restore does not emit placeholder or
empty monitor, chart, layer-item, or asset updates merely because the protocol
supports that family.

An `items` projector is for complete sync/reset/restore state. A model with
high-frequency local changes uses an `updates` projector backed by changes the
model already tracks; it does not rebuild every item and ask the binding to
infer a shallow diff. Stable steps emit no `item_update`, and incremental items
contain primary-key fields plus fields that actually changed.

The runtime regression suite locks down validation being off by default,
warning/error behavior, at-most-once schema parsing, local continuous-run stop
on validation errors, host-visible diagnostics, zero updates for unregistered
families, zero item updates on stable model steps, and minimal incremental item
field sets. The Schelling binding is the reference high-frequency case for the
last two requirements.
