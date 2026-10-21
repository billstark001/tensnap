# TenSnap JavaScript Examples

This workspace package is the home for runnable JavaScript examples and built-in local simulator manifests.

Current scope:

- own the built-in JS example manifest
- expose websocket demo entrypoints for local hosts
- expose a standalone Schelling study CLI
- expose bundled in-memory and postMessage transports for browser consumers
- host declarative example definitions built on native `@tensnap/js` sessions

The Axelrod example binds its native `agents[row][col]` matrix through `.matrixAgentLayer(...)`, including validated scene restore of cell values and `total_updates` metadata. It also uses paired `checkpoint: { capture, restore }` hooks. The checkpoint includes the private random generator state, so stepping after restore follows the same cultural update path.

The package contains model sources, declarative renderer definitions, and manifest registration used by the main Web workspace. Publication-only kernel and server adapters live in `../../benchmarks/schelling/v1/subjects/js/`; benchmark environment parsing and JSON output are not part of the examples.

The root and `./manifest` exports are browser-safe. `getJsExampleEntries()` provides metadata and `createTransport()` for local browser models. Node hosts start a demo with `startJsExampleWebSocketDemo(id, options)` from `@tensnap/examples-js/entries/main-ws`; the manifest does not expose `startDemoServer`. Browser entry points import simulator endpoint helpers from `@tensnap/js/transport/browser` so Node WebSocket and filesystem dependencies stay out of frontend bundles.

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

`src/standalone/schelling-study.ts` owns the reusable trial/sweep logic. The entry point only parses user options and prints threshold-summary CSV. Benchmark subjects import that same helper and add the publication JSON record.

The split between `entries/`, `standalone/`, `models/`, and `renderers/` is a reuse choice for this repository, not required TenSnap boilerplate. The user-facing entry files stay thin so the benchmark kernel can reuse the study without its JSON adapter entering the example, and the benchmark WebSocket subject can reuse the production example session/host without copying binding logic. A small standalone application may combine these responsibilities.

## Authoring Style

Each renderer exports a single example object produced by `modelBuilder(...).build()`. The builder owns session, registry, lifecycle actions, parameter updates, layer diffs, chart updates, and asset sync.

Each example declares a stable `stateSchemaVersion` and speaks only canonical v0.3 protocol messages; no renderer compatibility conversion is embedded in the models.

```ts
import { modelBuilder, numberField } from '@tensnap/js/bindings';

interface Config {
  speed: number;
}

const builder = modelBuilder<Config, { tick: number; config: Config }>(
  {
    id: 'demo',
    name: 'Demo',
    description: 'Example description.',
    stateSchemaVersion: '1',
  },
  {
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
  },
);

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

Renderer authors should declare metadata, parameters, environments, layers, charts, optional actions, and optional assets. The exported object exposes `createScenario(...)` and `createSession(...)` for manifests and transports, so renderer files do not need wrapper session code.

## IP family

See the [networking guide](../../docs/user-guide/networking.md) for `auto` (default), `ipv4`, and `ipv6` policies, IPv6 URLs, and shared ephemeral ports.

## Randomness and scientific scope

Every built-in example runtime owns its random stream and exposes seed as an ordinary initialization parameter (default 7). Reset repeats the initial experiment; changing seed stages the next reset. Functional model helpers still accept caller-owned RNG functions. No generator is installed in TenSnap core, and model code does not own a browser run timer.

Schelling uses checkpoint schema 3, with both the configured reset seed and current RNG position. Its optional observer is supplied to `createSchellingExample(observe)` and scoped to that definition; the normal manifest has none. The publication subject alone reads the audit environment variable and writes sidecars. Axelrod also supports exact checkpoint continuation. Tornberg and Wolf/Sheep demonstrate seeded reset without advertising exact restore.

Scientific sweep CSV distinguishes `satisfied_runs`, `jammed_runs`, and `limit_runs`; timers, warmup and performance rows live in benchmark subjects. Schelling uses bounded Moore neighborhoods and batch relocation. Axelrod/Tornberg ticks contain `updatesPerTick` asynchronous micro-updates; Tornberg's sorting diagnostics refresh every five ticks. Wolf/Sheep uses continuous wrapped motion with fixed array activation order, a NetLogo-inspired teaching variant rather than a trace-equivalent NetLogo implementation. See the [example guide](../README.md) and [reproducibility contract](../../docs/maintainer-guide/reproducibility.md).
