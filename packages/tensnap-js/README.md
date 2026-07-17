# @tensnap/js

JavaScript/TypeScript simulator-side bindings for the strict TenSnap v0.3 protocol.

This package can be published from `packages/tensnap-js` with:

```bash
pnpm build
pnpm publish
```

## What It Provides

- Declarative model builders through `modelBuilder(...)`.
- Config parameter helpers such as `numberField(...)`, `booleanField(...)`, `stringField(...)`, and `enumField(...)`.
- Low-level protocol metadata helpers for tests and advanced integrations.
- Runtime primitives: `SimulatorSession` and `SimulatorEmitter`.
- Scenario replay helpers through `ScenarioRegistry`.
- Simulator hosts for WebSocket and postMessage transports.

## Minimal WebSocket Server

```ts
import {
  createWebSocketTransportHost,
  modelBuilder,
  numberField,
} from '@tensnap/js';

const builder = modelBuilder({
  id: 'demo',
  name: 'Demo',
  description: 'A minimal JavaScript model.',
  stateSchemaVersion: '1',
}, {
  defaults: { speed: 1 },
  create(config) {
    return {
      tick: 0,
      config: { ...config },
      agents: [{ id: 'a1', x: 0, y: 0 }],
    };
  },
  getConfig(model) {
    return model.config;
  },
  step(model) {
    model.tick += 1;
    model.agents[0].x += model.config.speed;
    return true;
  },
  time(model) {
    return model.tick;
  },
});

builder.paramsFromConfig({
  get: (model) => model.config,
  set(model, patch) {
    Object.assign(model.config, patch);
  },
  fields: {
    speed: numberField({ label: 'Speed' }),
  },
});

builder.env('main').agentLayer('agents', {
  items: (model) => model.agents,
});

const binding = builder.build();

const host = createWebSocketTransportHost({
  serverOptions: { port: 8765 },
  sessionFactory: () => binding.createSession(),
});

console.log(host.url);
```

The builder registers `start`, `step`, `stop`, and `reset` automatically. `start` is
continuous-capable and uses the boolean returned by `step` to decide whether the
renderer may continue dispatching.

Reset reconciles declarations with strict CRUD, clears chart history, and
deletes the previous non-trajectory item set before publishing current state;
stable create-only definitions are not replayed as upserts.

The strict v0.3 binding never translates legacy action or state-sync fields.
Each session sends `simulator_info` before any other simulator message, then
waits for a valid `state_sync` before invoking `init`.

Monitors and scene restore are opt-in: use `.monitor(...)` for current values.
For projected restore, declare `sceneRestore: { mode: 'compose', ... }` and a
layer `restore` object with complete C/U/D callbacks. The binding validates the
full input, applies metadata, deletes dependent layers first, then creates and
updates source layers before replaying canonical state. Use
`sceneRestore: { mode: 'imperative', apply(...) }` only when the model owns the
entire projected restore; it cannot be mixed with declarative layer handlers.

Exact checkpoint support still requires matching `restoreCheckpoint(...)` and
`captureCheckpoint(...)` hooks plus a stable `stateSchemaVersion`, but it does
not require projected restore hooks. Capture hooks
return only model data (`ProtocolValue` or `Uint8Array`); the binding chooses
MessagePack or `application/octet-stream` wire encoding automatically. Restore
hooks receive that decoded model data. Restore replay never sends chart messages.

Trajectory builders expose `length`, `width`, `color`, `zIndex`,
`onAgentDelete`, `onStateSync`, and `onReset` directly. Restore request IDs are
cached, and paired checkpoint hooks also provide rollback if a later restore
phase fails. Create-only state replay is advertised as `replace`, never as a
false reconcile/upsert transaction.

## Transport Options

Use `createWebSocketTransportHost(...)` for a local simulator server.

Use `createPostMessageSimulatorHost(...)` when the simulator runs in a worker,
iframe, or in-memory paired endpoint. `createLinkedEndpoints()` is useful for
tests and bundled examples.

## Runnable Examples

```bash
pnpm dev:js:schelling
pnpm dev:js:wolf-sheep
pnpm dev:js:axelrod
pnpm dev:js:tornberg
```

For the full API surface, see
[`docs/api-reference/js-api.md`](../../docs/api-reference/js-api.md).
