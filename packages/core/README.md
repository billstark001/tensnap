# @tensnap/core

Framework-agnostic renderer state, runtime, and rendering package for TenSnap. It depends on `@leafer-ui/core`, `d3`, and the protocol package.

Runtime bindings stay in consumer packages: browser renderers import `leafer-ui`, and node-side renderers import `@leafer-ui/node`. Import wire-facing layer schemas and item types from `@tensnap/protocol/layers`; core exposes only renderer-owned storage, layout, and view state.

Workspace imports use TypeScript source. `pnpm build` produces ESM and declaration files in `dist/` for npm consumers; the `js-publish` workflow can publish that artifact when core is selected in a manual batch after its first npm publish and Trusted Publisher setup. Pushing `core-vX.Y.Z` alone does not publish it. See the [versioning guide](../../docs/maintainer-guide/versioning.md) for release steps.

## Modules

| Import path | Contents |
| --- | --- |
| `@tensnap/core/chart` | DOM-free `ChartScene`, `ChartStorage`, chart types |
| `@tensnap/core/chart/browser` | Browser `BrowserChartView` host |
| `@tensnap/core/environment` | storage classes, layer classes, and renderer-owned environment types |
| `@tensnap/core/environment/browser` | browser `EnvironmentView` host |
| `@tensnap/core/parameter` | parameter normalization and numeric range utilities |
| `@tensnap/core/runtime` | `RendererClient`, `RendererSession`, `RunController`, pipeline helpers, bounded condition scope |
| `@tensnap/core/snapshot` | recording, keyframes, compressed archive segments, and seekable replay helpers |
| `@tensnap/core/utils` | Format detection, msgpack, NumPy (`.npy`) parser/renderer |

## Shared runtime

`RendererSession` is the shared renderer-side protocol session used by the browser and headless agent hosts. It applies protocol messages to a `Scenario`, preserves state-sync as one UI commit at `state_sync_end`, requests missing assets, handles screenshot responses, and owns a `RunController`.

`RendererClient` owns transport connection changes around a session. Its `replaceTransport` method keeps the current source active until the candidate completes its handshake, then replays buffered candidate messages in order. Hosts that already own a `RendererSession` can pass it as `session` to preserve their render barrier and event subscriptions.

`RunController` drives one renderer-dispatched action at a time. Bounded runs require an explicit `mode: 'bounded'` and finite `maxSteps` (default policy limit: 1,000,000); manual runs use `mode: 'manual'` and continue until paused. An optional `stopWhen` expression is evaluated before the first bounded action and after each `action_result`. The scope is read-only and incremental (`steps`, `time`, metadata, parameters, charts, `agent()`, and `agentCount()`), so it never needs to call `Scenario.dump()` in the tick path.

Run status separates `dispatchedActions`, `completedActions`, `succeededActions`, and `failedActions`. Completion counts matching results even when model time stays unchanged; `completedActions = succeededActions + failedActions`. The public `completedSteps` field remains as a deprecated synonym for completion count, and the public `maxSteps` quota still limits completed actions. `lastAction` records its request ID, action/lifecycle source, result, and observed model times.

`state: 'stopped' | 'paused'` stops dispatch; `settled` additionally waits for the final host barrier and any declared stop hook. `onRunStop` retains its dispatch-stop meaning; use `onRunSettled`, the session's `run:settled` event, or `run.waitForSettled(runId, timeoutMs, signal)` for cleanup completion. A wait timeout/abort cancels only the wait. `getRun(runId)` retains the last 100 settled summaries in memory, while the active run is always queryable. Unknown/expired IDs reject immediately. Disconnects/action timeouts preserve `stateKnown: false` and never fabricate a completed action. In manual render mode settlement does not imply that images were generated.

`stopReasons` keeps every observed reason. `primaryFailure` and the compatible `stopReason` prioritize disconnected, action-timeout, validation-error, action-error, condition-error, then render-error over normal quota/condition/pause reasons. Run recording closes at settlement, includes the stop hook's visible updates, and labels its action frame with `source: 'lifecycle'`.

A host render barrier is part of the run contract. If it rejects, the controller reports the host error, marks that run with `render-error`, and releases the pipeline rather than leaving an unhandled rejection or a stalled continuous action. A failure on the final quota action is still reported. `RendererClient.invokeAction()` rejects with `ActionRenderError` on a failed host barrier, preserving the correlated simulator `result` on the error.

## Recordings and project archives

`SnapshotRecorder` captures atomic frames at `action_result` (plus explicit control/sync frames), with adaptive keyframes and a strict retention budget. It coalesces repeated item changes only when no live layer depends on their intermediate mutations; dependent trajectories need every source update to replay the same path. Layer replacement also separates coalescing batches. The live `Snapshot` stays convenient for replay APIs. Use `encodeSnapshotArchive(snapshot)` before persistence to create independently decodable MessagePack segments; each segment carries a complete base keyframe and uses lossless byte compression when it reduces size. The matching `decodeSnapshotArchive(archive)` restores the normal in-memory replay shape.

Layer policies (`delta`, `keyframe`, `adaptive`, and `derived`) select the built-in recording behavior. `RecordingOptions.layerCodecImplementations` can replace that policy with a concrete host/application codec instead of treating the policy label as a serialization implementation.

The web project format is version 3. It puts resolved asset bytes in one project-level content-addressed table keyed by protocol hash, so live state, recording keyframes, and asset-data frames do not repeat the same data URL. Version-0, version-1, and version-2 project files remain readable and are upgraded in memory.

## Usage

### Browser chart

```typescript
import { BrowserChartView } from '@tensnap/core/chart/browser';
import type { ChartDataPoint } from '@tensnap/core/chart';

const chart = new BrowserChartView(container, {
  lines: [{ key: 'a', name: 'Series A', color: '#4e79a7', strokeWidth: 1.5 }],
  showGrid: true,
  showXAxis: true,
  showYAxis: true,
});
chart.resize(600, 400);

const data: ChartDataPoint[] = [{ time: Date.now(), a: 42 }];
chart.updateData(data);
```

### Environment view — graph mode

```typescript
import { EnvironmentView } from '@tensnap/core/environment/browser';
import {
  AgentStorage,
  EdgeStorage,
  BackgroundStorage,
  BackgroundLayer,
  EdgeLayer,
  AgentLayer,
  AgentRenderState,
  GraphEdge,
} from '@tensnap/core/environment';

const view = new EnvironmentView(container);
const agentStore = new AgentStorage();
const edgeStore = new EdgeStorage(edges);
const bgStore = new BackgroundStorage();

view.addLayer(new BackgroundLayer(bgStore));
const edgeLayer = new EdgeLayer(edgeStore, agentStore);
view.addLayer(edgeLayer);
view.addLayer(
  new AgentLayer(agentStore, {
    ...edgeLayer.buildDragHandlers(),
  }),
);

agentStore.setAgents(myAgents);
edgeStore.setEdges(myEdges);
```

### Environment view — grid mode

```typescript
import { EnvironmentView } from '@tensnap/core/environment/browser';
import {
  GridEnvStorage,
  AgentStorage,
  BackgroundStorage,
  BackgroundLayer,
  GridLayer,
  AgentLayer,
} from '@tensnap/core/environment';

const view = new EnvironmentView(container);
const gridStore = new GridEnvStorage({ width: 50, height: 50 });
const agentStore = new AgentStorage();
const bgStore = new BackgroundStorage();

view.addLayer(new BackgroundLayer(bgStore));
view.addLayer(new GridLayer(gridStore));
view.addLayer(new AgentLayer(agentStore, { clickable: true }));

agentStore.setAgents(myAgents);
```

## Architecture

```
EnvironmentView  (owns a Leafer instance + resize handling)
  ├─ BackgroundLayer  (z:  0)  ← BackgroundStorage
  ├─ GridLayer        (z: 10)  ← GridEnvStorage
  ├─ EdgeLayer        (z: 20)  ← EdgeStorage + AgentStorage  [drives d3-force]
  └─ AgentLayer       (z: 40)  ← AgentStorage [+ GridEnvStorage in grid mode]
```

Storage classes are reactive data containers. Layers subscribe to them and re-render on change. `EdgeLayer` runs d3-force layout and writes computed positions back to `AgentStorage`. `BackgroundStorage` revokes only blob URLs it created from raw image bytes; asset URLs passed in from `AssetStore` remain owned by the asset store.

## Testing & Benchmarks

```bash
# Vitest unit tests (from packages/core/)
pnpm test

# Browser benchmark profiles (from the repository root)
pnpm bench:browser:all
```

The benchmark app contains three suites:

- six production Web component cases without transport (chart, particles, spring graph, dense grid, trajectories, and uniform agents);
- Axelrod, Schelling, and Wolf–Sheep through the full Web transport/session/UI path;
- one seeded random walk through raw Leafer, core layers without transport, and the full Web transport path.

These diagnostic suites are distinct from the locked paper evaluation; use [the evaluation guide](../../benchmarks/evaluation/README.md) for its current profiles and published archives. All suites report cycle latency/TPS under the Web render-trigger settings. No-transport cases also report mutation cost, while complete models preserve their actual completed-step count and simulator stop reason.

## Recording and storage ownership

`SnapshotRecorder.start(options)` validates the new options and baseline byte budget before replacing an active recording. `maxSteps` and `keyframeEvery` must be positive safe integers; `maxBytes` and `maxDurationMs` must be positive finite numbers. Omit a limit to disable it rather than passing zero or infinity. Invalid replacement options leave the active recording intact. Layer codec maps and implementation descriptors are copied at start; callbacks remain callable policies. Queued control flushes belong to their recording and wait for an in-flight action result.

Storage loaders publish complete replacements. A failed trajectory load preserves its previous data and configurations; a successful load replaces stale configuration and emits one change notification. Removed edges release empty adjacency buckets so repeated topology churn does not retain old IDs.
