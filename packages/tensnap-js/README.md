# @tensnap/js

JavaScript/TypeScript simulator-side bindings for TenSnap protocol v0.2.

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

The builder registers `start`, `step`, and `reset` automatically. `start` is
continuous-capable and uses the boolean returned by `step` to decide whether the
renderer may continue dispatching.

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
