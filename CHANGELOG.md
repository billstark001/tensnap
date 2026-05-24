# Changelog

All notable changes to TenSnap will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),  
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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

---

## Changelog Heading Format

- Use `## [MAJOR.MINOR.PATCH] - YYYY-MM-DD` for a release-line entry that updates the shared **MAJOR**, or the shared **MINOR** while **MAJOR** is `0`.
- Use `## package-name [MAJOR.MINOR.PATCH] - YYYY-MM-DD` for package-specific patch releases or package-specific releases after the shared **MAJOR** is stable.
- Prefer exact package names for prefixed entries, such as `## @tensnap/go [0.2.1] - 2026-05-10`, so the changelog remains easy to scan and automate.

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
