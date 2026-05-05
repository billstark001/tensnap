# TenSnap JavaScript Examples

This workspace package is the new home for runnable JavaScript examples and built-in local simulator manifests.

Current scope:

- own the built-in JS example manifest
- expose websocket demo entrypoints for local hosts
- expose bundled in-memory and postMessage transports for browser consumers
- provide transport-driven benchmark cases shared by the benchmark package
- host declarative example definitions built on native `@tensnap/js` sessions

The package now contains the moved model sources, declarative renderer definitions, manifest registration, and benchmark harnesses used by the main web and benchmark workspaces.

## Authoring Style

Built-in JS examples no longer define a package-local adapter layer. Each renderer exports a single example object created with `defineExample(...)`, while `@tensnap/js` keeps ownership of session, registry, and protocol orchestration.

```ts
import {
 defineCharts,
 defineExample,
 defineEnvironment,
 defineLayer,
 defineParameters,
} from '@tensnap/js/bindings';

export const MY_EXAMPLE = defineExample({
 id: 'demo',
 name: 'Demo',
 description: 'Example description.',
}, {
 defaults: { speed: 1 },
 parameters: (config) => defineParameters({
  id: 'speed',
  type: 'number',
  label: 'Speed',
  value: config.speed,
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
 create(config) {
  return { tick: 0, speed: config.speed };
 },
 async sync(model, ctx) {
  await ctx.syncItems('main', 'agents', [{ id: 'agent-1', x: model.tick, y: 0 }]);
  await ctx.setTime(model.tick);
  await ctx.setChartValues({ count: model.tick }, model.tick);
 },
});
```

For most examples, renderer authors only need to declare metadata, parameters, environments, and the `sync` / `step` / `reset` callbacks. `defineExample(...)` exposes `createScenario(...)` and `createSession(...)` for manifests and transports, so renderer files do not need to hand-roll wrapper exports anymore.
