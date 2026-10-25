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
- Keep the dated package version table in `docs/maintainer-guide/versioning.md` aligned with release entries.

---

## @tensnap/tauri [0.3.10] - 2026-10-26

### Changed

- Prepare new macOS arm64/x64, Linux, and Windows desktop artifacts from the binding compatibility and LLM example release checkout, preserving the published 0.3.9 assets.

## tensnap [0.3.5] - 2026-10-25

### Fixed

- Run repository Python lint/format with an explicit Python 3.10 target, preserving compatible exception handling in the conformance runner when Ruff's inferred/default target is newer.

## @tensnap/python [0.3.7] - 2026-10-25

### Added

- Add opt-in `edge(data=...)` and `trajectory_item(data=...)` selectors/callbacks through the common item projector, with safe nested snapshots. Omitted data retains the previous projection behavior; the wire protocol remains 0.3.

### Fixed

- Preserve application fields, including `data`, in `(source, target, attrs)` edge tuples/lists through the common record path, matching dictionary edge records while keeping tuple endpoints authoritative.
- Detect an incompatible installed binding before importing either LLM example view. Report its version, import path, and an installation command using the serving interpreter, plus the source-checkout option. Keep headless rule runs independent of the binding.
- Stage Python wheel builds from a clean temporary source tree so stale local setuptools files cannot enter the artifact; preserve existing local build outputs.

### Changed

- Document the minimum Python binding version and distinguish edge item data from layer metadata across all four language APIs. Cover edge data and nested updates across Python, Go, Julia, and JS, and verify examples against a built Python wheel.

## @tensnap/js [0.3.6] - 2026-10-25

### Added

- Share declarative `fields` compilation across agent, edge, trajectory, and custom item layers. Keep type-specific metadata and source adapters separate from the common projection, copy, diff, and restore pipeline.

### Fixed

- Allow `color`, `icon`, and `size` shortcuts without a `fields` mapping on agent, map-agent, and matrix-agent builders. Standalone agent shortcuts preserve the source record's identity and data. Preserve duplicate-field and custom-projector conflict checks.

## @tensnap/go [0.3.4] - 2026-10-25

### Changed

- Share item projection, ownership, incremental/full keyed diffs, replay seeding, reset, and restore readback between agent, edge, and trajectory layers. Map/matrix adapters reuse that pipeline through agent layers. Keep the existing agent reset delete/recreate policy and per-layer keys/metadata.

### Added

- Expose `Select` and `Const` on edge and trajectory builders using the same field resolver as agent layers.

## @tensnap/agent [0.3.10] - 2026-10-25

### Changed

- Refresh the bundled offline binding APIs and skills with language-specific item-data declarations, Python 0.3.7 requirements, and installed-binding diagnostics. CLI runtime behavior is unchanged; the CLI does not install or upgrade native bindings.

## @tensnap/python [0.3.6] - 2026-10-23

### Fixed

- Read constructor declarations from the original unwrapped callable. Preserve explicit annotations through decorators whose wrappers omit annotation metadata, including Python 3.14's `functools.wraps` behavior for directly assigned annotations. Apply the same declaration source to constructor controls, model discovery and scenario registration.

### Changed

- Run the Python 3.10–3.14 regression matrix before merging, in addition to publication checks.

## @tensnap/python [0.3.5] - 2026-10-23

Publication stopped during Python 3.14 validation before any upload. The changes below ship in 0.3.6; the failed-attempt tag remains unchanged.

### Fixed

- Resolve one parameter per source field before inference, preserving custom enums, class/constructor declaration priority, explicit private-name policies and current instance values. Reject ambiguous declarations and duplicate public IDs before registering a parameter batch ([#38](https://github.com/billstark001/tensnap/issues/38)).
- Preserve getter/setter identity and copy only mutable parameter metadata. Serialization never traverses callback owners; omitted accessors are retained and explicit `None` clears them ([#41](https://github.com/billstark001/tensnap/issues/41)).
- Exclude chart/monitor members from automatic controls before evaluating getters, skip inferred read-only properties and reject explicit controls without writable accessors. Discover inherited observers and actions once ([#42](https://github.com/billstark001/tensnap/issues/42)).
- Use the same parameter-selection rules for lifecycle planning and explicit registration, preserving model-owned accessors and staged constructor values across reset and restore.

### Changed

- Separate parameter declarations, metadata resolution and source discovery behind the public binding API. Replace example workarounds with single declarations, native property setters and explicit initialization controls; retain Sugarscape enum choices and Schelling's `similarityThreshold` ID.
- Cover real Python/Mesa, LLM and DQN examples with parameter inventory and reset regression tests. Remove whole-file Ruff exclusions and check library source, runtime tests, benchmarks and Python examples for lint and formatting.
- Align the API reference, user/developer guides and example documentation with parameter precedence, copying, write access and constructor ownership.

## @tensnap/agent [0.3.9] - 2026-10-23

### Changed

- Bundle the updated Python parameter-binding contract, ownership guide and binding skill with the offline CLI documentation.

## @tensnap/tauri [0.3.9] - 2026-10-23

### Changed

- Prepare a new full-platform desktop release from the Python binding and repository cleanup release checkout, including the Windows executable and platform installers.

## @tensnap/benchmark [0.3.8] - 2026-10-23

### Changed

- Clean lint findings in Python archive helpers and Schelling adapters, and format Julia benchmark adapters. Refresh current Julia environment fingerprints after the binding version bump. Scientific workloads, metrics, active profile versions and retained evidence are unchanged.

## @tensnap/julia [0.3.4] - 2026-10-23

### Changed

- Apply the package's two-space Julia formatting to tests and benchmarks, and include them in package lint/format commands. Model and protocol behavior are unchanged.

## @tensnap/examples-julia [0.3.4] - 2026-10-23

### Changed

- Format Julia example sources and tests consistently and replace placeholder lint/format commands with JuliaFormatter checks.

## tensnap [0.3.4] - 2026-10-23

### Fixed

- Run conformance subprocess checks without blocking the async runner and bind each fingerprint canary's source path independently. Clean repository Python/Julia formatting findings, add root language-specific lint/format commands and document the expanded checks.

## @tensnap/web [0.3.10] - 2026-10-23

### Added

- Bind scene views to existing simulator objects while keeping view identities and simulator declarations read-only. Edit environment layer preferences, chart series labels/colors and monitor display hints locally, with explicit inheritance/reset controls and color pickers.
- Select chart-history restoration independently of checkpoint/projected model restoration. Apply parameter edits through the live session with validation and conflict checks.

### Fixed

- Keep chart history intact when editing displayed series. Reset live and replay viewports from the context menu after Copy; restrict node dragging to enabled force layouts.
- Align selects, switches, status/tab spacing and native scroll viewports. Keep dialog buttons outside scrolling and anchored at the bottom, including replay windows; Escape closes a select before its dialog.

## @tensnap/tauri [0.3.8] - 2026-10-23

### Fixed

- Hide the duplicate native menu bar on Windows, including after locale changes and in auxiliary windows, while retaining accelerators and the HTML menu. Other platforms retain their menu behavior.
- Bundle the updated Web/shared UI and upload the plain Windows executable alongside installers through the existing release action. The executable still requires WebView2.

## @tensnap/agent [0.3.8] - 2026-10-23

### Added

- Add context-local `scene presentation <env-id>` preferences and matching control endpoints, with per-render `--layer-overrides` and bounded `--layout-ticks` options.

### Changed

- Preserve stored coordinates for fixed-frame exports by default; explicit positive layout budgets opt into relayout. Live renders use deterministic initial placement without extra force iterations unless requested. Rendering operates on detached scenes.
- Bundle the shared frontend presentation/restore contract with offline CLI documentation.

## @tensnap/core [0.3.8] - 2026-10-23

### Added

- Share validated renderer-local presentation overrides and saved view preferences across hosts without new protocol fields.

### Fixed

- Disable all forces and initial scattering for finite negative `link_distance`; preserve zero target lengths and persistent pins. Coordinate one force writer per shared agent storage and convert exclusive node gestures through scene scale and orientation without duplicate handlers after icon changes.
- Commit chart-history policies and fresh monitor observations only after successful online restore. Record renderer-local restore effects with existing messages so forward playback and keyframe seeks agree.

### Changed

- Reduce stop/capture/archive encoding copies and RLE allocation for the first part of [issue #36](https://github.com/billstark001/tensnap/issues/36). Public detached ownership and recording formats remain intact; full archive retention and incremental recording storage are separate work.

## @tensnap/web-adapter [0.3.6] - 2026-10-23

### Fixed

- Keep file dialogs and directory lists scrollable with native CSS scrollbars when content windows are resized.

## @tensnap/web-common [0.3.5] - 2026-10-23

### Added

- Unify theme, parameter and scene-editor switches around the original Settings appearance. Share native color pickers and themed select spacing, preserve caller styling, and add native scroll viewports with thin CSS scrollbars for dialogs, inspectors, content panels, menus and tab strips. Migrate application-owned CSS and inline animation rules to vanilla-extract; retain WinBox's dependency-owned stylesheet.

## @tensnap/core [0.3.7] - 2026-10-21

### Added

- Expose `@tensnap/core/scenario/query-schema` for query validation without loading scenario or rendering implementations; existing scenario exports remain compatible.

### Changed

- Reduce rolling recording overhead with constant-time frame counts and a bounded GC reference cache. Preserve object integrity checks, pinned readers, retention rules and the storage format.

## @tensnap/python [0.3.4] - 2026-10-21

### Changed

- Consolidate constructor-driven lifecycle and declarations under `await scenario.register_model(...)`, replacing the former registration/configuration and lifecycle entry points without aliases. Add `scenario.reset()` and `set_time_step()`; constructor-only controls default to initialization-only metadata.
- Keep optional seeds and RNGs model-owned. Preserve constructor overlays, rollback isolation and restored clocks across reset and checkpoint replay; make failed registration retryable and support async lifecycle callbacks.
- Replace mypy with pinned Pyright for library-wide checks and public API typing contracts; correct annotations and decorator exports. Retain Ruff and Python 3.10 compatibility checks.

### Fixed

- Expose `tensnap.bindings.mesa.prepare_mesa_model_reinit` for constructor-based reconstruction. Centralize step-wrapper cleanup and the Mesa 3.0-3.4 agent ID workaround; ID cleanup is a no-op for Mesa 3.5's model-owned allocator. Use the utility in default lifecycle cleanup and Schelling checkpoint restore, keeping compatibility internals out of example models.
- Share native cell-space imports and clock/scheduler compatibility through Mesa utils, including the Mesa 3.0/3.1 namespace fallback and Mesa 3.5 event rebasing. Reuse reconstruction cleanup in Game of Life and remove duplicate cleanup from the deprecated handler; document applicable versions and no-op behavior.

## @tensnap/examples-js [0.3.5] - 2026-10-21

### Changed

- Scope RNGs, reset seeds and Schelling observers to each session; remove obsolete model-owned browser timers and parameter APIs. Separate measurement/audit adapters and distinguish satisfaction, jamming and step limits.
- Use Schelling checkpoint schema 3 to retain the next-reset seed alongside continuation state. Historical schema-2 artifacts remain unchanged.

## @tensnap/examples-julia [0.3.3] - 2026-10-21

### Changed

- Separate Schelling measurement/audit adapters, distinguish scientific stop outcomes and adopt checkpoint schema 3 while retaining historical artifacts. Clarify the adaptive bar model variant; run launchers without personal startup files.

### Fixed

- Synchronize Agents.jl's native clock with restored protocol time, and preserve initialization seeds and model RNG state across reset and checkpoint replay.

## @tensnap/network [0.3.1] - 2026-10-21

### Fixed

- Retry dual-stack ephemeral-port collisions after closing partial listeners; keep explicit-port conflicts fatal.

## @tensnap/js [0.3.5] - 2026-10-21

### Added

- Expose the WebSocket host's effective validation levels for each message direction as read-only properties.

### Fixed

- Use `@tensnap/network` 0.3.1 for the ephemeral-port collision fix.

## @tensnap/agent [0.3.7] - 2026-10-21

### Changed

- Reduce online command startup overhead through a shared lazy-loading orchestrator, loading daemon, recording and rendering implementations only when needed.
- Bundle the binding skill's updated Python lifecycle and reproducibility documentation.

### Fixed

- Use `@tensnap/network` 0.3.1 for dual-stack ephemeral-port retries and `@tensnap/core` 0.3.7 for lightweight query schemas and rolling recording optimizations, including external library dependencies.
- Accept `{id, value}[]` parameter overlays in CLI and HTTP scene restoration; reject object maps before simulator dispatch.
- Fix the bundled reproducibility guide's checkout-only workflow link and reject missing local skill references during builds.
- Exclude Finder metadata from bundled skill integrity manifests so npm packing cannot invalidate builds from a local checkout.

## @tensnap/web [0.3.9] - 2026-10-21

### Fixed

- Preserve explicit benchmark validation policies through initialization, settings changes and reconnect, and report the active transport's effective policy. Interactive hosts retain global settings.

## @tensnap/benchmark [0.3.7] - 2026-10-21

### Added

- Add Agent CLI profiles for Schelling control cost, bounded queries and long-history collection, with root evaluation integration, smoke cases, offline artifact verification and reports.
- Add opt-in correlated timing probes and `diagnose:timeout` for browser and Python workloads, preserving diagnostic traces on failure.
- Report mean intervals and cycles per second in Markdown/CSV while retaining historical report verification.

### Changed

- Move Schelling timing and audit adapters into versioned subjects; distinguish satisfaction, jamming and step limits. Current checkpoints use schema 3; historical definitions, schemas and exports remain unchanged.
- Correct repository examples' HK contacts, Sugarscape coordinates, toroidal flocking/foraging and RNG isolation. Preserve Mesa reset settings and reuse same-state Schelling neighbor counts; extend four-language seed, reset and continuation audits.

### Fixed

- Pass explicit CLI wait timeouts for long-running cases instead of inheriting the default 30-second wait.
- Verify actual frontend validation policies, diagnostic correlations and raw-byte artifact hashes; document historical frontend-policy mismatches.
- Handle external server spawn failures, signal exits and repeated cleanup safely.
- Restore Mesa Schelling's uncached kernel path while preserving same-state UI statistics reuse and invalidation across model updates, reset and restore.

## @tensnap/tauri [0.3.7] - 2026-10-21

### Fixed

- Refresh the embedded Web/shared UI with corrected menu placement, remembered dialog geometry and export themes.

## @tensnap/web [0.3.8] - 2026-10-20

### Added

- Open file picker actions from either the ellipsis button or a right-click. Download individual files with their original bytes, MIME type and filename; move files and directories through a folder browser and rename them in place.

### Fixed

- Keep shared menus beside their trigger or pointer, outside dialog clipping and within the viewport, including keyboard navigation in modal dialogs.
- Restore remembered dialog geometry before the first visible frame without animating from the default position.
- Use theme-aware export options in dark mode.

## @tensnap/web-common [0.3.4] - 2026-10-20

### Added

- Shared dropdown context triggers and a filesystem move contract with an unsupported-operation default for hosts using native file UI.

### Fixed

- Mount menus at the document root, track their owning modal focus boundary, constrain their viewport bounds and close them when their owner scrolls or closes.
- Wait for stored window placement before showing and focusing WinBox dialogs. Do not overwrite saved placement when a window closes before storage finishes loading.

## @tensnap/web-adapter [0.3.5] - 2026-10-20

### Added

- File picker download, move and rename actions with shared right-click/ellipsis access and English, Chinese and Japanese labels.
- Memory and IndexedDB filesystem moves preserve content and metadata, support directory trees, and reject collisions, missing destinations and moves into a directory's own descendants.

### Fixed

- Await directory refreshes after file operations, clear stale picker selections after reloads, and apply the active theme to export option buttons.

## @tensnap/web [0.3.7] - 2026-10-20

### Added

- Movable/resizable WinBox dialogs, keyboard-accessible split panels and menus, per-window placement memory and a settings reset action. Keep drafts and project ownership across tab switches.
- Workbench file drops open JSON/MessagePack projects and recordings; Snapshots drops import complete timelines into the captured project with per-file undo and isolated errors.

### Changed

- Keep editing, confirmation, settings and replay in the owning Webview with real providers and callbacks. Use direct React portals and Activity for retained hidden panels.
- Route desktop read-only Agent Details and Simulator Info through explicit versioned projections and command schemas. Remove generic callback/store proxies and synthetic content lifecycles.
- Improve replay navigation, value-inspector formatting, compact status controls and system-browser documentation access.

### Fixed

- Bind rendered/native Save and Settings to an explicit originating project; capture save format before awaited pickers and stop commands when their owner closes.
- Unify project/playback disposal across closure, source replacement and initialization failure; retain the old source and restore its scene after failed candidate initialization. Reuse acknowledged inspection image resources; apply metadata/MIME changes and suppress unchanged cloned information packets.
- Preserve replay cursor and release rendering assets across refresh, StrictMode and closure. Subscribe recording selectors to their actual owner.
- Poll bounded agent views with cancellation, deadlines and backoff; acknowledge revisions only after successful load and revoke receiver Blob URLs on teardown. Avoid full-scene information packets and unnecessary spatial indexes.

## @tensnap/tauri [0.3.6] - 2026-10-20

### Added

- Native read-only inspector/information windows with main-owned state, validated request/response protocols, monotonic projections, bounded pending requests and coalesced publication.
- Native file drops, persisted dialog-granted file scopes, localized menus, system-browser documentation access and shared window geometry policy.

### Changed

- Separate main and auxiliary capabilities; initialize filesystem, persistence and simulator services only in the main Webview. Release listeners, operations and windows with their owner.
- Share main-only project menu command handlers, including original-project Settings and Save ownership, and remove unimplemented zoom/grid/shortcut items. Retain overlay titlebar/fullscreen behavior.

## @tensnap/core [0.3.6] - 2026-10-20

### Added

- Export `createAgentInspectionView` and `AgentInspectionView` from `core/scenario` for owned viewport/ego-graph projections and acknowledged referenced assets without a full model dump.
- Accept MessagePack state recordings in version-1 frame evidence manifests.

### Fixed

- Normalize optional undefined properties before archive segment encoding so valid recordings round-trip in both file formats.
- Add idempotent playback closure with scene URL release, cancelled reads and joined reader/backend cleanup; cancel stale Step index lookups when a newer selection starts. Preserve asset bytes across realms when dumping scenes; offer explicit resource reuse for scene replacement.
- Finalize manual recordings on transport retirement/loss and expose an action-settlement boundary for graceful host shutdown. Notify owned tools when simulator identity is reset.
- Normalize known asset, screenshot and checkpoint binary fields across JSON/MessagePack extraction and hydration; deduplicate equivalent binary representations without interpreting user strings.

## @tensnap/agent [0.3.6] - 2026-10-20

### Added

- `--recording-format json|msgpack` for run/manual recordings, recording exports and frame evidence, with matching HTTP `recordingFormat` options. JSON remains the default independently of image format and wire encoding.

### Fixed

- Restore recording ID admission at startup without decoding historical payloads; atomically publish complete ID directories to prevent duplicate/cross-format/concurrent overwrites, while retaining legacy file discovery.
- Own persistence format with recording status, share manual/run pending-write admission, and finalize/drain active recordings during disconnect/shutdown even when checkpoint cleanup fails.
- Discover both recording encodings in catalogs and restore/compare evidence through its declared state path, including mixed encodings. Extend public CLI acceptance coverage and bundled offline references.

## @tensnap/web-common [0.3.3] - 2026-10-19

### Changed

- Replace dialog/menu geometry with shared DOM controllers and WinBox, direct portal rendering, focus handling, project scopes and per-type placement persistence.
- Move settings persistence to `@tensnap/web-common/settings-persistence`; remove the former web-adapter subpath and unused content-registry/mount facades. Host setup and imports are documented in the workbench guide.

## @tensnap/web-adapter [0.3.4] - 2026-10-19

### Changed

- Use the shared dialog host for filesystem UI, preserve actual HTML/menu handlers and mark the picker upload area as its own drop destination.
- Import shared settings persistence from web-common and remove the obsolete adapter export.

## @tensnap/benchmark [0.3.6] - 2026-10-19

### Changed

- Refresh maintained JS profile package/lock fingerprints in place, retaining v2 scientific workload definitions. Document that fingerprint-only updates do not require a new profile version; preserve all archived evidence.
- Use static type namespace imports in mocked module annotations.

## @tensnap/js [0.3.4] - 2026-10-19

### Changed

- Mark type-only runtime imports explicitly; runtime behavior and protocol remain unchanged.

## @tensnap/examples-js [0.3.4] - 2026-10-19

### Changed

- Mark model/renderer type-only imports explicitly; scientific model behavior remains unchanged.

## tensnap [0.3.3] - 2026-10-19

### Changed

- Enforce Oxlint `typescript/consistent-type-imports` globally, including tests: forbid type-position `import()` expressions while retaining runtime dynamic imports.
- Align maintained guides, API/ownership contracts, release metadata and offline skill references with the workbench and recording changes. Wire protocol remains 0.3.

## @tensnap/benchmark [0.3.5] - 2026-10-18

### Changed

- Use explicit type imports for Playwright page annotations and refresh maintained profile fingerprints after dependency lock changes. Historical measurement exports retain their original hashes.

## @tensnap/core [0.3.5] - 2026-10-18

### Added

- Portable project/recording codecs and migrations, owned frame/checkpoint capture, durable provenance, explicit frame/model-time selection and independent model/history restore.
- Bounded typed queries, monitor history and structured diffs with default identity/exact item strategies, per-layer overrides, custom item collections, field selection and numeric tolerances. Report `sceneEqual`, selected equality and checkpoint equality separately.
- Incremental recording stores with atomic roots, indexed frame/time/request and stream selection, content-addressed assets, bounded queues/caches, pinned readers, recovery/index rebuild, streamed range export and asynchronous playback.
- Action-boundary collection with error/expression/value-change triggers, cooldown/deduplication, honest pre/post windows and scheduled checkpoints for full-history or rolling retention.

### Changed

- Move layout DTOs and project serialization from Web into `core/persistence`; remove obsolete internal modules while retaining released formats and APIs. Wire protocol remains 0.3.

### Fixed

- Send only checkpoint encoding/data on strict restore; verify checkpoint/source alignment and discard checkpoints outside retained boundaries. Roll back bounded-retention frames, keyframes and accounting together.
- Own asynchronous frame/options/resource inputs, preserve cancellation and reject conflicting capture/restore/sync controls before changing run state.
- Avoid whole-recording copies, repeated scene decoding and unchanged chart/log prefix scans. Verify stream chains, enforce encoded storage budgets, protect pinned generations during GC and release rolling checkpoint budgets on eviction.
- Keep item diff traversal linear and output copying limited to the requested page. Preserve typed identities, sparse-array distinctions and parent-subtree selection; reject duplicate keys and prevent numeric-tolerance overflow.

## @tensnap/agent [0.3.5] - 2026-10-18

### Added

- By-ID action/run waits through host settlement and recording persistence, with retained outcomes and classified failures.
- Recording catalog/export and daemon-free selection, inspection, rendering and fixed-frame evidence with checkpoint restore, provenance and independent scene/checkpoint comparison.
- Typed agent/monitor commands, historical queries and diffs, collection configuration, offline recovery, range export and batch rendering.
- SQLite recording stores with separate immutable/derived databases, exclusive writer leases, generation pins and committed-prefix recovery. Bundle matching offline skills and storage/runtime guidance.

### Fixed

- Preserve structured request/run IDs on wait timeout or transport failure so callers can resume waiting without repeating actions. Report early daemon exits, bounded stderr diagnostics and startup cleanup errors while retaining the original cause.
- Preserve partial evidence, original/cleanup errors and foreign files during failed rendering or atomic publication; distinguish rendering and persistence failures.
- Own asynchronous inputs/results, avoid unused recording/message copies and guard collection admission against concurrent mutation. Include collection closure in persisted waits while preserving model outcomes and partial windows.
- Close failed offline readers, preserve source provenance, reclaim dead writer leases atomically and distinguish live writers, superseded generations and unknown interrupted tails.

## @tensnap/web [0.3.6] - 2026-10-18

### Added

- Open self-contained recordings from an empty app or select one from an external project without connecting its source; generate playback layout and retain the full timeline.
- Separate full-recording/current-frame exports, durable frame provenance and English/Chinese/Japanese messages.

### Fixed

- Recognize uploaded JSON carried as bytes by file adapters, preserve chart prefixes and avoid reusing checkpoints after timeline rebasing.
- Open owner-scoped IndexedDB store links with asynchronous per-tab playback and bounded active history; abort superseded/paused reads, release reader pins on close/source replacement, and clear stale store save links.

## @tensnap/web-adapter [0.3.3] - 2026-10-18

### Added

- IndexedDB recording storage with transactional roots and index replacement, bounded keyset pages, owner isolation, Web Locks writer leases and generation pins.

## @tensnap/tauri [0.3.5] - 2026-10-18

### Added

- Native localized Open recording menu wired to the shared browser/desktop recording workflow, using existing file permissions.

## @tensnap/core [0.3.4] - 2026-10-18

### Fixed

- Count dispatched, completed, successful and failed target actions separately; preserve simultaneous stop reasons and failure priority. Duplicate or mismatched results do not count, and unchanged model time can still succeed.
- Settle runs only after final host barriers and stop lifecycle results, retain summaries and waits by run ID, close recording at settlement, and label lifecycle frames. Keep target and lifecycle outcomes separate; mark unknown state on disconnect/timeouts without inventing completions.
- Propagate final render-barrier failures through run outcomes and correlated client errors. Prevent cleanup dispatch after an action timeout.
- Restore synchronous force-layout position publication, keep readonly edge projection free of storage writes/notifications, and update only the changed edge geometry for appearance deltas. Force ticks publish positions once.
- Avoid whole-status structured cloning on ordinary run ticks while preserving ownership of timings, stop reasons and structured errors; publish settlement once and defer reentrant run starts until reset cleanup completes.
- Close a settled run's recording before dispatching unrelated queued actions, so later action updates cannot enter the previous archive.
- Copy run recording data and codec descriptors without cloning callable policies; detach queued action targets/arguments before changing the queue. Mutating caller inputs or returned statuses cannot rewrite retained values.
- Isolate startup observer statuses from recording setup, so observer changes cannot disable or rewrite the requested recording.
- Project readonly graph edges at stored typed node coordinates during initialization and updates, without force simulation or input writes; keep numeric and string IDs distinct in normal layouts too.

### Deprecated

- Public `RunStatus.completedSteps` remains available as the completed-action count; consumers use `completedActions`.

## @tensnap/agent [0.3.4] - 2026-10-18

### Added

- Versioned JSON output with structured errors and documented exit codes, plus the `--max-actions` quota; deprecated `--max-steps` remains accepted.
- Bundled, version-matched agent skills with offline project/user installation for Codex, Claude Code and shared Agent Skills directories. Preserve local edits and permissions, back up replacements, and roll back failed installs.

### Changed

- Use commander for command parsing and generated subcommand help. Validate CLI and HTTP inputs before side effects.
- Require Node.js 22 or newer. Help, version queries and skill installation work without native canvas binaries.

### Fixed

- Persist recordings atomically after run settlement, bound pending recorded runs, and await recording writes during shutdown.
- Preserve successful artifacts and structured per-target errors when rendering or persistence partially fails.
- Own retained inputs and status values, preserve newer scene revisions, and cancel retired simulator connections before they can attach or overwrite current state.
- Atomically commit scene, status, log and image files, retain previous complete files on failure, and report background persistence and screenshot failures through runtime events.

## @tensnap/benchmark [0.3.4] - 2026-10-18

### Changed

- Share CLI option and profile parsing, normalize artifact paths once, and refresh maintained benchmark profile fingerprints for current package manifests and the workspace lockfile. Historical measurement exports retain their original hashes.

### Fixed

- Generate analysis beside the manifest when its input path ends in a trailing slash.

## @tensnap/web [0.3.5] - 2026-10-18

### Fixed

- Show classified action outcomes and settlement status; a pending pause no longer masks an action or render failure.

## @tensnap/network [0.3.0] - 2026-10-17

### Added

- Introduce a dependency-free shared networking package with browser-safe IP-family validation and URL handling, plus Node dual-stack listeners, WebSocket frame normalization, byte counting, non-owning socket-open waits, and bounded socket closure.
- Roll back partial listener startup, preserve a shared ephemeral port across address families, retain binary views without copying, and count fragmented frame bytes without concatenation. Add focused lifecycle regressions and current-implementation benchmarks.
- Include the package in workspace lint, format, test, build, and npm release tooling, with independent patch versioning.

## @tensnap/protocol [0.3.3] - 2026-10-16

### Changed

- Reuse session-local MessagePack encoder/decoder state with owned output frames and discard oversized or failed scratch state. Use native JSON omission and MessagePack `ignoreUndefined` instead of recursively cloning outbound wire records; generic persistence helper semantics are unchanged. Add focused codec benchmarks and frame-ownership regression tests.

### Deprecated

- Use a retained `ProtocolCodec.encode()` / `.decode()` instead of the one-shot `encodeProtocolMessage()` / `decodeProtocolMessage()` helpers; the compatibility exports remain available to external callers. Internal transports and the conformance renderer client use codec instances.

### Fixed

- Validate Base64 consistently across browser and Node decoders, reject misplaced padding before decoding, and accept empty binary payloads.

## @tensnap/core [0.3.3] - 2026-10-16

### Changed

- Reuse layer-registry validation and role lookup, and use portable CSS color parsing with native browser syntax support.

### Fixed

- Release empty edge adjacency buckets, atomically replace trajectory storage and configuration on load, preserve valid explicit numeric constraints, and handle finite numeric extrema without overflowing the inferred range.
- Validate replacement recording options before stopping an active recording, own codec policy descriptors, and keep queued flushes scoped to their recording and action boundary.
- Deduplicate lazy event listeners and stop value-inspector traversal once output is truncated; missing own fields and fractional array paths no longer expose inherited values.

## @tensnap/js [0.3.3] - 2026-10-16

### Added

- A browser-safe `@tensnap/js/transport/browser` entry point that excludes the Node WebSocket host.
- Support local `ip_family` configuration (`auto`, `ipv4`, `ipv6`) for managed WebSocket listeners; external listeners configure their own family policy.

### Changed

- Built-in projectors return independent snapshots; layer `projectorOwnsValues`, `projectorDeepCopy`, and `deepCopy` options control ownership and publication copying. Reuse published records for emissions/cache baselines and keep safe copying for custom callbacks. Add ownership regressions and a focused projection/diff benchmark.
- Reuse equal owned nested fields during eligible built-in session scans while preserving standalone projector and explicit-copy guarantees. Function-valued item keys retain eager projection so callbacks never receive the private borrowed view.
- Retain directional protocol codecs per WebSocket connection so repeated frames reuse MessagePack state without changing transport buffer copies or validation policies.
- Compile field selectors once, preserve symbol selectors, own nested item snapshots, reuse structurally equal values, and encode typed scalar/compound identities without delimiter collisions.
- Import shared listener and WebSocket helpers directly from `@tensnap/network`; remove the former `normalizeWebSocketRawData` export without a compatibility alias. Protocol codecs, model identity, session state, and frame observers remain in the binding.

### Fixed

- Compare binary buffer/view contents when deciding whether to reuse projected values; changed `ArrayBuffer` and `DataView` contents no longer disappear as equal empty objects.
- Deduplicate endpoint listeners, route postMessage replies to the negotiated renderer identity, reject stale peers, and detach sessions even when disconnect cleanup throws.
- Advertise the actual bound endpoint, bracket IPv6 URL hosts, and share one ephemeral port across dual-stack listeners. This prevents connecting to an unrelated IPv4 service and reporting a misleading `model_mismatch` when the intended simulator listens on IPv6.
- Share concurrent host shutdowns, reject upgrades during shutdown, close failed session initialization, run session disconnect cleanup once, and release listeners even when another cleanup fails. Handle diagnostic/send failures without unhandled promise rejections, and allow shutdown before an external listener starts.
- Skip frame byte counting when transport observers are disabled and count received wire bytes directly when enabled.

## @tensnap/python [0.3.3] - 2026-10-16

### Added

- Support local `ip_family` configuration (`auto`, `ipv4`, `ipv6`) through the native networking stack, with no runtime dependency on JavaScript.

### Changed

- Built-in projectors return independent snapshots; eligible scans reuse equal owned fields before detaching changes, and initialization/full-sync/replay cache seeding reuses published records without another copy. Item layers expose `projector_owns_values`, `projector_deep_copy`, and `deep_copy`; custom callbacks keep safe copying unless explicitly declared independent. Resolve policy outside per-item calls, protect source-injected values, and benchmark each projection mode.
- Retain owned nested snapshots while reusing unchanged item records; focused item-diff benchmarks cover scalar and nested projections. The minimum `websockets` version is now 13.0, matching the asyncio API used by the server.

### Deprecated

- Use `send_action_result(..., request_id=...)` and `on_action_invoke` instead of `send_action_end` and `on_action_start`; the old callable spellings warn when used. Canonical action and asset enum spellings are documented, and private callback compatibility exports are removed.

### Fixed

- Drain batched message tails in order, shield shared sends from waiter cancellation, release the listener on stop, clean up failed client setup, and fail screenshot waits when the last renderer disconnects.
- Preserve asset metadata-only changes and copy mutable asset buffers; keep restore layer identities distinct across environments and reject attribute selectors with trailing newlines.
- Bind dual-stack listeners to one shared ephemeral port and roll back partial startup failures.

## @tensnap/go [0.3.3] - 2026-10-16

### Added

- Support local `ip_family` configuration (`auto`, `ipv4`, `ipv6`) through the native networking stack, with no runtime dependency on JavaScript.

### Changed

- Add `ComputeBorrowed` tracker paths for synchronous compare/materialize scans with previous-owned-field reuse; ordinary `DeepCopy` and explicit layer copy controls keep their semantics. Avoid a second field pass in composed built-in scalar projections.
- Reduce Go diff reflection and temporary allocations with standard-library map/slice comparisons, batch-local selection storage, reusable key-set capacity, single-pass changed-field materialization, and cached struct-copy field plans. Preserve deep-equality edge cases and all ownership/copy overrides; add differential/fuzz and population-churn regressions plus focused comparison/struct-copy benchmarks.
- Use comparable composite keys for common edge identities, copy key declarations, and reuse standard-library map/slice cloning helpers.

### Deprecated

- `TypeActionStart` and `TypeActionEnd` remain source aliases; use `TypeActionInvoke` and `TypeActionResult`.

### Fixed

- Deep-copy nested tracker state by default so in-place map/slice mutations cannot rewrite previous baselines or hide changes. Preserve typed nested containers; built-in/projector ownership and layer copy controls avoid duplicate publication/seeding copies. Add regression tests and focused allocation benchmarks.
- Emit cleared fields from complete item projections, reject non-finite numeric identities before caching, and preserve environment/layer boundaries during restore planning.
- Reject impossible MessagePack container and wide binary lengths during one-pass decoding, without scanning every valid frame twice. Failed decoders no longer retain scratch buffers in the pool. Regression seeds, replay fuzzing, and focused allocation benchmarks cover these paths.
- Bind dual-stack listeners to one shared ephemeral port and roll back partial startup failures. Close upgraded WebSocket connections when the HTTP service stops.

## @tensnap/julia [0.3.3] - 2026-10-16

### Added

- Support local `ip_family` configuration (`auto`, `ipv4`, `ipv6`) through the native networking stack, with no runtime dependency on JavaScript.

### Changed

- Configure JuliaFormatter's `jlfmt` app for source formatting and read-only lint checks with consistent two-space indentation; document app installation and PATH setup.
- Independent built-in projections and explicit layer/manual publication copy controls replace repeated normalization/copying. Eligible automatic scans materialize records incrementally and reuse equal previous owned fields while standalone calls retain their independent-output guarantee. Detach tuple-contained mutable values and byte buffers, reuse published baselines, and adapt MessagePack containers lazily. Add ownership tests and focused diff/codec benchmarks.

### Fixed

- Use structured environment/layer identities in restore plans so embedded separators and same-named layers in different environments cannot collide.
- Bind dual-stack listeners to one shared ephemeral port and roll back partial startup failures. Release client bookkeeping after handshake failures and close listeners even when server cleanup fails.

## @tensnap/web [0.3.4] - 2026-10-16

### Added

- Add a globally persisted IP-family preference to System Settings using the shared setting-row and selector UI. Default to `auto`; support forced `ipv4`/`ipv6` where the browser permits it and explain domain-name/TLS restrictions.

### Changed

- Use native ESM-compatible Vite configuration and keep the Node JS demo host out of browser bundles.
- Separate pure project-history and view-patch models from React bindings, share iterative view traversal, and reduce repeated container scans in collision detection and guideline matching. Import model types directly from their owning modules; internal forwarding exports and unused alias modules are removed.
- Apply the IP-family preference to the next connection or reconnect, including automatic retries; retain original project URLs and keep the machine-local preference out of project files.

### Fixed

- Resynchronize state after an automatic WebSocket reconnect, including a disconnect during the initial replay. Retain handshake listeners for the active transport and ignore duplicate identity announcements within one connection.
- Reset failed views during state derivation rather than scheduling a second render; preserve errors for unchanged identity, including a `NaN` reset key. Pass view renderer component types directly so replacements render immediately and retain normal React component lifetimes.
- Preserve undo access to saved states and branched edits, separate merge scopes, recover idle history state when error callbacks throw, and settle replaced dialog requests with cancellation.
- Handle deep/cyclic view trees without recursive lookup overflow; retain guideline geometry snapshots, continue past singleton size groups, and exclude disabled/self containers from pointer fallback.
- Release replaced WebSocket connections and abort subscriptions, reject early handshake closure and cancellation, and ignore stale socket events after reconnecting.

## @tensnap/web-adapter [0.3.2] - 2026-10-16

### Changed

- Reuse JS endpoint implementations through direct browser-safe imports. Renderer transport exports no longer forward simulator endpoint utilities; import those from `@tensnap/js/transport/browser`.

### Fixed

- Settle cancelled and concurrent transport connections, ignore stale initialization callbacks, and complete teardown after cleanup/post failures.
- Own persisted buffers and metadata, keep file/directory paths mutually exclusive, reject traversal segments, allow ordinary double-dot filenames, and encode exported text as UTF-8 before Base64 conversion.
- Cancel pending file-picker requests when replaced or unmounted, and reduce memory-filesystem recursive deletion to one scan per map.

## @tensnap/agent [0.3.3] - 2026-10-16

### Added

- Support `--ip-family auto|ipv4|ipv6` for simulator connections and the local HTTP control listener, propagate it to background daemons, and accept `ip_family` in the runtime connect API.

### Changed

- Retain directional codecs in the Node WebSocket transport so repeated frames reuse MessagePack state while continuing to honor current validation options.
- Wait for checkpoint cleanup and scene persistence to finish before asserting save completion.
- Use shared listener, URL, frame, and socket lifecycle helpers from `@tensnap/network`; remove the former `normalizeRawData` export without a compatibility alias.

### Fixed

- Validate finite CLI numeric options, integer port ranges, and context paths before starting a runtime; return HTTP 400 for invalid JSON control bodies.
- Encode binary render artifacts as Base64 with `dataEncoding` in both scene and inspection HTTP responses, while retaining native bytes in painter APIs.
- Roll back control listeners when address persistence fails, share concurrent startup/shutdown, release runtime event subscriptions, and format IPv6/wildcard control addresses as reachable URLs.
- Clean up cancelled WebSocket handshakes and ignore stale socket events after reconnecting.

## @tensnap/tauri [0.3.4] - 2026-10-16

### Changed

- Use `import.meta.dirname` and attributed JSON imports in the Vite config for native loader compatibility.
- Import Web file operations from their direct host entry point instead of the removed hooks compatibility barrel.

## @tensnap/web-common [0.3.2] - 2026-10-16

### Changed

- Clarify delayed callback lifetime and filesystem metadata ownership contracts, and remove redundant development comments.

### Fixed

- Publish event callbacks after commit, preserve pending debounce/throttle deadlines across callback changes, and cancel pending work on delay changes or unmount. Remove the unused callback dependency-list argument.
- Forward `Select` content props to its popup, including attributes, positioning options, and keyboard handlers.

## @tensnap/benchmark [0.3.3] - 2026-10-16

### Changed

- Preserve browser initialization failures with connection and transaction state, recent diagnostics, workload configuration, server errors and message counts, wire bytes, and a bounded startup message timeline. Both page-returned failures and outer timeouts retain this context.
- Use native ESM-compatible Vite/Vitest configuration and verify active publication environment-lock hashes against the checkout.
- Reuse network frame normalization, wire-byte counting, socket-open waits, and bounded close helpers; remove duplicate implementations.

### Fixed

- Inspect the local Julia binding through the evaluation project without personal startup files, report its resolved source path, and parse probe JSON from stdout independently of diagnostic stderr.
- Connect to the actual simulator listener endpoint, including IPv6, and cover the advertised-endpoint path with a regression test.

## @tensnap/examples-js [0.3.3] - 2026-10-16

### Added

- Accept `--ip-family auto|ipv4|ipv6` in the WebSocket demo entry and document explicit IPv6 endpoints.

### Fixed

- Keep Node demo hosts out of browser bundles. Import browser model types directly and use the explicit `entries/main-ws` entry for WebSocket hosting instead of the removed manifest `startDemoServer` method.
- Print URLs from actual bound listeners, including bracketed IPv6 and shared ephemeral ports.

## tensnap [0.3.2] - 2026-10-16

### Changed

- Enforce zero Oxlint warnings, use native ESM paths in shared build/test configuration, and assert fixture prerequisites before optional values are dereferenced.
- Translate useful development comments to English, remove obsolete notes, and use paired folding regions with the existing separator lint rule.
- Document projection and snapshot ownership, canonical imports, server lifecycle, recorder limits, and focused benchmark/fuzz commands. Update the ABM binding skill with identity and environment checks.
- Apply the configured repository formatters to maintained source and documentation.
- Include shared network runtime sources and package exports in every conformance source digest, with mutation canaries and explicit network-package CI checks.
- Include Julia in the root format command and add network benchmark/release commands. Document IP-family configuration, browser restrictions, endpoint diagnostics, and package ownership boundaries.
- Accept both string and array npm version-query responses in release preflight; test duplicate versions, omitted dependencies, and registry authentication failures before publication.

## @tensnap/web [0.3.3] - 2026-10-04

### Fixed

- Deduplicated Radix's dismissable layer in the Web build so closing a dialog opened from a menu restores body pointer events.

## @tensnap/tauri [0.3.3] - 2026-10-04

### Changed

- Restored multi-platform draft release builds for `app-v*` tags.

### Fixed

- Applied the same Radix layer deduplication to the desktop WebView build.

## tensnap [0.3.1] - 2026-10-04

### Added

- Added the executable JSON/MessagePack conformance matrix for Python/Mesa, Go, JavaScript/TypeScript, Julia, and the shared renderer client, with retained evidence, failure canaries, and CI verification. Its documentation separates visible projections, complete fixture host state, deterministic replay, and case-study limits.
- Added a four-host Schelling audit workflow with retained checkpoint, future-replay, and rendered-scene evidence.

### Changed

- Consolidated npm publishing for `@tensnap/protocol`, `@tensnap/core`, `@tensnap/js`, and `@tensnap/agent` into one GitHub Actions workflow with per-package tags, selectable manual batches, and npm Trusted Publishing through GitHub OIDC. Added compiled ESM and declarations to the core package's publish artifact.
- Replaced ESLint with repository-wide Oxlint and Oxfmt, formatted maintained JavaScript/TypeScript and Markdown, excluded generated artifacts from formatter runs, and kept generated schema prose unwrapped.
- Updated npm dependencies across the workspace and moved the supported pnpm major to 12 without a minor-version pin.

## @tensnap/protocol [0.3.2] - 2026-10-04

### Changed

- Avoided an extra deep copy after strict protocol decoding.
- Unwrapped prose in the generated schema reference while retaining TypeScript code-block formatting.
- Updated npm dependencies.

## @tensnap/core [0.3.2] - 2026-10-04

### Added

- Added a shared `RendererClient` for handshake-safe transport replacement and correlated synchronization and action waits.

### Changed

- Staged state synchronization until its matching end frame, retained legacy create replacement in compatibility and replay paths, and enforced strict item identity rules.
- Preserved trajectory updates during recording and improved chart, asset, environment, and snapshot handling for sparse data and repeated scene changes.
- Reduced repeated item-key scans and agent-batch copies, reused the continuous-run action watchdog, and migrated stop-expression validation to the `pure-expr` 0.4 AST and context API.

### Fixed

- Corrected state-before-result ordering, failed sends, and render-barrier failure handling in renderer paths.

## @tensnap/agent [0.3.2] - 2026-10-04

### Changed

- Adopted the shared `RendererClient` for headless sessions and updated npm dependencies.

## @tensnap/web [0.3.2] - 2026-10-04

### Changed

- Kept project source and transport changes consistent across connection failures, local edits, snapshot playback, and undo/redo.
- Cached WebSocket validation settings and updated npm dependencies.

## @tensnap/web-adapter [0.3.1] - 2026-10-04

### Changed

- Adopted the shared Oxc tooling and updated npm dependencies.

## @tensnap/web-common [0.3.1] - 2026-10-04

### Changed

- Adopted the shared Oxc tooling and updated npm dependencies.

## @tensnap/benchmark [0.3.2] - 2026-10-04

### Changed

- Retained the multi-host Schelling audit evidence and updated npm dependencies.

## @tensnap/tauri [0.3.2] - 2026-10-04

### Changed

- Updated aligned Tauri JavaScript and Rust plugins and refreshed the compatible Cargo dependency graph.

## @tensnap/python [0.3.2] - 2026-10-04

### Added

- Added model-owned map, matrix, and indexed agent sources with compiled selectors, revision-based sparse updates, scan fallback, and validated projected restore.

### Fixed

- Corrected binding state ordering, parameter feedback, and checkpoint decoding.

## @tensnap/go [0.3.2] - 2026-10-04

### Added

- Added a bundled MessagePack codec with canonical wire field names and binary WebSocket frames; JSON remains the default.
- Added typed map and matrix agent layers with direct selectors, flat matrix storage, optional sparse tracking, and validated source restore.

### Fixed

- Corrected canonical checkpoint data URL and byte decoding.

## @tensnap/julia [0.3.2] - 2026-10-04

### Added

- Added map and matrix agent layers with direct selectors, explicit matrix orientation, and validated projected restore.

## @tensnap/js [0.3.2] - 2026-10-04

### Added

- Added map and matrix agent layers for keyed maps and nested or flat matrices, with direct selectors, sparse tracking, and validated projected restore.

### Fixed

- Corrected binding state ordering, parameter feedback, and checkpoint decoding.

## @tensnap/examples-js [0.3.2] - 2026-10-04

### Added

- Added exact Schelling replay validation and an optional audit path for retained cross-host evidence.

## @tensnap/examples-julia [0.3.2] - 2026-10-04

### Added

- Added Schelling checkpoint capture and optional audit support.

## @tensnap/protocol [0.3.1] - 2026-10-02

### Fixed

- Centralized the strict wire protocol version used by the schema and TypeScript consumers.

## @tensnap/core [0.3.1] - 2026-10-02

### Fixed

- Read the protocol version from `@tensnap/protocol` for renderer sessions and snapshots.

## @tensnap/benchmark [0.3.1] - 2026-10-02

### Fixed

- Read benchmark protocol version checks and types from `@tensnap/protocol`.

## @tensnap/tauri [0.3.1] - 2026-10-02

### Fixed

- Read the Tauri app version from `package.json` and check it against Cargo metadata.

## @tensnap/python [0.3.1] - 2026-10-02

### Added

- Added class-owned binding metadata, declarative layer inverses, checkpoint hooks, and compiled dependency ordering for environment layers.
- Added model-aware projected time restoration with pre-apply validation, plus a Mesa clock adapter for the default step schedule across Mesa 3.x and 4.0.0a0.
- Added projected and exact restoration to flocking and Game of Life examples.

### Changed

- Updated Mesa grid examples to use cell-space agents and a typed, example-local import route for Mesa 3.0/3.1 and 3.2+/4.0.

### Fixed

- Kept layer restore callbacks attached to their declared owner and rejected invalid complete-layer restores before model mutation.
- Restored the pending Mesa step event alongside model time so the next step advances once after a projected restore, and rejected unsupported schedules before changing the model.
- Resolved Ruff parameter-count findings without changing public decorator or factory signatures.
- Derived package metadata and runtime binding versions from one Python source.

## @tensnap/go [0.3.1] - 2026-10-02

### Added

- Added layer-local restore builders, typed checkpoints, and compiled layer dependency ordering.
- Added model-wide before/after hooks around declarative projected restore.
- Added SIRS and forest-fire examples with reversible state and exact random continuation.
- Added focused SIRS and forest-fire dynamics regression tests.

### Fixed

- Validated complete projected layers and rejected ambiguous topology before applying model changes.
- Centralized Go binding and protocol versions used in simulator handshakes.

## @tensnap/js [0.3.1] - 2026-10-02

### Added

- Added declarative layer restore composition, exact checkpoint support, and cached layer dependency ordering.

### Fixed

- Kept metadata and item inverses on their owning layer during restoration.
- Read the binding version from package metadata and the protocol version from its shared constant.

## @tensnap/julia [0.3.1] - 2026-10-02

### Added

- Added layer-local restore callbacks, checkpoint hooks, and registration-time dependency ordering.
- Added model-wide before/after hooks around declarative projected restore.
- Added El Farol checkpoint continuation coverage.

### Fixed

- Validated projected topology and layer ownership before applying a restore.
- Read the binding version from Julia package metadata and centralized the protocol version.

## @tensnap/agent [0.3.1] - 2026-10-02

### Fixed

- Preserved captured simulation time in CLI checkpoint files and restored it with exact checkpoints when projected restore is supported.
- Wrote runtime control files atomically so CLI startup cannot read a partial status update.

## @tensnap/web [0.3.1] - 2026-10-02

### Fixed

- Restored snapshot time with exact checkpoints when the simulator declares projected restore, preventing a stale renderer or binding clock.
- Read project snapshot protocol versions from `@tensnap/protocol`.

## @tensnap/examples-js [0.3.1] - 2026-10-02

### Added

- Made Axelrod checkpoints retain random state for reproducible continuation.
- Added Schelling checkpoint continuation regression tests.

### Fixed

- Restored full culture layers and used unit increments for the updates-per-tick control.
- Preserved Schelling random state and iteration order across checkpoint restoration, including restores that also set simulation time.
- Read the example manifest protocol version from `@tensnap/protocol`.

## @tensnap/examples-julia [0.3.1] - 2026-10-02

### Added

- Added El Farol patron restoration and exact history/random checkpoints.

## tensnap [0.3.0] - 2026-07-17

### Added

- Added renderer-side model identity and capability handling, transactional state sync, monitor storage, structured action results, projected scene restore, exact checkpoint capture/restore, and snapshot-backed project sources across core, Web, Tauri, and the headless agent.
- Added reusable value inspection for simulator metadata, monitor values, and agent data, plus monitor views, simulator information, scene restore controls, protocol validation settings, and centralized project diagnostics.
- Added headless checkpoint capture/restore routes and CLI commands, bounded-run validation controls, and compact monitor replay in recordings.
- Added accessible application-owned confirmation dialogs for project close and filesystem deletion instead of browser-native prompts.

### Changed

- Upgraded the complete npm workspace with `npm-check-updates`, including TypeScript 7.0.2, ESLint 10.7, Vite 8.1.5, Leafer 2.2.2, Hono 4.12.30, ws 8.21.1, and current Tauri JavaScript plugins.
- Pinned Node.js 24 and pnpm 11 for workspace development. Tools that still execute the removed pre-v7 TypeScript JavaScript API receive an isolated TypeScript 6 runtime while all TenSnap compilation uses TypeScript 7.
- Aligned Tauri JavaScript and Rust plugins, refreshed the compatible Cargo graph, raised the Rust minimum to 1.88, and began tracking the real desktop application lockfile.
- Reworked renderer handshake, reconnect, legacy-session negotiation, project migration, recording, chart restoration, and action scheduling around the v0.3 identity and transaction model.
- Promoted the finalized protocol specification out of the historical v0.3 draft and refreshed maintainer guides, API references, tutorials, release instructions, and repository skills.

### Fixed

- Surfaced correlated action failures in the Web UI and prevented invalid or mismatched handshakes from mutating an existing project.
- Migrated legacy persisted chart, asset, monitor, and snapshot shapes without silently replacing malformed project data.
- Completed all Chinese and Japanese Web and filesystem-adapter translations and restored strict catalog compilation.
- Fixed TypeScript 7 compatibility for protocol documentation generation and TypeScript-aware ESLint, and fixed a Python binding type annotation exposed by the repository-wide lint pass.

### Removed

- Removed the stale Tauri `Cargo.lock` ignore rules; the real desktop `src-tauri/Cargo.lock` is now tracked for reproducible builds.

## @tensnap/protocol [0.3.0] - 2026-07-17

### Added

- Added the mandatory `simulator_info` handshake with binding, model, instance, capability, and state-schema identity.
- Added monitor create/update/delete messages, scene capture and restore transactions, binary or protocol-value checkpoints, structured errors, action targets/kwargs/errors/timings, explicit chart selectors, and chart truncation.
- Added canonical conformance traces for handshake/state sync, targeted actions, chart/monitor behavior, and scene restoration.
- Added opt-in runtime validation levels (`off`, `warning`, and `error`) with direction-aware issues and warning callbacks.
- Added a finalized standalone specification and schema-derived protocol type documentation generated with `zod-to-ts`.

### Changed

- Made canonical v0.3 messages strict snake_case and renamed the action wire pair to `action_invoke`/`action_result`, correlation to `request_id`, action continuation to `should_continue`, layer data to `metadata`, and asset metadata to `asset_metadata`.
- Made state sync a correlated, non-nestable read-only inventory transaction; scene restore is a separate atomic transaction.
- Required chart delete/update operations to identify `group` or `series` explicitly and formalized same-time replacement and truncate boundaries.
- Moved built-in layer payload ownership and all inferred protocol types into the protocol package as the sole wire-contract source.

### Fixed

- Selected legacy compatibility once per session from parsed major/minor versions and kept strict v0.3 inputs free of legacy aliases.
- Made legacy normalization path-aware, detected conflicting canonical/legacy aliases, retained state-sync correlation, and preserved custom user maps.
- Decoded ambiguous legacy chart operations through the renderer compatibility boundary and covered legacy chart clearing with regression tests.

### Removed

- Removed action `allow_runtime_change` and the ambiguous v0.2 action, chart, asset, and layer field shapes from the strict v0.3 contract.

## @tensnap/python [0.3.0] - 2026-07-17

### Added

- Added the v0.3 `simulator_info` handshake with stable model identity, instance identity, binding metadata, state schema version, and capabilities.
- Added monitor decorators/models, monitor replay, action targets and kwargs, projected scene restore helpers, checkpoint capture/restore hooks, and correlated scene transaction boundaries.
- Added exact native-to-wire mapping tests validated against the generated protocol schemas.

### Changed

- Migrated actions to `action_invoke`/`action_result`, `request_id`, `should_continue`, and structured execution errors.
- Migrated chart groups to `data_list`, layer payloads to `metadata`, and all protocol-visible fields to canonical snake_case while retaining language- appropriate Python APIs.
- Made state sync read-only, replay monitors with scenario state, and gate optional restore/capture behavior through declared capabilities.

### Fixed

- Prevented chart helper methods and other structural fields from being inferred as model parameters.
- Preserved parameter correction semantics: accepted values remain quiet while rejected or canonicalized values emit `param_sync`.
- Annotated action serialization dictionaries so strict mypy accepts boolean, scope, and kwargs values.

## @tensnap/go [0.3.0] - 2026-07-17

### Added

- Added v0.3 simulator identity/capabilities, correlated state sync and actions, structured action errors/timings, action targets/kwargs, monitors, and scene capture/restore payloads to the protocol, ABM, binding, and server layers.
- Added declarative monitor builders, projected restore and checkpoint hooks, exact mapping tests, and protocol-schema validation of native output.
- Added tag-driven parameter, environment metadata, agent, and edge projection with explicit scopes and omission rules.

### Changed

- Migrated the server to canonical `action_invoke`/`action_result`, `request_id`, `should_continue`, `data_list`, `metadata`, and strict snake_case v0.3 payloads.
- Made `ActionInvokePayload` and `ActionResultPayload` the canonical Go type names; removed the v0.2 `ActionStartPayload` and `ActionEndPayload` source-compatible aliases.
- Made `binding.NewModel` own declared lifecycle, parameters, environments, charts, and monitors while preserving low-level imperative composition.

### Fixed

- Replayed authoritative scenario state inside correlated sync transactions and emitted action results only after visible updates.
- Enforced action target/kwargs validation and returned protocol-visible errors without sending a second uncorrelated transport error.
- Updated examples and API documentation to avoid duplicate action results and removed references to the retired v0.2 router constructor.

## @tensnap/js [0.3.0] - 2026-07-17

### Added

- Added strict v0.3 simulator sessions that send `simulator_info`, wait for the first valid state sync before initialization, and correlate every action invocation/result.
- Added declarative action scope, target, kwargs, error, and continuous-result handling; monitor declarations and replay; and grouped chart metadata.
- Added composed projected restore with full layer create/update/delete callbacks, imperative projected restore, and paired exact checkpoint capture and restore hooks.
- Added scene capture/restore support to `SimulatorEmitter`, `SimulatorSession`, `ScenarioRegistry`, WebSocket hosts, and postMessage hosts.
- Added configurable client/server protocol validation levels and transport warning/error events.

### Changed

- Made declarative definitions emit only canonical v0.3 snake_case payloads and made the protocol package the only source of wire types.
- Made restore replay omit charts, order dependent-layer deletion safely, and replay complete authoritative state after successful mutation.
- Made default lifecycle actions and state replay flush visible changes before their matching `action_result`.

### Fixed

- Prevented initialization before identity-checked state sync and prevented legacy aliases from entering strict binding sessions.
- Preserved binary checkpoint semantics across JSON and MessagePack transports and validated exact emitted payloads against the protocol schemas.

## @tensnap/julia [0.3.0] - 2026-07-17

### Added

- Added v0.3 simulator identity/capabilities, correlated state sync and action results, monitor builders, action targets/kwargs, scene restore/capture, and exact checkpoint support.
- Added grouped chart series metadata, projected parameter updates, exact native-to-wire mapping tests, and lifecycle/conformance coverage.
- Added environment-aware automatic agent projection, including Agents.jl-style positions without introducing an Agents.jl dependency.

### Changed

- Migrated all wire output to canonical v0.3 snake_case, including `action_invoke`/`action_result`, `request_id`, `should_continue`, `data_list`, and layer `metadata`.
- Expanded explicit builders and scenario replay so parameters, actions, environments, charts, and monitors participate in initialization, reconnect, reset, and restore consistently.
- Updated the El Farol example to use the uniform environment presentation and improved automatic projection behavior for non-grid models.
- Changed the release helper to create annotated `tensnap-julia-vX.Y.Z` tags suitable for the repository's Julia release convention.

### Fixed

- Hardened WebSocket handshake/lifecycle handling and prevented state changes before a valid v0.3 sync request.
- Corrected dependency-layer metadata, action continuation naming, and exact omission of unsupported parameter/projector fields.

## @tensnap/benchmark [0.2.2] - 2026-07-12

### Added

- Added three explicit benchmark suites: six production Web component cases without transport, complete Axelrod/Schelling/Wolf-Sheep model runs, and a seeded random-walk comparison across raw Leafer, core layers, and the full Web transport path.
- Added shared cycle latency/TPS metrics, component mutation metrics, complete model stop metadata, and random-walk overhead percentages relative to raw Leafer.

### Changed

- Rebuilt the benchmark app on React and the production Web host so component and model results follow the current Web render-trigger, TPS, store, layout, session, and canvas behavior.
- Reorganized benchmark configuration, JSON/Markdown reports, regression gate names, tests, and documentation around component, model, and random-walk categories.

### Fixed

- Preserved partial benchmark results when a simulator stops before the requested step count, including actual completed/measured frames and the simulator stop reason instead of failing the run.

## @tensnap/web [0.2.4] - 2026-07-12

### Added

- Added a production benchmark host that mounts the real transport store, `RendererSession`, Zustand subscriptions, auto-layout, React view tree, and the Web chart/environment components for benchmark consumers.

### Fixed

- Made continuous-action buttons leave their visible running state as soon as pause is requested, so one click immediately restores the play icon and paused indicator while the in-flight tick finishes safely.

## tensnap [0.2.1], @tensnap/protocol [0.2.2] - 2026-07-12

### Added

- Added a shared `RendererSession` and `RunController` for browser and headless hosts, with explicit manual/bounded runs, stop expressions, deadlines, pause/step/reset semantics, render barriers, action timeouts, and observable stop reasons.
- Added shared `SnapshotArchive` persistence: independently decodable MessagePack segments, lossless byte compression, worker encoding in the web host, and pluggable layer codec implementations.
- Added project format v2 with a content-addressed asset table shared by the live scenario and all recordings; older project formats remain readable.
- Added scenario inspection, agent-focused rendering, headless chart painting, scene/run HTTP routes, and matching CLI controls for automation workflows.
- Added `ChartScene` and `BrowserChartView`, canvas-backed chart rendering, snapshot detail playback/export, continuous-run profiles, live TPS/MSPT metrics, and project-scoped undo/redo history.
- Added RendererSession benchmark coverage for real React/Zustand commits, recording, long-history conditions, trajectories, checkpoint behavior, and reusable p95/TPS regression gates.

### Fixed

- Restored replace-by-default handling for repeated create messages in core, preventing model resets from retaining stale agents, edges, trajectories, or chart history; internal upsert paths now preserve those states explicitly.
- Kept dependent-layer indexes valid when a source layer is recreated, and removed stale chart metadata registrations when a chart group is replaced.
- Stopped maintaining the agent-neighborhood spatial hash while no inspector is open, removed item-delta full-scene rebuild triggers, split broad UI revisions by domain, and made uniform agent lists derive only their visible page. This restores non-recording Web throughput for agent-heavy models.
- Converted render-barrier failures into an observable `render-error` run stop instead of leaving an unhandled rejection or stalled pipeline.
- Required action completions to match their dispatched `tick_id`, preventing stale or ambiguous completions from contaminating run metrics.
- Fixed multi-chart headless output paths so suffixes apply only to filenames, for both relative and absolute destinations.
- Fixed binary filesystem checksums so distinct invalid UTF-8 byte sequences no longer collapse to the same decoded-text hash.
- Made Tauri Save As request the final extension/filter in the native dialog and write exactly the returned scoped path.
- Made Tauri's native menu follow the renderer language setting, with complete English, Chinese, and Japanese menu labels.
- Prevented project tabs from wrapping long filesystem paths; tabs now show a compact filename and Project Settings exposes the full path read-only.
- Compacted the settings dialog's system controls into a responsive grid so ordinary desktop viewports do not require scrolling.

### Changed

- Made `@tensnap/protocol` the sole source of built-in layer schemas and protocol item types; core now keeps only renderer-owned state and helpers.
- Made bounded-run mode explicit and made standard toolbar controls bind only to the canonical `start`, `step`, and `reset` action IDs.
- Reworked trajectory storage around explicit active/historical segments and lifecycle policies for deletion, state sync, reset, and agent-ID reuse.
- Unified renderer settings, native persistence, scoped file access, runtime checkpoint recovery, and localized Tauri menus across web and desktop hosts.
- Updated runtime, snapshot, project, protocol, desktop-adapter, and user documentation for shared session control, offline replay, trajectory lifecycle behavior, and scoped native saves.
- Split stable UI, rendering, runtime, and data dependencies into shared Vite chunks for web, Tauri, and benchmark builds while retaining the 500 KiB eager-code warning budget.

### Removed

- Removed the superseded browser `SimulationLoopController`, agent-session and reserved-action wrappers, retired wait routes, and the old Leafer-specific line-chart view.
- Removed compatibility-only action-role inference, optional bounded-run mode, tickless action-metric matching, duplicate core protocol schemas, redundant type/path/export aliases, legacy browser polyfills, and vendor-prefixed canvas smoothing assignments.
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
