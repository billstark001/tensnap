# TenSnap JavaScript Examples

This workspace package is the home for runnable JavaScript examples and built-in
local simulator manifests.

Current scope:

- own the built-in JS example manifest
- expose websocket demo entrypoints for local hosts
- expose a standalone Schelling study CLI
- expose bundled in-memory and postMessage transports for browser consumers
- host declarative example definitions built on native `@tensnap/js` sessions

The package contains model sources, declarative renderer definitions, and
manifest registration used by the main Web workspace. Publication-only kernel
and server adapters live in
`../../benchmarks/schelling/v1/subjects/js/`; benchmark environment parsing and
JSON output are not part of the examples.

## Schelling entry points

Run the standalone scientific sweep without a renderer:

```bash
pnpm --filter @tensnap/examples-js standalone:schelling --steps 1000 \
  --seeds 8 --thresholds 0.30,0.50,0.70,0.90 --mode convergence
```

Run a configurable WebSocket simulator:

```bash
pnpm --filter @tensnap/examples-js demo:ws schelling \
  --width 60 --height 40 --density 0.8 --balance 0.5 \
  --threshold 0.7 --seed 7 --port 8765 --encoding json
```

`src/standalone/schelling-study.ts` owns the reusable trial/sweep logic. The
entry point only parses user options and prints threshold-summary CSV. Benchmark
subjects import that same helper and add the publication JSON record.

The split between `entries/`, `standalone/`, `models/`, and `renderers/` is a
reuse choice for this repository, not required TenSnap boilerplate. The
user-facing entry files stay thin so the benchmark kernel can reuse the study
without its JSON adapter entering the example, and the benchmark WebSocket
subject can reuse the production example session/host without copying binding
logic. A small standalone application may combine these responsibilities.

## Authoring Style

Each renderer exports a single example object produced by `modelBuilder(...).build()`.
The builder owns session, registry, lifecycle actions, parameter updates, layer
diffs, chart updates, and asset sync.

Each example declares a stable `stateSchemaVersion` and speaks only canonical
v0.3 protocol messages; no renderer compatibility conversion is embedded in
the models.

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
  stateSchemaVersion: '1',
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
