# TenSnap JavaScript Examples

This workspace package is the home for runnable JavaScript examples and built-in
local simulator manifests.

Current scope:

- own the built-in JS example manifest
- expose websocket demo entrypoints for local hosts
- expose bundled in-memory and postMessage transports for browser consumers
- provide transport-driven benchmark cases shared by the benchmark package
- host declarative example definitions built on native `@tensnap/js` sessions

The package contains model sources, declarative renderer definitions, manifest
registration, and benchmark harnesses used by the main web and benchmark
workspaces.

## Authoring Style

Each renderer exports a single example object produced by `modelBuilder(...).build()`.
The builder owns session, registry, lifecycle actions, parameter updates, layer
diffs, chart updates, and asset sync.

```ts
import {
  modelBuilder,
  numberField,
} from '@tensnap/js/bindings';

interface Config {
  speed: number;
}

const builder = modelBuilder<Config, { tick: number; config: Config }>({
  id: 'demo',
  name: 'Demo',
  description: 'Example description.',
}, {
  defaults: { speed: 1 },
  create(config) {
    return { tick: 0, config: { ...config } };
  },
  getConfig(model) {
    return model.config;
  },
  step(model) {
    model.tick += 1;
    return true;
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

builder.env('main').agentLayer('agents', {
  items: (model) => [{ id: 'agent-1', x: model.tick * model.config.speed, y: 0 }],
});

builder.chart('count', {
  label: 'Count',
  color: '#2563eb',
  get: (model) => model.tick,
});

export const MY_EXAMPLE = builder.build();
```

Renderer authors should declare metadata, parameters, environments, layers,
charts, optional actions, and optional assets. The exported object exposes
`createScenario(...)` and `createSession(...)` for manifests and transports, so
renderer files do not need wrapper session code.
