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
| `@tensnap/core/persistence` | Portable project/recording codecs, resource tables, migration, frame manifests and explicit selection |
| `@tensnap/core/snapshot` | recording, keyframes, compressed archive segments, and seekable replay helpers |
| `@tensnap/core/utils` | Format detection, msgpack, NumPy (`.npy`) parser/renderer |

## Shared runtime

`RendererSession` is the shared renderer-side protocol session used by the browser and headless agent hosts. It applies protocol messages to a `Scenario`, preserves state-sync as one UI commit at `state_sync_end`, requests missing assets, handles screenshot responses, and owns a `RunController`.

`RendererClient` owns transport connection changes around a session. Its `replaceTransport` method keeps the current source active until the candidate completes its handshake, then replays buffered candidate messages in order. Hosts that already own a `RendererSession` can pass it as `session` to preserve their render barrier and event subscriptions.

`RunController` drives one renderer-dispatched action at a time. Bounded runs require an explicit `mode: 'bounded'` and finite `maxSteps` (default policy limit: 1,000,000); manual runs use `mode: 'manual'` and continue until paused. An optional `stopWhen` expression is evaluated before the first bounded action and after each `action_result`. The scope is read-only and incremental (`steps`, `time`, metadata, parameters, charts, `agent()`, and `agentCount()`), so it never needs to call `Scenario.dump()` in the tick path.

Run status separates `dispatchedActions`, `completedActions`, `succeededActions`, and `failedActions`. Completion counts matching results even when model time stays unchanged; `completedActions = succeededActions + failedActions`. The public `completedSteps` field remains as a deprecated synonym for completion count, and the public `maxSteps` quota still limits completed actions. `lastAction` records the target action’s request ID, result, and observed model times; `lastLifecycleAction` separately records cleanup so a successful stop hook cannot overwrite the failed target result.

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

`RunController` owns the values in its run specification and queued action targets/arguments. Returned run statuses own their nested value data. Recording options follow the recorder's policy: copy value data (including checkpoint bytes) and codec descriptors, but retain callable policy functions. Functions and their closed-over application state are not cloned; keep that state stable while the recording uses it. Invocation copying happens before queue mutation, so a copy failure leaves the current run intact. The recorder retains only the policy fields it uses; identity and checkpoint data belong to snapshot metadata.

Startup observers receive their own status copy, separate from the recording configuration used by `RendererSession`. Editing that copy cannot disable or rewrite the requested recording.

`RendererSession` recording events share a read-only snapshot among listeners, including asynchronous persistence hosts. Consumers that need to edit it must copy it first. This event lifetime differs from an independently owned run status.

Storage loaders publish complete replacements. A failed trajectory load preserves its previous data and configurations; a successful load replaces stale configuration and emits one change notification. Removed edges release empty adjacency buckets so repeated topology churn does not retain old IDs.

## Persistence and owned frames

`@tensnap/core/persistence` imports in plain Node without DOM, React, filesystem or browser initialization. `encodeProjectFile`/`decodeProjectFile` retain the released v0/v1/v2 → v3 migrations. `archiveProjectFileContentAsync` accepts a host encoder for worker dispatch; the owned input and resources are prepared before suspension. Layout DTOs and an empty default layout live here; automatic layout belongs to the GUI host.

`encodeRecordingFile`/`decodeRecordingFile` implement `kind: 'tensnap-recording', version: 1`, with an existing SnapshotArchive and an independent asset table. JSON encodes bytes safely; MessagePack retains byte arrays. Parsing validates outer/archive/protocol versions, segment lengths, ordering, retained boundaries and checkpoint/source association. Import reports truncation, budgets, missing assets, external dependencies and whether a legacy path was used. Complete export rejects unresolved resources; explicit `allowIncomplete` permits diagnostic export. Bare Snapshot/Archive imports require `allowLegacy: true`.

`selectRecordingFrame` accepts an exact retained frame or model time plus `first|last|before|after`; results identify actual boundaries. Model-time lookup scans metadata/keyframe boundaries once and does not reconstruct scenes or chart histories. `SnapshotRecorder.inspect()` returns an owned boundary/resource report without copying the retained recording payload. `frameFromRecording` reconstructs chart prefixes and attaches a checkpoint only at its recorded boundary. `snapshotFromFrame` produces an independent single-frame recording with durable original provenance. `assertFrameCheckpoint` checks checkpoint identity/association without cloning or encoding the scene.

`RendererSession.captureFrame({ checkpoint: 'none'|'if-supported'|'required' })` stops run dispatch, awaits lifecycle settlement, copies the scene and verifies revision/source identity across checkpoint capture. Returned nested values and bytes are owned. Required capture rejects unsupported or inconsistent boundaries. `RendererSession.restoreFrame(frame, { mode, chartPolicy, historyTime })` owns its input before waiting, verifies identity/schema again immediately before dispatch, and returns independent model/history status and certainty. Local `historyTime` is never sent on the wire; checkpoint mode sends no projected state. Saved charts are installed only after successful restore. The released low-level payload-time truncate fallback remains supported.

`RendererClient.beginAction` returns a request ID and a completion promise registered before dispatch. `invokeAction` also waits for the host barrier. Hosts that only need settlement can use `beginAction(id, timeoutMs, { retainMessages: false })` to avoid retaining the action’s protocol stream; the default still returns collected messages. Hosts own image rendering, evidence directory commits, file checksums and persistence waits; core does not provide filesystem shims or renderer-specific aliases.
