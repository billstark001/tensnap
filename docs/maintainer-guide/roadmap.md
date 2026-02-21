# TenSnap v0.2 Roadmap

Migration path from the v0.1 protocol to the redesigned v0.2 protocol.
No backward compatibility is required (alpha).

---

## Milestone 1 [COMPLETED] — Core Protocol (web-core & tensnap-web)

**Goal**: implement the new message types in the TypeScript packages so the
frontend can speak v0.2.

- [x] Separate `Action` from `Parameter` in `tensnap-web-core`
  - Remove `action` from `ParameterType`; expose `Action` as a standalone type.
- [x] Rewrite protocol types in `tensnap-web/src/types/api.ts`
  - Remove: `time_step_start`, `time_step_end`, `button_click`, `environment_update`,
    `agent_update` (old), `agent_batch_update`, server-side `state_sync`
  - Add: all v0.2 message types (see `protocol-v0.2.md`)
- [x] Update Zod schemas in `tensnap-web/src/types/api-schemas.ts`
- [x] Update `tensnap-web/src/store/scenario/scenario-ws.ts` message handlers
- [x] Update public re-exports in `tensnap-web/index.ts`
- [x] Implement asset management & storage
- [x] Bump all JS/TS package versions to **0.2.0**

---

## Milestone 2 [COMPLETED] — Python Backend

**Goal**: update `tensnap-python` to implement v0.2 server messages.

- [x] Replace `time_step_start`/`time_step_end` with `metadata_update`
- [x] Replace `button_click` handler with `action_start` handler
- [x] Emit `action_end` with `continue` flag after each action execution
- [x] Replace `environment_update` / `agent_batch_update` with
      `env_create`/`env_delete`, `env_layer_*`, `agent_create`/`agent_update`/`agent_delete`
- [x] Replace state_sync response with individual CUD messages
- [x] Add `parameter_sync` emission when server overrides a value
- [x] Remove `ActionParameter`; register actions via `add_action()` using `Action` dict
- [x] Bump Python package version to **0.2.0**

---

## Milestone 3 — Layer Registry & Plugin API

**Goal**: make the layer system extensible from outside the core package.

- [ ] Define `LayerRegistry` API in `tensnap-web-core`
- [ ] Register built-in layer types
- [ ] Fully implement all layers' communication, state management and serialization
- [ ] Expose `registerLayerType(type, schemas)` for third-party layers
- [ ] Document plugin authoring guide

---

## Milestone 4 — Charts & Snapshot

**Goal**: design chart data containers and snapshot serialization for v0.2.

- [ ] Decide on chart container format for future chart types (bar, scatter, …)
- [ ] Update snapshot serialization to include v0.2 env/layer structure
- [ ] Update `docs/api-reference/python-api.md` for v0.2 API surface

---

## Milestone 5 — Python Bindings Examples (`/examples/python`; `/examples/python_mesa`)

**Goal**: make sure the python examples behave correctly under the v0.2 protocol.

## Milestone 6 — Fake Models (tensnap-web-utils)

**Goal**: update the TypeScript fake-model fixtures to use v0.2 messages.

- [x] Update `BaseSimulationManager` to use v0.2 message helpers
- [x] Update `wolf-sheep` and `schelling` fake models
- [ ] Add example demonstrating continuous `step` action loop

---

## Notes

- The reserved action IDs `init` and `step` must not be used by user code for
  other purposes.
- The `state_sync` client→server payload will likely grow as new entity types
  are added; keep it versioned.
- Graph edges use `(source, target)` as their identity key. If multiple edges
  between the same pair of nodes are needed in the future, an explicit `id`
  field should be added.
