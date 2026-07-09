# JavaScript API Reference

This reference describes the `@tensnap/js` package. It provides simulator-side
bindings for protocol v0.2, not renderer widgets.

The package exports four groups:

- `@tensnap/js/bindings`: declarative model builders and low-level metadata helpers.
- `@tensnap/js/runtime`: low-level `SimulatorSession` and `SimulatorEmitter`.
- `@tensnap/js/scenario`: `ScenarioRegistry` replay helpers.
- `@tensnap/js/transport`: postMessage and WebSocket simulator hosts.

## Quick Start

```ts
import {
  createWebSocketTransportHost,
  modelBuilder,
  numberField,
} from '@tensnap/js';

interface Config {
  speed: number;
}

interface Agent {
  id: string;
  x: number;
  y: number;
}

interface DemoModel {
  tick: number;
  config: Config;
  agents: Agent[];
}

const builder = modelBuilder<Config, DemoModel>({
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
  reset(model) {
    model.tick = 0;
    model.agents = [{ id: 'a1', x: 0, y: 0 }];
  },
  time(model) {
    return model.tick;
  },
});

builder.paramsFromConfig<Config>({
  get: (model) => model.config,
  set(model, patch) {
    Object.assign(model.config, patch);
  },
  fields: {
    speed: numberField({ label: 'Speed' }),
  },
});

builder.env('main')
  .agentLayer<Agent>('agents', {
    items: (model) => model.agents,
  });

builder.chart('count', {
  label: 'Agents',
  color: '#2563eb',
  get: (model) => model.agents.length,
});

const binding = builder.build();

const host = createWebSocketTransportHost({
  serverOptions: { port: 8765 },
  sessionFactory: () => binding.createSession(),
});

console.log(host.url);
```

## Declarative Builder

### `modelBuilder(metadata, options)`

`modelBuilder(...)` returns a fluent `ModelBuilder`. Calling `build()` returns an
object that combines the supplied metadata with:

- `createScenario(config?)`: build a static scenario definition for inspection or manifests.
- `createSession(config?)`: create a protocol session that can be attached to a transport.

Important options:

- `defaults`: optional default config merged with per-session overrides.
- `create(config)`: construct the model object for one session.
- `getConfig(model, initialConfig)`: expose model-normalized config values.
- `init`, `dispose`, `step`, `reset`: lifecycle callbacks.
- `time(model)`: expose simulation time; otherwise time increments after each step.
- `lifecycleLabels`: optional labels for built-in `start`, `step`, and `reset`.

The builder registers the renderer-driven lifecycle actions automatically:
`start`, `step`, and `reset`. Custom actions can be added with `.action(...)`.

### Parameters

Use explicit parameter methods for individual controls:

```ts
builder.numberParam('temperature', {
  label: 'Temperature',
  get: (model) => model.temperature,
  set(model, value) {
    model.temperature = value;
  },
});
```

Use `paramsFromConfig(...)` when model configuration is a plain object:

```ts
builder.paramsFromConfig<Config>({
  get: (model) => model.config,
  set(model, patch) {
    Object.assign(model.config, patch);
  },
  fields: {
    speed: numberField({ label: 'Speed' }),
  },
});
```

`numberField(...)` accepts optional `min`, `max`, `step`, and `integer` hints.
Leave them undefined when the renderer can infer a reasonable range. Provide
them when the simulator must clamp, round, or express a domain-specific bound.

Field helpers:

- `numberField(options?)`
- `booleanField(options?)`
- `stringField(options?)`
- `enumField({ options, labels?, ... })`

If `fields` is omitted, `paramsFromConfig(...)` infers number, boolean, and
string controls from the current config object.

### Environments And Layers

`builder.env(id, options?)` creates an environment builder. Layer methods mutate
that environment builder and return it, so related layer declarations stay
grouped. Use `.done()` only when chaining back to the parent model builder.

```ts
builder.env('main')
  .gridLayer('grid', {
    data: (model) => ({ width: model.width, height: model.height }),
  })
  .agentLayer('agents', {
    data: (model) => ({ width: model.width, height: model.height }),
    items: (model) => model.agents,
  })
  .edgeLayer('links', {
    items: (model) => model.links,
    key: ['source', 'target'],
  });
```

Layer `items(...)` returns the current authoritative item list. The binding
tracks previous records and emits creates, field-level updates, and deletes.

For models that already know exact incremental changes, declare `updates(...)`.
When a layer has `updates(...)`, the binding sends update records after the
initial full sync and reset.

`projectFields(...)` is useful when the model object shape does not match the
renderer item shape:

```ts
import { literal, projectFields } from '@tensnap/js/bindings';

builder.env('main').agentLayer('agents', {
  items: (model) => model.people,
  project: projectFields({
    id: 'id',
    x: 'position.x',
    y: 'position.y',
    color: literal('#2563eb'),
  }),
});
```

### Charts

Single series:

```ts
builder.chart('count', {
  label: 'Count',
  color: '#2563eb',
  get: (model) => model.agents.length,
});
```

Grouped series:

```ts
builder.chartGroup('population', {
  series: [
    { id: 'sheep', label: 'Sheep', color: '#ffffff', get: (model) => model.sheep },
    { id: 'wolves', label: 'Wolves', color: '#111111', get: (model) => model.wolves },
  ],
});
```

### Actions And Assets

Custom actions:

```ts
builder.action('shuffle', {
  label: 'Shuffle',
  run(model) {
    model.shuffle();
  },
});
```

Static or model-derived assets:

```ts
builder.asset('wolf-sheep:sheep', {
  mime: 'image/svg+xml',
  label: 'Sheep',
  data: sheepSvg,
});
```

Use `assetIcon(id)` for agent icons that reference declared assets.

## Low-Level Metadata Helpers

The package still exports raw protocol helpers for tests, transport fixtures, and
advanced integrations that already manage their own session lifecycle:

- `defineScenario(definition)`
- `defineParameters(...parameters)`
- `defineActions(...actions)`
- `defineCharts(...charts)`
- `defineLayer(layer)`
- `defineEnvironment(environment)`

These helpers clone shallow protocol objects so definitions do not share mutable
metadata by accident. They are not aliases for the model builder and are not the
recommended authoring API for new examples.

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
```

## `ModelSessionContext`

Lifecycle callbacks and custom actions receive a context with:

- `session`, `emitter`, and `registry`.
- `getConfig()` for current config values.
- `replayDefinition()` and `sync()` for full metadata/state replay.
- `refreshParameters(ids?)` for parameter create/update/delete after config normalization.
- `setTime(...)`, `metadata(...)`, `setChartValues(...)`, `updateCharts(...)`, `clearCharts(...)`, and `clearAllCharts()`.
- `createItems(...)`, `updateItems(...)`, `deleteItems(...)`, `syncRecords(...)`, and `syncItems(...)`.
- `finishAction(...)` for custom action handling.
- `publishAsset(...)`, `syncAssets(...)`, and `clearPublishedAssets()`.

Most models do not need to call `sync()` manually. The builder publishes
declared assets, layers, charts, parameters, and time after connect, state sync,
step, reset, accepted parameter changes, and synced custom actions.

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

`encoding` accepts the protocol encodings supported by `@tensnap/protocol`.

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
