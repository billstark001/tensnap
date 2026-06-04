# JavaScript API Reference

This reference describes the current workspace-private `@tensnap/js` package.
It provides simulator-side helpers for protocol v0.2, not renderer widgets.

The package exports four groups:

- `@tensnap/js/bindings`: declarative model and example builders.
- `@tensnap/js/runtime`: low-level `SimulatorSession` and `SimulatorEmitter`.
- `@tensnap/js/scenario`: `ScenarioRegistry` replay helpers.
- `@tensnap/js/transport`: postMessage and WebSocket simulator hosts.

## Quick Start

```ts
import {
  createWebSocketTransportHost,
  defineCharts,
  defineEnvironment,
  defineLayer,
  defineModel,
  defineParameters,
} from '@tensnap/js';

interface Config {
  speed: number;
}

interface Agent {
  id: string;
  x: number;
  y: number;
}

const binding = defineModel<Config, { tick: number; agents: Agent[] }>({
  defaults: { speed: 1 },
  parameters: (config) => defineParameters({
    id: 'speed',
    type: 'number',
    label: 'Speed',
    value: config.speed,
    min: 0,
    max: 5,
    step: 0.5,
    allowRuntimeChange: true,
  }),
  environments: [
    defineEnvironment({
      id: 'main',
      type: '2d',
      layers: [defineLayer({ layerId: 'agents', layerType: 'agent' })],
    }),
  ],
  charts: defineCharts({ id: 'count', label: 'Count', color: '#2563eb' }),
  create() {
    return { tick: 0, agents: [{ id: 'a1', x: 0, y: 0 }] };
  },
  async sync(model, ctx) {
    await ctx.setTime(model.tick);
    await ctx.syncItems('main', 'agents', model.agents);
    await ctx.setChartValues({ count: model.agents.length }, model.tick);
  },
  async step(model, ctx) {
    model.tick += 1;
    model.agents[0].x += ctx.getConfig().speed;
    await ctx.sync();
    return true;
  },
  async reset(model, ctx) {
    model.tick = 0;
    model.agents = [{ id: 'a1', x: 0, y: 0 }];
    await ctx.sync();
    await ctx.clearAllCharts();
  },
});

const host = createWebSocketTransportHost({
  serverOptions: { port: 8765 },
  sessionFactory: () => binding.createSession(),
});

console.log(host.url);
```

## Declarative Bindings

### `defineModel(options)`

`defineModel(...)` returns a `DeclarativeModelBinding` with:

- `createScenario(config?)`: build a static scenario definition for inspection or manifests.
- `createSession(config?)`: create a protocol session that can be attached to a transport.

Important options:

- `defaults`: default config merged with per-session overrides.
- `parameters`, `actions`, `environments`, `charts`: static arrays or factories that receive the current config.
- `create(config)`: construct the model object for one session.
- `getConfig(model, initialConfig)`: expose model-normalized config values.
- `init`, `dispose`, `sync`, `step`, `reset`: lifecycle callbacks.
- `onParameterChange`, `onAction`, `onAssetSync`: protocol event hooks.

If `actions` is omitted, `defineModel(...)` registers the default renderer-driven
`start`, `step`, and `reset` actions. If `actions` is provided, it replaces that
default list.

### `defineExample(metadata, options)`

`defineExample(...)` merges arbitrary metadata with the `defineModel(...)`
result. The JavaScript examples use this shape so manifests can expose `id`,
`name`, `description`, `createScenario(...)`, and `createSession(...)` from one
object.

### Metadata Helpers

- `defineParameters(...parameters)`
- `defineActions(...actions)`
- `defineCharts(...charts)`
- `defineLayer(layer)`
- `defineEnvironment(environment)`
- `defineScenario(definition)`

These helpers clone shallow protocol objects so example definitions do not share
mutable metadata by accident.

`defineCharts` accepts protocol `dataList` metadata for grouped charts:

```ts
const charts = defineCharts({
  id: 'evacuation_counts',
  label: 'Evacuation Counts',
  dataList: [
    { id: 'alive', label: 'Alive', color: '#f59e0b' },
    { id: 'evacuated', label: 'Evacuated', color: '#16a34a' },
    { id: 'dead', label: 'Dead', color: '#9ca3af' },
  ],
});

await ctx.setChartValues({ alive: 12, evacuated: 8, dead: 1 }, model.tick);
```

## `ModelSessionContext`

`sync`, `step`, `reset`, and protocol hooks receive a context with:

- `session`, `emitter`, and `registry`.
- `getConfig()` for current config values.
- `replayDefinition()` and `sync()` for full metadata/state replay.
- `refreshParameters(ids?)` for parameter create/update/delete after config normalization.
- `setTime(...)`, `metadata(...)`, `setChartValues(...)`, `updateCharts(...)`, `clearCharts(...)`, and `clearAllCharts()`.
- `createItems(...)`, `updateItems(...)`, `deleteItems(...)`, and `syncItems(...)`.
- `finishAction(...)` for custom action handling.
- `publishAsset(...)`, `syncAssets(...)`, and `clearPublishedAssets()`.

`syncItems(...)` accepts the full current item list and tracks per-layer item
snapshots internally. It sends creates, field-level updates for changed existing
items, and deletes for missing ids. Use `createItems(...)`, `updateItems(...)`,
and `deleteItems(...)` when the model already knows the exact incremental item
operations to emit.

## Runtime API

### `SimulatorSession`

`SimulatorSession` owns one renderer connection. Attach a sender with
`session.attach(sender, connectionId?)`, call `session.open(...)` on connect,
dispatch renderer messages with `session.dispatch(message)`, and close with
`session.close()`.

Handlers include:

- `onConnect`, `onDisconnect`
- `onRendererMessage`
- `onStateSync`
- `onParamChange`
- `onActionStart`
- `onAssetSync`
- `onScreenshotResponse`
- `onError`

### `SimulatorEmitter`

`SimulatorEmitter` sends simulator-to-renderer protocol messages:

- metadata and state-sync: `metadataUpdate`, `stateSyncBegin`, `stateSyncEnd`
- controls: `actionCreate`, `actionUpdate`, `actionDelete`, `actionEnd`, `paramCreate`, `paramUpdate`, `paramDelete`, `paramSync`
- environment state: `envCreate`, `envDelete`, `envLayerCreate`, `envLayerUpdate`, `envLayerDelete`, `itemCreate`, `itemUpdate`, `itemDelete`
- charts/assets/screenshots/logging: `chartCreate`, `chartUpdate`, `chartDelete`, `assetMeta`, `assetData`, `assetDelete`, `screenshotRequest`, `log`, `error`

## Scenario Registry

`ScenarioRegistry.from(definition)` stores parameters, actions, environments,
layers, and charts. `registry.replay(emitter)` emits the corresponding
`*_create` messages. `registry.createSession(...)` creates a low-level session
whose `state_sync` handler brackets `registry.replay(...)` with
`state_sync_begin` and `state_sync_end`.

## Transport Hosts

### WebSocket

```ts
const host = createWebSocketTransportHost({
  serverOptions: { port: 8765 },
  encoding: 'json',
  sessionFactory: () => binding.createSession(),
});

await host.close();
```

`encoding` accepts the protocol encodings supported by `@tensnap/core`.

### postMessage

Use `createPostMessageSimulatorHost(...)` when the simulator runs in a worker,
iframe, or in-memory linked endpoint.

```ts
const { renderer, simulator } = createLinkedEndpoints();
const host = createPostMessageSimulatorHost({
  endpoint: simulator,
  session: binding.createSession(),
});
```

Endpoint adapters:

- `adaptMessagePort(port)`
- `adaptWorker(worker)`
- `createLinkedEndpoints()`

## Examples

The runnable JavaScript examples live in `examples/js`. They are the reference
for built-in manifests, in-memory transports, postMessage transports, and local
WebSocket demo servers.

```bash
pnpm dev:js:schelling
pnpm dev:js:wolf-sheep
pnpm dev:js:axelrod
pnpm dev:js:tornberg
```
