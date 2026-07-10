# @tensnap/core

Framework-agnostic renderer state, runtime, and rendering package for TenSnap.
It depends on `@leafer-ui/core`, `d3`, and the protocol package.

Runtime bindings stay in consumer packages: browser renderers import `leafer-ui`, and node-side renderers import `@leafer-ui/node`.

## Modules

| Import path | Contents |
| --- | --- |
| `@tensnap/core/chart` | `LineChartView`, `ChartStorage`, chart types |
| `@tensnap/core/environment` | `EnvironmentView`, storage classes, layer classes, environment types |
| `@tensnap/core/parameter` | Parameter range utilities and types |
| `@tensnap/core/runtime` | `RendererSession`, `RunController`, pipeline helpers, bounded condition scope |
| `@tensnap/core/utils` | Format detection, msgpack, NumPy (`.npy`) parser/renderer |

## Shared runtime

`RendererSession` is the only renderer-side transport/session implementation
used by the browser and headless agent hosts. It applies protocol messages to a
`Scenario`, preserves state-sync as one UI commit at `state_sync_end`, requests
missing assets, handles screenshot responses, and owns a `RunController`.

`RunController` drives one renderer-dispatched action at a time. Every run
requires a finite `maxSteps` (default policy limit: 1,000,000); an optional
`stopWhen` expression is evaluated before the first action and after each
`action_end`. The scope is read-only and incremental (`steps`, `time`,
metadata, parameters, charts, `agent()`, and `agentCount()`), so it never needs
to call `Scenario.dump()` in the tick path.

## Usage

### Line chart

```typescript
import { LineChartView, ChartDataPoint } from "@tensnap/web-core/chart';

const chart = new LineChartView(container, {
  lines: [
    { key: 'a', name: 'Series A', color: '#4e79a7', strokeWidth: 1.5 },
  ],
  showGrid: true,
  showXAxis: true,
  showYAxis: true,
});

const data: ChartDataPoint[] = [
  { time: Date.now(), a: 42 },
];
chart.updateData(data);
```

### Environment view — graph mode

```typescript
import {
  EnvironmentView,
  AgentStorage, EdgeStorage, BackgroundStorage,
  BackgroundLayer, EdgeLayer, AgentLayer,
  AgentRenderState, GraphEdge,
} from "@tensnap/web-core/environment';

const view       = new EnvironmentView(container);
const agentStore = new AgentStorage();
const edgeStore  = new EdgeStorage(edges);
const bgStore    = new BackgroundStorage();

view.addLayer(new BackgroundLayer(view, bgStore));
const edgeLayer = new EdgeLayer(view, edgeStore, agentStore);
view.addLayer(edgeLayer);
view.addLayer(new AgentLayer(view, agentStore, {
  ...edgeLayer.buildDragHandlers(),
}));

agentStore.setAgents(myAgents);
edgeStore.setEdges(myEdges);
```

### Environment view — grid mode

```typescript
import {
  EnvironmentView,
  GridEnvStorage, AgentStorage, BackgroundStorage,
  BackgroundLayer, GridLayer, AgentLayer,
} from "@tensnap/web-core/environment';

const view        = new EnvironmentView(container);
const gridStore   = new GridEnvStorage({ width: 50, height: 50 });
const agentStore  = new AgentStorage();
const bgStore     = new BackgroundStorage();

view.addLayer(new BackgroundLayer(view, bgStore));
view.addLayer(new GridLayer(view, gridStore));
view.addLayer(new AgentLayer(view, agentStore, { clickable: true }, gridStore));

agentStore.setAgents(myAgents);
```

## Architecture

```
EnvironmentView  (owns a Leafer instance + resize handling)
  ├─ BackgroundLayer  (z:  0)  ← BackgroundStorage
  ├─ GridLayer        (z: 10)  ← GridEnvStorage
  ├─ EdgeLayer        (z: 20)  ← EdgeStorage + AgentStorage  [drives d3-force]
  └─ AgentLayer       (z: 30)  ← AgentStorage [+ GridEnvStorage in grid mode]
```

Storage classes are reactive data containers. Layers subscribe to them and re-render on change. `EdgeLayer` runs d3-force layout and writes computed positions back to `AgentStorage`.

## Testing & Benchmarks

```bash
# Vitest unit tests
pnpm test

# Interactive browser benchmarks (Vite dev server)
pnpm benchmark
```

The benchmark suite (`src-benchmark/`) covers: multi-line chart updates, bouncing-particle agent rendering, spring-layout graph, Schelling segregation model, and Wolf–Sheep predator–prey model.
