# Changelog

All notable changes to TenSnap will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),  
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Version Format

- All formats should be `MAJOR.MINOR.PATCH`
- **MAJOR** version when you make incompatible API changes.
- **MINOR** version when you add functionality in a backward-compatible manner (unless the major version is `0`).
- **PATCH** version when you make backward-compatible bug fixes.
- All subpackages and publishable subprojects must share the same **MAJOR** version.
- While the shared **MAJOR** version is `0`, all subpackages and publishable subprojects must also share the same **MINOR** version.
- The shared version scope includes npm packages, language bindings, examples packages, benchmark packages, and package metadata.
  - For instance, the Tauri app's internal Rust and app configuration versions must exactly match `@tensnap/tauri`.
- **PATCH** versions may differ between subpackages when a release affects only one package or a narrow package group.

## Changelog Heading Format

- Use `## [MAJOR.MINOR.PATCH] - YYYY-MM-DD` for a release-line entry that updates the shared **MAJOR**, or the shared **MINOR** while **MAJOR** is `0`.
- Use `## package-name [MAJOR.MINOR.PATCH] - YYYY-MM-DD` for package-specific patch releases or package-specific releases after the shared **MAJOR** is stable.
- Prefer exact package names for prefixed entries, such as `## @tensnap/go [0.2.1] - 2026-05-10`, so the changelog remains easy to scan and automate.

---

## @tensnap/web [0.2.4] - 2026-07-12

### Added

- Added a production benchmark host that mounts the real transport store,
  `RendererSession`, Zustand subscriptions, auto-layout, React view tree, and
  the Web chart/environment components for benchmark consumers.

### Fixed

- Made continuous-action buttons leave their visible running state as soon as
  pause is requested, so one click immediately restores the play icon and
  paused indicator while the in-flight tick finishes safely.

## Workspace [0.2.1], @tensnap/protocol [0.2.2] - 2026-07-12

### Added

- Added a shared `RendererSession` and `RunController` for browser and headless
  hosts, with explicit manual/bounded runs, stop expressions, deadlines,
  pause/step/reset semantics, render barriers, action timeouts, and observable
  stop reasons.
- Added shared `SnapshotArchive` persistence: independently decodable
  MessagePack segments, lossless byte compression, worker encoding in the web
  host, and pluggable layer codec implementations.
- Added project format v2 with a content-addressed asset table shared by the
  live scenario and all recordings; older project formats remain readable.
- Added scenario inspection, agent-focused rendering, headless chart painting,
  scene/run HTTP routes, and matching CLI controls for automation workflows.
- Added `ChartScene` and `BrowserChartView`, canvas-backed chart rendering,
  snapshot detail playback/export, continuous-run profiles, live TPS/MSPT
  metrics, and project-scoped undo/redo history.
- Added RendererSession benchmark coverage for real React/Zustand commits,
  recording, long-history conditions, trajectories, checkpoint behavior, and
  reusable p95/TPS regression gates.

### Fixed

- Restored replace-by-default handling for repeated create messages in core,
  preventing model resets from retaining stale agents, edges, trajectories, or
  chart history; internal upsert paths now preserve those states explicitly.
- Kept dependent-layer indexes valid when a source layer is recreated, and
  removed stale chart metadata registrations when a chart group is replaced.
- Stopped maintaining the agent-neighborhood spatial hash while no inspector
  is open, removed item-delta full-scene rebuild triggers, split broad UI
  revisions by domain, and made uniform agent lists derive only their visible
  page. This restores non-recording Web throughput for agent-heavy models.
- Converted render-barrier failures into an observable `render-error` run stop
  instead of leaving an unhandled rejection or stalled pipeline.
- Required action completions to match their dispatched `tick_id`, preventing
  stale or ambiguous completions from contaminating run metrics.
- Fixed multi-chart headless output paths so suffixes apply only to filenames,
  for both relative and absolute destinations.
- Fixed binary filesystem checksums so distinct invalid UTF-8 byte sequences no
  longer collapse to the same decoded-text hash.
- Made Tauri Save As request the final extension/filter in the native dialog
  and write exactly the returned scoped path.
- Made Tauri's native menu follow the renderer language setting, with complete
  English, Chinese, and Japanese menu labels.
- Prevented project tabs from wrapping long filesystem paths; tabs now show a
  compact filename and Project Settings exposes the full path read-only.
- Compacted the settings dialog's system controls into a responsive grid so
  ordinary desktop viewports do not require scrolling.

### Changed

- Made `@tensnap/protocol` the sole source of built-in layer schemas and
  protocol item types; core now keeps only renderer-owned state and helpers.
- Made bounded-run mode explicit and made standard toolbar controls bind only
  to the canonical `start`, `step`, and `reset` action IDs.
- Reworked trajectory storage around explicit active/historical segments and
  lifecycle policies for deletion, state sync, reset, and agent-ID reuse.
- Unified renderer settings, native persistence, scoped file access, runtime
  checkpoint recovery, and localized Tauri menus across web and desktop hosts.
- Updated runtime, snapshot, project, protocol, desktop-adapter, and user
  documentation for shared session control, offline replay, trajectory
  lifecycle behavior, and scoped native saves.
- Split stable UI, rendering, runtime, and data dependencies into shared Vite
  chunks for web, Tauri, and benchmark builds while retaining the 500 KiB
  eager-code warning budget.

### Removed

- Removed the superseded browser `SimulationLoopController`, agent-session and
  reserved-action wrappers, retired wait routes, and the old Leafer-specific
  line-chart view.
- Removed compatibility-only action-role inference, optional bounded-run mode,
  tickless action-metric matching, duplicate core protocol schemas, redundant
  type/path/export aliases, legacy browser polyfills, and vendor-prefixed
  canvas smoothing assignments.
- Removed the unused dummy Rust crate beside the real `src-tauri` application.

## @tensnap/protocol [0.2.1] - 2026-07-10

### Added

- Added protocol-level built-in layer schemas for background, grid, edge, trajectory, and agent layers, including concrete metadata, item, item diff, delete-key, and specialized payload definitions.
- Added `export:protocol`, which writes the generated protocol Markdown to `dist/protocol-types.md` by default or to the first command argument.

### Changed

- Rebuilt protocol payload types so event payload exports are inferred from Zod schemas instead of duplicated in `types.ts`.
- Reworked protocol documentation generation to emit concrete TypeScript definitions from Zod schemas, include package metadata, and include the generated Markdown in every protocol build.

### Fixed

- Restored protocol payload semantics in `schemas.ts`, including the parameter contract that accepted `param_change` values do not trigger `param_sync`, while rejected or canonicalized values do.

## Workspace [0.2.0] - 2026-07-10

### Added

- Added standardized `build`, `test`, `lint`, and `format` script entries across workspace packages where existing tools are available, with explicit no-op commands where no tool is configured.

### Changed

- Updated workspace documentation and Codex skills to point protocol references at the generated `@tensnap/protocol` documentation workflow.
- Upgraded workspace npm dependencies with npm-check-updates while keeping TypeScript on v6.

### Removed

- Removed the stale maintainer-guide `protocol-v0.1.md` and `protocol-v0.2.md` snapshots in favor of generated protocol documentation.

## @tensnap/go [0.2.4] - 2026-07-10

### Added

- Added Go binding support for edge, trajectory, and background layers.
- Added dynamic enum parameter metadata with option and label updates.

### Fixed

- Fixed parameter correction behavior so Go emits `param_sync` only for rejected or canonicalized parameter values.
- Fixed multi-key layer delete payloads so edge deletion uses object keys instead of joined strings.

### Changed

- Reduced allocations in Go item diffing hot paths.

## @tensnap/js [0.2.2] - 2026-07-10

### Added

- Added JavaScript binding helpers for background and trajectory layers.
- Added dynamic enum parameter options and labels.

### Fixed

- Fixed JavaScript binding parameter handling so accepted slider updates no longer trigger definition refreshes that fight the frontend control.

### Changed

- Avoided an extra byte copy when hashing published JavaScript binding assets.

## @tensnap/python [0.2.4] - 2026-07-10

### Fixed

- Fixed Python parameter sync behavior so rejected parameter edits send a correction while accepted edits remain quiet.
- Fixed Python parameter state-sync diffing so enum option and label changes produce `param_update`.

### Changed

- Reduced deepcopy use in Python layer diffing and screenshot response handling.
- Aligned Python package metadata with the Python package release version.

## @tensnap/julia [0.2.1] - 2026-07-10

### Added

- Added Julia background and trajectory layer builders.
- Added `update_parameter!` and repeated-parameter updates that emit `param_update`, enabling enum option updates.

### Fixed

- Fixed Julia runtime parameter changes so accepted edits no longer broadcast `param_sync`.

### Changed

- Avoided copying existing `Vector{UInt8}` payloads during Julia MessagePack encoding.

## @tensnap/protocol [0.2.0] - 2026-07-10

### Added

- Added the standalone `@tensnap/protocol` package as the canonical home for protocol v0.2 schemas, types, codecs, and binary semantic field handling after the protocol split from `@tensnap/core`.

## @tensnap/core, @tensnap/web [0.2.2] - 2026-06-05

### Added

- Added a configurable web action timeout with 1s, 5s, 10s, 30s, and 60s options, defaulting to 5s and reporting timed-out actions via toast.

### Fixed

- Fixed SVG image assets resolving to raw inline SVG strings in browser renderers, which could make deployed web clients request escaped `<svg...` paths instead of loadable image URLs.
- Preserved original asset sources for agent/headless rendering while exposing browser-safe URLs for web rendering.
- Released timed-out in-flight actions so later state updates can still apply and late matching `action_end` events are discarded by the action loop.

## @tensnap/js, @tensnap/agent [0.2.1] - 2026-06-05

### Fixed

- Included `tick_id` in JavaScript binding `action_end` replies so the renderer can distinguish late completions from newer actions with the same id.
- Updated agent asset rendering sources to use preserved raw asset content when available.

## @tensnap/python [0.2.3] - 2026-06-05

### Added

- Added shared Python binding metadata models under `tensnap.models` for actions and charts, with compatibility re-exports from `tensnap.bindings.basic`.
- Added property-style chart composition with id inference, including grouped chart series declared through `ChartProperty.group(...)`.
- Added framework-neutral lifecycle and reinitialization helpers in `tensnap.bindings.lifecycle`, while keeping the Mesa reinitializer surface as a compatibility wrapper.
- Added `typing.Annotated` constructor/dataclass parameter binding discovery and dynamic callable metadata support for parameter descriptors.

### Changed

- Updated default `SimulationScenario.add_all(...)` parameter discovery to use explicit-only parameter collection, reducing accidental exposure of ordinary public attributes.
- Strengthened parameter descriptor typing so property-like parameter decorators type-check cleanly with Pyright.

## @tensnap/go [0.2.3] - 2026-06-05

### Added

- Added grouped chart builders for the Go binding, including `ChartSeries`, `NewChartSeries`, `NewChartSeriesFunc`, and `NewChartGroup`.
- Added grouped chart update emission so `Model.PushCharts(...)` can publish one update per series while preserving existing single-chart behavior.
- Documented Go grouped chart registration in the Go API reference.

### Changed

- Bumped `@tensnap/go` package metadata to `0.2.3`.
- Optimized Go layer diff/projector handling for binding layers and environment state replay.

## @tensnap/julia [0.2.0] - 2026-05-31

### Added

- Added the native `TenSnap.jl` package under `packages/tensnap-julia`, with `Project.toml` metadata, Julia 1.9 compatibility, and JSON/MessagePack WebSocket protocol support.
- Added `Scenario` lifecycle support with built-in renderer-driven `start`, `step`, and `reset` actions, model registration callbacks, time metadata, chart updates, and state-sync replay.
- Added explicit Julia builders for parameters, actions, charts, environments, agent/grid/patch/edge layers, and Agents.jl-compatible projectors without taking an Agents.jl dependency.
- Added environment/layer create/delete helpers, ordered layer replay, manual item create/update/delete helpers, automatic incremental layer item diffing, and layer metadata diffing.
- Added asset metadata/data/delete helpers, renderer `asset_sync` handling, screenshot request/response plumbing, and simulator log emission.
- Added native Julia package tests for projectors, lifecycle behavior, codecs, layer diffs, CRD helpers, assets, and example-independent package loading.
- Added repository scripts for Julia package tests and Julia release tagging through `packages/tensnap-julia/v*` tags.

## @tensnap/python [0.2.2] - 2026-05-31

### Added

- Added dry-run registration across `SimulationScenario.add_all(...)`, `add_environment_binding(...)`, `add_environment(...)`, `add_layer_binding(...)`, `add_bound_layers(...)`, `add_parameters(...)`, `add_actions(...)`, and `add_charts(...)`.
- Added `BindParametersConfig.EXCLUDE_ALL` and the `__tensnap_parameter_metadata__(...)` provider hook for parameter sources that should not expose ordinary object attributes.
- Added `tensnap.bindings.mesa.model_reinit` with `BoundModelReinitializer`, `bind_kwargs(...)`, constructor-kwarg binding discovery, cleanup hooks, and reusable registered-model reinitialization helpers.
- Exported Mesa reinitialization helpers from `tensnap.bindings.mesa`.

### Changed

- Made `SimulationScenario.add_all(...)` the ordinary combined registration path for environment/layer, parameter, action, and chart bindings, while defaulting undecorated targets to `BindParametersConfig.EXCLUDE_ALL` so incidental public attributes are not exposed as parameters.
- Updated Mesa registration to rebuild whole model registrations through registry-change dictionaries instead of replaying only parameter/chart subsets.
- Refactored `MesaSimulationHandler` to use `BoundModelReinitializer`, accept kwarg bindings, and remain available as a compatibility wrapper while explicit `BoundModelReinitializer` usage is preferred.
- Refactored field discovery of decorators under `tensnap.bindings` to provide more natural object declaration experience.
- Updated Python API docs, tutorials, and package README text for `add_all(...)`, opt-in parameters, dry-run registration, and the Mesa reinitializer workflow.

### Removed

- Removed the older `tensnap.bindings.mesa.helper` module and the previous `tensnap.utils.model_reinit` helper in favor of `tensnap.bindings.mesa.model_reinit`.

### Fixed

- Fixed Mesa constructor-parameter registration so `bind_kwargs(...)` fields such as `width` and `height` remain available after model reinitialization.
- Fixed constructor/model parameter conflicts so model-owned parameters stay registered while non-conflicting constructor kwargs are added by `BoundModelReinitializer`.
- Fixed Mesa reinitialization cleanup by removing Mesa's instance-level `step` wrapper before rerunning `__init__`.
- Removed stray debug printing from Mesa class-detection helpers.

## @tensnap/python [0.2.1] - 2026-05-25

### Fixed

- Fixed Python action completion ordering so queued state updates are flushed before `action_end`.
- Fixed Mesa reset handling so lifecycle fields such as `time`, `steps`, and `running` are not replayed as runtime parameters.
- Serialized Python action execution to prevent concurrent action handlers from interleaving simulator state mutations.

## @tensnap/go [0.2.2] - 2026-05-24

### Changed

- Optimized the Go Schelling example and visualization binding patterns, including tag-based projector improvements.
- Refactored Go action handling to use the new `BindingActionRouter`, providing a cleaner structure for simulator-side logic.

## @tensnap/core, @tensnap/web [0.2.1] - 2026-05-24

### Added

- Added serialization tests for `TrajectoryStorage` and enhanced the project store with snapshot handling.
- Introduced `Scheduler` interfaces (`TimeoutScheduler`, `RafScheduler`) for more flexible task scheduling in the simulation loop.
- Enhanced `LayerRegistry` with support for custom layer creation and third-party layer roles.
- Added browser-specific runtime and scenario controllers for better environment isolation.
- Enhanced edit views with new dialogs (ConfirmEdit, EditObjectId), improved metadata handling, and better state management.
- Improved `EnvironmentView` with customizable Leafer creation and shared viewport utilities.

### Changed

- Refactored the simulation loop to utilize the new scheduling and metrics tracking (`DispatchMetrics`), providing real-time TPS and MSPT telemetry.
- Updated all examples to use the new declarative definition patterns and unified synchronization methods.
- Optimized benchmark suite with regression tests for web-scenario cases and improved variation handling.

### Fixed

- Fixed view resizing and folding behavior in the web client.
- Improved context menu click position handling and enhanced guideline reference views.
- Refactored view mutation utilities and improved layout calculation accuracy.
- Fixed mushroom example visualization bug in `python_mesa`.
- Resolved multiple bugs in web models and session creation logic.

## @tensnap/go [0.2.1] - 2026-05-10

### Added

- Added composable Go binding builders for declarative parameters, environments, agent/grid layers, charts, and lifecycle handling.
- Added scoped `tensnap` tag support for parameter binding, item projectors, and layer metadata projectors with precompiled reflection accessors.

### Changed

- Updated the Go Schelling example to use the new declarative binding layer and tag-based projectors, reducing visualization boilerplate while preserving imperative model logic.
- Documented the Go `abm` versus `binding` package boundary and the new tag-based binding workflow.

## [0.2.0] - 2026-05-03

### Added

- Added the new `@tensnap/core` package as the shared home for protocol v0.2 types/codecs, Scenario state, runtime pipeline, layer registry, rendering primitives, and project-level `AssetStore`.
- Added protocol v0.2 environment/layer/item synchronization, including canonical `item_*` messages, renderer-driven action lifecycle, asset synchronization, screenshot exchange, and explicit state sync boundaries.
- Added the new `@tensnap/agent` package for headless rendering, runtime orchestration, and agent/session tooling.
- Added the new `@tensnap/go` bindings publishing via `packages/tensnap-go/v*` tags.
- Added the new `@tensnap/js` bindings.
- Added corresponding release tooling and deployment guide updates.
- Added dedicated trajectory storage/layer support, asset-aware rendering flows, and benchmark/runtime coverage for the new pipeline.

### Changed

- Renamed the old `tensnap-web-core` package to `core` and reorganized the workspace package boundaries around `core`, `web`, `web-common`, `web-adapter`, `tauri`, `benchmark`, and `tensnap-agent`.
- Aligned the Python bindings with protocol v0.2: `SimulationScenario` is now the primary high-level runtime, `SimulationLoop` is folded into it, and the recommended binding surface lives under `tensnap.bindings`.
- Reworked environment state around canonical `uniform`/`2d` environments plus explicit layers, including dependency-aware layer controllers and normalized item synchronization.
- Updated the web and Tauri clients to share the same protocol/runtime model, asset handling, screenshot flow, and Lingui build pipeline.

### Removed

- Removed the standalone `tensnap-web-core` and `tensnap-web-utils` package layout in favor of the new package split.
- Removed the old v0.1-first protocol assumptions from the active runtime path, including time-step/button-click centric synchronization as the primary model.

### Fixed

- Fixed multiple live rendering and synchronization defects, including reconnect/state-sync edge cases, structural layer rerender gaps, trajectory rendering behavior, and transport/runtime control flow issues.
- Fixed Python runtime and example drift around reset/init semantics, layered environment snapshots, and incremental layer/item updates.
- Fixed Tauri/web build alignment issues, IndexedDB recovery behavior, and several chart/environment rendering regressions.

## [0.1.2] - 2026-02-21

### Added

- Added a new package `tensnap-web-core` providing:
  - High-performance chart rendering using Leafer-UI
  - Layer-based & flexible Grid & graph renderers
  - Type-safe data models
  - Utility functions for data processing
- This allows for:
  - Independent testing and benchmarking of core functionality
  - Reuse in different frameworks or Node.js environments
  - Clear separation between UI and project management logic
- Added a standardized benchmark suite for the renderers in the `tensnap-web-core` package.
- Added a new feature to allow one to drag or zoom on an environment.
- Optimized the performance of the example Schelling Segregation Model.

### Removed

- The old `InstantiatedChartStorage`, `GridVisualizer`, `GraphVisualizer` etc. are removed.

### Security

- Update all `npm` and Tauri dependencies to newest versions.
- There is a known bug that graph environments blink during evolution. This is a defect caused by the very design of the protocol and is anticipated to be fixed during the next release.

---

## [0.1.1] - 2025-11-15

### Changed

- Moved the Python examples from `tensnap-python` package to `/examples/python` and `/examples/python_mesa` folders.

---

## [0.1.0] - 2025-11-10

Initial release.

---

## Changelog Template

### Added

- Lorem ipsum

### Changed

- Lorem ipsum

### Deprecated

- Lorem ipsum

### Removed

- Lorem ipsum

### Fixed

- Lorem ipsum

### Security

- Lorem ipsum
