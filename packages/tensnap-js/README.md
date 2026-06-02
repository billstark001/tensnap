# @tensnap/js

JavaScript/TypeScript simulator-side bindings for TenSnap protocol v0.2.

This package can be published from `packages/tensnap-js` with:

```bash
pnpm build
pnpm publish
```

## What It Provides

- Declarative model builders: `defineModel(...)` and `defineExample(...)`.
- Metadata helpers for parameters, actions, charts, environments, and layers.
- Low-level runtime primitives: `SimulatorSession` and `SimulatorEmitter`.
- Scenario replay helpers through `ScenarioRegistry`.
- Simulator hosts for WebSocket and postMessage transports.

## Minimal WebSocket Server

```ts
import {
  createWebSocketTransportHost,
  defineEnvironment,
  defineLayer,
  defineModel,
} from '@tensnap/js';

const binding = defineModel({
  environments: [
    defineEnvironment({
      id: 'main',
      type: '2d',
      layers: [defineLayer({ layerId: 'agents', layerType: 'agent' })],
    }),
  ],
  create() {
    return { tick: 0, agents: [{ id: 'a1', x: 0, y: 0 }] };
  },
  async sync(model, ctx) {
    await ctx.setTime(model.tick);
    await ctx.syncItems('main', 'agents', model.agents);
  },
  async step(model, ctx) {
    model.tick += 1;
    model.agents[0].x += 1;
    await ctx.sync();
    return true;
  },
});

const host = createWebSocketTransportHost({
  serverOptions: { port: 8765 },
  sessionFactory: () => binding.createSession(),
});

console.log(host.url);
```

When `actions` is omitted, `defineModel(...)` registers `start`, `step`, and
`reset`. `start` is continuous-capable and uses the boolean returned by `step` to
decide whether the renderer may continue dispatching.

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
