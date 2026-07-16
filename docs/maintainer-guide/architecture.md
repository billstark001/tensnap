# TenSnap Architecture

Architecture overview for maintainers working on the 0.2.0 codebase.

## System Model

TenSnap is organized around a renderer-owned state model.

- The simulator computes domain state and emits protocol messages.
- The renderer owns the in-memory `Scenario` and applies those messages locally.
- Rendering, snapshots, charts, assets, and UI are all derived from renderer-side state.

```text
┌──────────────────────┐     protocol v0.2      ┌──────────────────────┐
│ Simulator runtime    │ <────────────────────> │ Renderer runtime     │
│                      │   JSON / MessagePack   │                      │
│ Python / Go / JS /   │                        │ web / tauri / agent  │
│ Julia / other        │                        │                      │
│ step executor        │                        │ Scenario owner       │
└──────────────────────┘                        └──────────────────────┘
```

The protocol intentionally uses `renderer` / `simulator` terminology rather than `client` / `server`, because the same contract is used by the browser app, the Tauri shell, and headless agent runtimes.

## Package Map

### `packages/protocol`

Shared protocol package.

Owns:

- protocol v0.2 message types, schemas, codecs, and transport-independent
  observable behavior

### `packages/core`

Shared runtime and rendering package.

Owns:

- `Scenario` state model and snapshot logic
- `RendererSession`: transport binding, protocol application, state-sync commit
  transaction, asset sync, screenshot replies, and outbound controls
- `RunController`: renderer-driven bounded action runs and safe stop conditions
- layer registry, dependency graph, and render-plan helpers
- shared environment storages and built-in render layers
- shared runtime pipeline helpers
- project-level `AssetStore`

The protocol package owns wire payloads and cross-runtime lifecycle behavior.
Core owns the renderer-side state and reference implementation, plus
renderer-local rendering semantics built on top of that contract.

## Rendering Contract Ownership

`packages/core` is the single source of truth for rendering semantics across the repository.

The core-owned rendering contract includes:

- layer roles, metadata, dependencies, and storage/controller behavior
- scene-bound discovery and view metadata resolution
- render-plan generation and snapshot render-data collection
- shared environment and chart rendering semantics
- the renderer-side implementation of the protocol-defined
  dispatch/apply/render pipeline
- asset, icon, background, and trajectory interpretation rules needed to render a `Scenario`

All other packages must treat this contract as read-only infrastructure.

- `packages/tensnap-web` may own browser lifecycle, React bindings, browser render barriers, and browser-only integrations, but must not redefine layer, session, or loop semantics.
- `packages/tensnap-agent` may own headless runtime lifecycle, backend registration, and Node scheduling, but must not keep a package-local scene model, session, or rendering rules.
- `packages/tensnap-js` may own simulator-side TypeScript sessions, emitters, and transports, but must not redefine renderer-owned layer semantics.
- `packages/benchmark` may own benchmark orchestration and reporting, but its browser cases must mount the production Web host instead of defining an alternative renderer or runtime loop.
- `examples/js` may own model content and example packaging, but must not introduce package-local rendering adapter abstractions when the same semantics already exist in `packages/core` or `@tensnap/js`.

Any new rendering backend or benchmark harness must consume the core-owned render plan and runtime contract rather than inventing a package-local projection model.

### `packages/tensnap-web`

Main browser renderer application.

Owns:

- browser transport wiring
- scenario store integration
- project/file UI
- environment/chart views
- screenshot capture registry and browser-only integrations

### `packages/tensnap-tauri`

Desktop wrapper around the web renderer.

Owns:

- Tauri shell and native menu integration
- app-data settings persistence and scoped desktop file picker/filesystem integration
- the single minimal desktop capability and Content Security Policy
- renderer build that mirrors the web package's Lingui/SWC pipeline

### `packages/tensnap-agent`

Headless runtime and session tooling.

Owns:

- headless host around core `RendererSession`
- node-side websocket transport
- offscreen environment painting
- HTTP/CLI control endpoints for automation, bounded runs, and capture workflows

### `packages/tensnap-python`

Python binding and runtime integration package.

Owns:

- `SimulationScenario`
- `tensnap.bindings` decorators and readback helpers
- low-level `TenSnapServer`
- default simulation handlers and Mesa integration
- protocol delta builders for environment/layer/item sync

### `packages/tensnap-go`

Go simulator binding package.

Owns:

- `protocol` wire types and JSON codec
- `abm` model interface, `Base`, `Scenario`, `ActionRouter`, and `Emitter`
- `binding` declarative builders, tag-based projectors, and item diff helpers
- `server` WebSocket integration

### `packages/tensnap-js`

JavaScript/TypeScript simulator binding package.

Owns:

- `modelBuilder(...)` and the modular declarative binding pieces for parameters, layers, charts, actions, assets, and session sync
- low-level protocol metadata helpers such as `defineScenario(...)`, `defineParameters(...)`, `defineEnvironment(...)`, `defineLayer(...)`, `defineCharts(...)`, and `defineActions(...)`
- `SimulatorSession` and `SimulatorEmitter`
- `ScenarioRegistry`
- postMessage and WebSocket simulator hosts

### `packages/tensnap-julia`

Julia simulator binding package.

Owns:

- `Scenario` and explicit Julia builders for parameters, actions, charts, environments, and layers
- JSON and MessagePack WebSocket handling
- Agents.jl-compatible projectors without taking an Agents.jl dependency
- incremental layer item diffing, asset sync, screenshot requests, and package tests

### Supporting browser packages

- `examples/js`: built-in TypeScript models, local transport entrypoints, manifests, and benchmark fixtures
- `packages/web-common`: shared browser-side UI/types/helpers
- `packages/web-adapter`: browser-side filesystem and integration helpers
- `packages/benchmark`: benchmark harnesses for render/runtime paths

## Protocol v0.2 Ownership

`packages/protocol` owns the canonical wire contract and its behavior
definition. `packages/core` is the reference renderer implementation of that
contract; it must not redefine protocol behavior.

Important message families:

- scenario metadata: `metadata_update`
- sync transaction: `state_sync`, `state_sync_begin`, `state_sync_end`
- environments: `env_create`, `env_delete`
- layers: `env_layer_create`, `env_layer_update`, `env_layer_delete`
- layer-owned entities: `item_create`, `item_update`, `item_delete`
- controls: `param_*`, `action_*`
- charts: `chart_*`
- assets: `asset_metadata`, `asset_sync`, `asset_data`, `asset_delete`
- screenshots: `screenshot_request`, `screenshot_response`

The old v0.1 messages (`time_step_start`, `time_step_end`, `environment_update`, `agent_batch_update`, `button_click`, `parameter_change`) are historical only and should not be used for current runtime work.

## Scenario Model

`Scenario` is the canonical renderer-side state container.

Key properties:

- transport-agnostic
- UI-framework-agnostic
- event-driven
- snapshot-capable
- layer-aware rather than hard-coded to specific environment types

The live model is organized as:

- scenario metadata
- environment registry
- per-environment layer registry
- per-layer storage and metadata
- asset store
- chart storage

An environment is currently `uniform` or `2d`. Actual rendering semantics come from its layers, not from a separate `grid` or `graph` environment kind.

## Layered Environment Model

Built-in layer types currently include:

- `agent`
- `edge`
- `trajectory`
- `grid`
- `background`

The layer registry defines:

- metadata schema
- item schema
- primary key fields
- dependency requirements
- storage/controller factories
- render-plan behavior

This is the main abstraction boundary that replaced older environment-specific update paths.

### Dependency Graph

`ScenarioEnvironmentState` keeps a dependency graph so dependent layers can update deterministically.

Examples:

- `edge` depends on an `agent` layer
- `trajectory` depends on an `agent` layer

Layer creation carries `dependency_layer_ids`; changing dependencies is a structural change and normally requires recreating the layer.

## Runtime Flow

### Initial sync / reconnect

1. `RendererSession` sends `state_sync` with the current summary.
2. Simulator replies with `state_sync_begin`.
3. The session applies replayed `*_create`, `*_update`, and `*_delete`
   messages immediately, but buffers the UI commit.
4. On `state_sync_end`, the session publishes one `state-sync` commit and the
   UI renders the reconstructed `Scenario`.
5. The renderer continues from that state.

### Continuous execution

1. `RunController` dispatches an action with `action_invoke`.
2. Simulator executes one step.
3. Simulator emits state mutations.
4. Simulator ends the tick with `action_result`.
5. `RunController` evaluates its optional stop expression, checks the finite
   step/deadline policy, waits for the host render barrier, then decides whether
   to start the next tick.

This keeps loop ownership in the renderer and avoids server-owned hidden timers in the protocol contract.

Every continuous run has a positive `maxSteps`; the default policy limit is
1,000,000. A `stopWhen` expression is parsed once and runs only before the
first dispatch and after an `action_result`. It has a read-only incremental scope:
`steps`, `time`, metadata, parameters, charts, `agent()`, and `agentCount()`.
It cannot invoke arbitrary host functions or rely on a full scenario dump.
The agent CLI can explicitly raise its policy while starting a runtime with
`--max-steps-policy <n>`; the configured limit is included in runtime status.

`action_result` is the action transaction boundary. A simulator must not send it until all state messages caused by the action have been written to the transport in order. This applies to reserved actions as well: `step` and one `start` dispatch both advance exactly one tick, while `reset` publishes the rebuilt time-0 state before completing.

The render barrier is a host boundary, not a best-effort Promise. A rejection
is caught by `RunController`, reported through its host-error callback, and
ends the affected run with `render-error`; the pipeline is then released. A
later run is not stopped by an old barrier rejection because the controller
matches the original task id.

## Recording, Replay, and Project Persistence

`SnapshotRecorder` records protocol activity as atomic frames. It coalesces
repeated item/metadata/parameter updates at a frame boundary, inserts adaptive
keyframes, and enforces frame, duration, and byte budgets. Replays use the
same `Scenario`/layer registry as a live session; they are offline copies and
must not be treated as a restore of a still-connected simulator.

For persistence, core turns a `Snapshot` into independently decodable
MessagePack segments. Each segment carries a base keyframe and lossless
compression metadata, enabling worker-based encoding and random access without
requiring an earlier segment. Project files use format version 2: the live
scenario and all recordings reference one project-level asset table by hash.
The browser encoder runs in a Worker when available and has a synchronous
fallback for tests and unsupported hosts. Version-0/1 project files retain
their legacy reader and are upgraded on load.

`layerCodecs` remain recording policies (`delta`, `keyframe`, `adaptive`, and
`derived`). A concrete `SnapshotLayerCodecImplementation` can override the
delta/keyframe behavior for a host-specific layer; the policy label is not a
claim that the data already has a custom binary codec.

`packages/benchmark` has three explicit suites. Component cases mount production
Web chart/environment components and update their core storages directly, so
they measure rendering without transport. Complete-model cases supply bundled
simulator transports to the benchmark entry point exported by
`packages/tensnap-web`; that host mounts the production transport store,
`RendererSession`, Zustand subscriptions, auto-layout, React view tree, and
canvas renderers. The random-walk comparison runs one seeded workload through
raw Leafer, core layers without transport, and the full Web transport path.

All suites use `BrowserRunRenderBarrier` and report complete cycle latency/TPS.
Direct component/layer cases additionally report synchronous mutation cost.
Model cases report requested steps, actual completed steps, and their stop
reason; a simulator-requested early stop is a valid partial result rather than
a benchmark failure. `assertBenchmarkRegressionGate` compares p95/TPS results
against the selected machine-class baseline.

## Inspection and Trajectory Semantics

`ScenarioInspector` resolves an `AgentRef` against current Scenario state for
every inspection. Spatial inspections compute a viewport, target overlay,
neighbors, edges, and trajectories from shared core semantics; graph
inspections reuse a read-only layout and must not start another force
simulation that writes agent positions.

Trajectory layers declare lifecycle metadata: state-sync may preserve or clear
trails, reset may preserve or clear them, and agent deletion may delete or
retain an old segment. State-sync replay must never append movement points.
When a retained id reappears, a new segment begins instead of drawing a line
from the deleted agent to its replacement.

## Python Runtime Architecture

The recommended Python surface is:

- `SimulationScenario` for high-level orchestration
- `tensnap.bindings` for decorators and metadata discovery
- `register_model_handler(model_init=None, model_step=None, model_reset=None)` for default lifecycle wiring

Important semantics:

- built-in renderer-driven actions are `start`, `step`, and `reset`
- initial synchronized state is time `0`
- the first simulated tick after `start` or `step` is time `1`
- `start` and `step` both execute one tick; `start` is continuous-capable because the renderer may dispatch it repeatedly after each `action_result`
- `reset` reinitializes the model and broadcasts the resulting time-0 state before its `action_result`
- if `model_reset` is omitted, reset falls back to `model_init`

Low-level Python integrations should go through `TenSnapServer` and layer-aware update helpers such as:

- `update_layer_metadata()`
- `update_layer_items()`
- `update_layer_agents()`
- `update_layer_edges()`
- `replace_layer_state()`
- `replace_environment_layers()`

## Frontend Architecture

### Web renderer

The web app composes:

- browser transport management
- scenario store subscriptions
- environment/chart rendering
- project filesystem UI
- settings/i18n integration

Live environment rendering is layer/storage driven. Current render paths read `ScenarioEnvironmentState.layers` directly rather than reconstructing environment views from full agent dumps on every tick.

The primary click of a continuous button starts an explicit manual run and
continues until the user pauses it. The button's context menu keeps the normal
edit/delete entries and adds a separate continuous-run configuration item. That
dialog records a bounded profile (`maxSteps`, optional stop expression/deadline,
and recording flag) per action; while active, the same menu exposes stop and
single-step actions. Changing a button away from continuous mode stops and
hides its matching run. Button-visible run state is deliberately compact (step
count plus a stop glyph); the full reason and condition value are available
from its hover title so narrow action buttons do not wrap.

### Tauri renderer

The Tauri app reuses the web renderer and adds desktop-specific integration.
It injects `SettingsPersistence` backed by `plugin-store`; the browser host uses
the guarded localStorage implementation. Files are selected with the official
dialog plugin and accessed through the scoped fs plugin. The official
`persisted-scope` Rust plugin restores dialog-granted file scopes across desktop
restarts. The single `main` capability deliberately avoids wildcard filesystem
scope and global Tauri APIs; the CSP explicitly permits the application origin,
assets, and WebSocket connections used by simulator transports. The renderer
build must stay aligned with the web package's Lingui/SWC transform setup.
When its locale changes, the renderer invokes `set_menu_locale_handler`, which
rebuilds the native menu from the Rust label table. This table covers every
renderer locale (`en`, `zh`, and `ja`); adding a locale requires updating that
table and its unit test, rather than relying on the renderer's Lingui catalog.

For Save As, the web toolbar provides the selected project extension and file
filter to the native dialog *before* it opens. The dialog-returned final path
is passed unchanged to scoped fs; project saving does not append an extension
after authorization or run a redundant `mkdir` on the selected parent.

### Frontend bundle boundaries

`scripts/vite-chunks.mjs` is the shared Rolldown code-splitting policy for the
browser renderer, Tauri webview, and benchmark app. It assigns external
dependencies before workspace packages so a workspace chunk cannot absorb a
large dependency closure. Stable React/UI/i18n/data, Leafer, and D3 dependencies
are cacheable independently from the core environment, chart, runtime,
scenario, snapshot, asset, utility, parameter, and transport modules. The
snapshot archive worker remains lazy-loaded in its own chunk. All three builds
retain Vite's 500 KiB warning budget for eager code: solve a genuine over-budget
entry point by adjusting boundaries or loading behavior instead of raising the
warning limit.

### Headless agent runtime

`packages/tensnap-agent` hosts the same `RendererSession` and `RunController`
used by the browser for:

- offscreen rendering
- automation
- capture workflows
- agent/session orchestration

Its control API exposes a shared bounded-run resource: `POST /v1/runs`,
`GET /v1/runs`, and `DELETE /v1/runs`. The CLI maps these to `run start`,
`run status`, and `run stop`; it has no compatibility aliases for the retired
wait/experiment or reserved scene-action interfaces.

## Asset and Screenshot Flow

Assets are protocol-level resources keyed by id/hash.

Typical flow:

1. Simulator sends `asset_metadata`.
2. Renderer asks for missing assets with `asset_sync`.
3. Simulator sends `asset_data`.
4. Renderer resolves and caches the asset.

Screenshots flow in the opposite direction:

1. Simulator sends `screenshot_request`.
2. Renderer captures the target view.
3. Renderer replies with `screenshot_response`.

## Documentation Source of Truth

- Current protocol source: `packages/protocol/src/*`
- Generated protocol documentation: run `pnpm --dir packages/protocol export:protocol` to write `packages/protocol/dist/protocol-types.md`, or pass an output path as the first argument
- Current Python API: `docs/api-reference/python-api.md`
- Current Go API: `docs/api-reference/go-api.md`
- Current JavaScript API: `docs/api-reference/js-api.md`
- Current Julia API: `docs/api-reference/julia-api.md`
- Runnable references: `examples/python/`, `examples/python_mesa/`, `examples/go/`, `examples/js/`, `examples/julia/`, and package READMEs

Tutorials 1-4 are backed by runnable examples, while tutorials 5-6 are still planned. When a tutorial and an example diverge, treat the example and API reference as authoritative.
