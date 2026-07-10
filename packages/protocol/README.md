# @tensnap/protocol

`@tensnap/protocol` is the source of truth for TenSnap protocol v0.2 payload
shapes, runtime schemas, and wire codecs.

The package is intentionally about the renderer/simulator contract only. It
does not define rendering layers, React state, storage adapters, project UI, or
concrete WebSocket implementations.

## Source Files

- [src/types.ts](./src/types.ts): message envelopes and schema-inferred payload types.
- [src/schemas.ts](./src/schemas.ts): runtime zod schemas for protocol payloads.
- [src/codec.ts](./src/codec.ts): JSON and MessagePack protocol codecs.
- [src/binary.ts](./src/binary.ts): base64 and data URL handling for binary semantic fields.
- [src/controls.ts](./src/controls.ts): parameter and action payload definitions.
- [src/layers.ts](./src/layers.ts): built-in layer metadata, item, and specialized payload definitions.
- [src/chart.ts](./src/chart.ts): chart metadata and update payload definitions.
- [src/asset.ts](./src/asset.ts): asset metadata payload definitions.

To export the complete schema-derived TypeScript definitions into Markdown:

```bash
pnpm --dir packages/protocol export:types protocol-types.md
pnpm --dir packages/protocol export:protocol
```

`export:types` prints to stdout when the output path is omitted.
`export:protocol` writes to `dist/protocol-types.md` by default, or to the
first argument when one is provided.

Every package build also writes the generated document to
`dist/protocol-types.md`, including the package name, version, and source
metadata used for that build.

## Scope

Protocol v0.2 defines:

- the wire format between a simulator and a renderer;
- canonical message families and payload shapes;
- runtime schemas used to validate protocol payloads;
- JSON and MessagePack encoding rules;
- ownership boundaries for state synchronization, assets, screenshots,
  parameters, actions, charts, environments, layers, and layer items.

Protocol v0.2 does not define:

- a concrete WebSocket, postMessage, or SSE implementation;
- renderer-specific Scenario stores or project UI state;
- React, Zustand, Tauri, browser file-system behavior, or layout state;
- drawing libraries, canvas layers, charts, or component rendering.

## Architectural Model

Protocol v0.2 is organized around one rule:

**The renderer owns synchronized session state; the simulator is a stateless
step executor and update producer.**

The simulator owns the simulation model and emits updates. The renderer owns
the synchronized Scenario-like state that can be replayed, inspected, rendered,
snapshotted, and reconnected. Reconnection is therefore not a special hidden
mode: it is a protocol-level state-sync transaction.

This split keeps the protocol independent of deployment shape. A simulator may
run in Python, Julia, Go, Node, a worker, or a process behind WebSocket. A
renderer may be a browser app, desktop shell, benchmark harness, or headless
agent. The payload contract stays the same.

## Naming

Protocol v0.2 uses renderer/simulator terminology. Older client/server names
are not part of the v0.2 contract.

| Old term | v0.2 term |
| --- | --- |
| client | renderer |
| server | simulator |
| server -> client | simulator -> renderer |
| client -> server | renderer -> simulator |

## Message Families

Simulator-to-renderer messages:

- scenario metadata and sync boundaries: `metadata_update`,
  `state_sync_begin`, `state_sync_end`;
- controls: `action_create`, `action_update`, `action_delete`, `action_end`,
  `param_create`, `param_update`, `param_delete`, `param_sync`;
- environments and layers: `env_create`, `env_delete`, `env_layer_create`,
  `env_layer_update`, `env_layer_delete`;
- layer items: `item_create`, `item_update`, `item_delete`;
- charts, assets, screenshots, and diagnostics: `chart_create`,
  `chart_update`, `chart_delete`, `asset_meta`, `asset_data`,
  `asset_delete`, `screenshot_request`, `log`, `error`.

Renderer-to-simulator messages:

- `state_sync`;
- `param_change`;
- `action_start`;
- `asset_sync`;
- `screenshot_response`;
- `error`.

## Event Loop

Continuous simulation is renderer-driven:

1. The renderer sends `action_start` for a continuous action.
2. The simulator advances its model and emits state updates.
3. The simulator sends `action_end` with timing metadata and an optional
   `continue` flag.
4. The renderer decides whether to schedule the next `action_start`.

This avoids a simulator-owned hidden loop. The renderer can pause, throttle,
drop frames, reconnect, or cancel continuous actions without inventing a second
control channel.

## State Sync

`state_sync` is a renderer-to-simulator request containing the renderer's
current definitions for parameters, actions, environments, layers, and charts.
The simulator replies by replaying the required create/update/delete messages.

That replay is bracketed by `state_sync_begin` and `state_sync_end`, making
initial sync and reconnect a transaction rather than a timing convention.

## Binary Payloads

The protocol has binary semantic fields, notably `asset_data.data` and
`screenshot_response.data`.

JSON transports encode those fields as base64 data URLs. MessagePack transports
preserve bytes as `Uint8Array`. The codec normalizes both directions so callers
work with the same semantic message shape.

See [src/codec.ts](./src/codec.ts) and [src/binary.ts](./src/binary.ts).

## Package Boundary

`@tensnap/protocol` is a dependency of higher-level packages:

- `@tensnap/core` owns renderer-side Scenario/session/runtime behavior, rendering primitives, and stores.
- `@tensnap/js` owns JavaScript simulator-side helpers and transports.
- `@tensnap/agent` hosts core's renderer session for node-side automation and bounded runs.
- application packages own concrete UI and deployment behavior.

Those packages should import payload types and codecs directly from
`@tensnap/protocol`; `@tensnap/core` is not a compatibility alias for protocol.
