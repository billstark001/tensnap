# TenSnap Refactor Roadmap

This roadmap tracks the package and architecture refactor around protocol v0.2.

It replaces the old milestone list that mixed already-landed work, stale package names, and goals that no longer match the current repository layout.

---

## Goals

The refactor has four primary goals:

1. make @tensnap/core the canonical home for protocol, Scenario, and shared rendering primitives
2. keep renderer application concerns in @tensnap/web
3. replace client/server terminology with renderer/simulator terminology
4. make the transport layer implementation-specific while keeping protocol/state logic portable

A secondary goal is to separate benchmark tooling from core so core remains a reusable library rather than a mixed library-and-app package.

---

## Current State

The repository is currently between foundational extraction and renderer integration.

### Landed

- `packages/tensnap-web-core` has been renamed to `packages/core`
- benchmark sources have been split into `packages/benchmark`
- `@tensnap/core` now owns:
  - protocol types
  - protocol schemas
  - protocol codecs
  - Scenario
  - layer registry
  - transport interfaces
- `@tensnap/web/src/types/api.ts` and `api-schemas.ts` now re-export protocol definitions from `@tensnap/core`
- renderer/simulator terminology is the canonical naming in new core APIs
- full renderer-side migration from web-local Scenario logic to `@tensnap/core/scenario`
- full removal of compatibility aliases using server/client terminology
- migration of browser WebSocket handling to the new transport abstractions

### Not Yet Landed

- migration of python and example code to the new package boundaries and naming
- documentation cleanup outside the protocol and roadmap documents

---

## Workstreams

## Workstream A: Core Extraction

Status: in progress, foundation landed

Objective:

Make `@tensnap/core` the stable dependency for protocol, Scenario, transport abstractions, layer registry, and shared rendering primitives.

Completed:

- rename package to `@tensnap/core`
- move protocol definitions into core
- add JSON and MessagePack codecs to core
- add transport interfaces to core
- add EventTarget-based Scenario to core
- move layer registry ownership to core

Remaining:

- remove remaining stale docs and references to `tensnap-web-core`
- tighten public export surface if compatibility aliases are no longer needed
- validate core package API boundaries against future simulator-side consumers

## Workstream B: Benchmark Separation

Status: landed for package split, pending cleanup

Objective:

Keep performance harnesses separate from the reusable core library.

Completed:

- create `@tensnap/benchmark`
- move benchmark sources out of core
- update imports to consume `@tensnap/core`

Remaining:

- audit docs and scripts that still describe benchmark as part of core
- decide whether benchmark stays private or becomes a maintained developer tool package

## Workstream C: Web Renderer Migration

Status: not started as a dedicated migration pass

Objective:

Make `@tensnap/web` a renderer application layered on top of `@tensnap/core`, not a second home for protocol/state definitions.

Required changes:

- replace web-local protocol assumptions with direct core imports everywhere
- introduce a renderer-side adapter around `Scenario`
- move browser transport code to the new `ISimulatorTransport` contract
- rework current Zustand scenario store so it consumes core Scenario rather than duplicating domain state
- keep project/view management in web only

Non-goals:

- moving React UI code into core
- moving project file management into core
- moving Leafer instances or DOM objects into Scenario

## Workstream D: Simulator and Python Migration

Status: pending

Objective:

Bring simulator-side packages into alignment with the new renderer/simulator naming and the core-owned protocol model.

Required changes:

- update python bindings and simulator runtime code to use protocol v0.2 as documented now
- align terminology in simulator-facing docs and APIs
- decide how non-browser transports will implement the shared transport contract
- verify state_sync, asset_sync, and action loop behavior against the new spec

## Workstream E: Terminology Cleanup

Status: partial

Objective:

Remove old client/server naming from code and docs once the renderer-side migration is complete.

Completed:

- canonical core types use renderer/simulator names
- protocol documentation now uses renderer/simulator framing

Remaining:

- remove deprecated TypeScript aliases when downstream packages no longer depend on them
- update stale docs, comments, and package descriptions outside the actively rewritten maintainer docs
- audit examples and tests for old naming

---

## Sequence

The intended execution order is:

1. finish core extraction and package split
2. migrate the web renderer to consume core Scenario and transport abstractions
3. migrate simulator-side packages and examples
4. remove deprecated compatibility aliases and stale terminology
5. do a repository-wide documentation cleanup pass

This order is deliberate.

If the web renderer is migrated before core ownership is stable, the same concepts will continue to move under active consumers. If compatibility aliases are removed before web and python finish migrating, the refactor will create churn rather than reducing it.

---

## Acceptance Criteria

The refactor should be considered complete only when all of the following are true:

- `@tensnap/core` is the only canonical source of protocol definitions
- `@tensnap/core` is the only canonical source of Scenario and layer-registry state logic
- `@tensnap/web` no longer maintains a parallel protocol/state model
- concrete transport implementations live outside core and conform to shared transport interfaces
- benchmark code is fully decoupled from the core package
- renderer/simulator terminology replaces client/server terminology across supported public APIs and maintainer docs
- deprecated aliases can be removed without breaking supported packages in the monorepo

---

## Immediate Next Steps

The next planned implementation slice is the web renderer migration.

That slice should focus on:

- wiring browser transport code to the new core transport contract
- replacing web-local Scenario ownership with a core Scenario instance
- defining a thin renderer adapter layer where browser-specific behavior is unavoidable
- keeping project/view state in web rather than leaking it into core

Only after that migration should the repository remove the remaining deprecated compatibility exports.

---

## Risks

### Parallel state models

If web keeps its own Scenario-like state for too long, the repository will continue carrying two domain models with different semantics.

### Premature compatibility removal

If server/client aliases are removed before web and simulator packages are migrated, the refactor will create unnecessary breakage and force partial rollbacks.

### Core boundary erosion

If browser-specific rendering objects or store implementations are moved into core for convenience, the package will stop being reusable for non-browser renderers and simulator-side tools.

### Documentation drift

The repository already accumulated drift between protocol docs and implementation. Future work should treat maintainer docs as part of the change, not as a follow-up task.

---

## Out of Scope

The current roadmap does not include:

- renaming `tensnap-web-utils`
- redesigning the renderer UI
- changing the chart storage model beyond what is needed for protocol/Scenario migration
- introducing backward compatibility with v0.1
- packaging decisions for external release beyond the current monorepo refactor
