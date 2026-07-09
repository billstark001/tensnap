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

- protocol v0.2 message types, schemas, and codecs

### `packages/core`

Shared runtime and rendering package.

Owns:

- `Scenario` state model and snapshot logic
- layer registry, dependency graph, and render-plan helpers
- shared environment storages and built-in render layers
- shared runtime pipeline helpers
- project-level `AssetStore`

The protocol package owns wire payloads; core owns renderer-side state and
rendering semantics built on top of those payloads.

## Rendering Contract Ownership

`packages/core` is the single source of truth for rendering semantics across the repository.

The core-owned rendering contract includes:

- layer roles, metadata, dependencies, and storage/controller behavior
- scene-bound discovery and view metadata resolution
- render-plan generation and snapshot render-data collection
- shared environment and chart rendering semantics
- renderer-driven dispatch/apply/render pipeline semantics
- asset, icon, background, and trajectory interpretation rules needed to render a `Scenario`

All other packages must treat this contract as read-only infrastructure.

- `packages/tensnap-web` may own browser lifecycle, React bindings, and browser-only integrations, but must not redefine layer semantics or loop semantics.
- `packages/tensnap-agent` may own headless runtime lifecycle and backend registration, but must not keep a package-local scene model or package-local rendering rules.
- `packages/tensnap-js` may own simulator-side TypeScript sessions, emitters, and transports, but must not redefine renderer-owned layer semantics.
- `packages/benchmark` may own benchmark orchestration and reporting, but must not define an alternative rendering contract and must clearly separate synthetic renderer tests from web-equivalent scenario benchmarks.
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
- desktop file picker / filesystem integration
- renderer build that mirrors the web package's Lingui/SWC pipeline

### `packages/tensnap-agent`

Headless runtime and session tooling.

Owns:

- agent/session runtime
- node-side websocket transport
- offscreen environment painting
- control server endpoints for automation and capture workflows

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

`packages/core` owns the canonical wire contract.

Important message families:

- scenario metadata: `metadata_update`
- sync transaction: `state_sync`, `state_sync_begin`, `state_sync_end`
- environments: `env_create`, `env_delete`
- layers: `env_layer_create`, `env_layer_update`, `env_layer_delete`
- layer-owned entities: `item_create`, `item_update`, `item_delete`
- controls: `param_*`, `action_*`
- charts: `chart_*`
- assets: `asset_meta`, `asset_sync`, `asset_data`, `asset_delete`
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

1. Renderer sends `state_sync` with its current summary.
2. Simulator replies with `state_sync_begin`.
3. Simulator replays `*_create`, `*_update`, and `*_delete` messages.
4. Simulator sends `state_sync_end`.
5. Renderer continues from the resulting `Scenario` state.

### Continuous execution

1. Renderer starts an action with `action_start`.
2. Simulator executes one step.
3. Simulator emits state mutations.
4. Simulator ends the tick with `action_end`.
5. Renderer decides whether to start the next tick.

This keeps loop ownership in the renderer and avoids server-owned hidden timers in the protocol contract.

`action_end` is the action transaction boundary.  A simulator must not send it until all state messages caused by the action have been written to the transport in order.  This applies to reserved actions as well: `step` and one `start` dispatch both advance exactly one tick, while `reset` publishes the rebuilt time-0 state before completing.

## Python Runtime Architecture

The recommended Python surface is:

- `SimulationScenario` for high-level orchestration
- `tensnap.bindings` for decorators and metadata discovery
- `register_model_handler(model_init=None, model_step=None, model_reset=None)` for default lifecycle wiring

Important semantics:

- built-in renderer-driven actions are `start`, `step`, and `reset`
- initial synchronized state is time `0`
- the first simulated tick after `start` or `step` is time `1`
- `start` and `step` both execute one tick; `start` is continuous-capable because the renderer may dispatch it repeatedly after each `action_end`
- `reset` reinitializes the model and broadcasts the resulting time-0 state before its `action_end`
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

### Tauri renderer

The Tauri app reuses the web renderer and adds desktop-specific integration. The renderer build must stay aligned with the web package's Lingui/SWC transform setup.

### Headless agent runtime

`packages/tensnap-agent` uses the same shared core model for:

- offscreen rendering
- automation
- capture workflows
- agent/session orchestration

## Asset and Screenshot Flow

Assets are protocol-level resources keyed by id/hash.

Typical flow:

1. Simulator sends `asset_meta`.
2. Renderer asks for missing assets with `asset_sync`.
3. Simulator sends `asset_data`.
4. Renderer resolves and caches the asset.

Screenshots flow in the opposite direction:

1. Simulator sends `screenshot_request`.
2. Renderer captures the target view.
3. Renderer replies with `screenshot_response`.

## Documentation Source of Truth

- Current protocol: `docs/maintainer-guide/protocol-v0.2.md`
- Historical protocol: `docs/maintainer-guide/protocol-v0.1.md`
- Current Python API: `docs/api-reference/python-api.md`
- Current Go API: `docs/api-reference/go-api.md`
- Current JavaScript API: `docs/api-reference/js-api.md`
- Current Julia API: `docs/api-reference/julia-api.md`
- Runnable references: `examples/python/`, `examples/python_mesa/`, `examples/go/`, `examples/js/`, `examples/julia/`, and package READMEs

Tutorials 1-4 are backed by runnable examples, while tutorials 5-6 are still planned. When a tutorial and an example diverge, treat the example and API reference as authoritative.
