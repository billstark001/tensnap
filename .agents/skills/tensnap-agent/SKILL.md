---
name: tensnap-agent
description: Operate an existing TenSnap simulator through the CLI, including scene inspection, parameters, bounded runs, recordings, and headless rendering.
license: MIT
metadata:
  runtime: 'Node.js >=22 and the @tensnap/agent CLI'
  author: billstark001
  distribution: '@tensnap/agent'
  repository: 'https://github.com/billstark001/tensnap'
---

# TenSnap Agent

Use this skill to drive a TenSnap simulator through `tensnap-agent`. Run `tensnap-agent --version` first. If the CLI is a project dependency, use `npx --no-install tensnap-agent` in place of `tensnap-agent`. The npm bundle identifies its matching CLI version in this skill’s metadata. If the versions differ, check `tensnap-agent --help` before relying on an option described here.

Consult the bundled [runtime guide](references/docs/user-guide/agent-runtime.md) when handling result contracts, recording persistence, or exit codes. The [protocol specification](references/packages/protocol/SPECIFICATION.md) describes sync and wire semantics. These files work offline without a TenSnap checkout.

## When To Use

- You need to connect to a running simulator and inspect the current scene state.
- You need to trigger one simulator action by id.
- You need to change parameters from an agent workflow.
- You need a bounded continuous run with a condition based on time, charts, metadata, parameters, or agent counts.
- You need an environment render, optionally for a specific viewport.
- You need a long-lived local runtime instead of a one-shot WebSocket client.

## Runtime Model

- Start the daemon once per working context.
- Runtime state is persisted under `.tensnap/contexts/<context>/` by default.
- The daemon exposes local HTTP control endpoints and an SSE event stream.
- The runtime is a Node host for core `RendererSession` and `RunController`. It has no package-local protocol/session lifecycle or action aliases.
- Protocol message shapes, screenshot payloads, asset payloads, and built-in layer item contracts follow the bundled protocol specification. When working in a TenSnap source checkout, `packages/protocol` owns these contracts; generate its current reference with `pnpm --dir packages/protocol export:protocol`.

## Core Commands

Start or reuse a runtime and connect it to a simulator:

```bash
tensnap-agent runtime up --context demo --simulator-url ws://127.0.0.1:8765
```

Inspect runtime status:

```bash
tensnap-agent runtime status --context demo
```

Inspect the synchronized scene:

```bash
tensnap-agent scene inspect --context demo
```

List or update parameters:

```bash
tensnap-agent param list --context demo
tensnap-agent param set infection_rate 0.35 --context demo
```

List or run actions directly by id:

```bash
tensnap-agent action list --context demo
tensnap-agent action run reseed --context demo
```

## Bounded Runs

For a continuous action, use `run start`; `action run` is deliberately a single dispatch. `--max-actions` is required even when a condition is present (`--max-steps` remains a deprecated public spelling; using both is rejected), and the default policy rejects values greater than 1,000,000.

Start the runtime with a higher explicit policy only when the automation workflow requires it:

```bash
tensnap-agent runtime up --context demo --simulator-url ws://127.0.0.1:8765 --max-steps-policy 2000000
```

```bash
tensnap-agent run start start --max-actions 1000 --context demo
tensnap-agent run start start --max-actions 10000 --stop-when 'time >= 100 || charts.infected <= 0' --context demo
tensnap-agent run start start --max-actions 1000 --max-wall-time-ms 60000 --record --context demo
tensnap-agent run status --context demo
tensnap-agent run stop --context demo
```

`action run` and `run start` return acceptance, not completion. Use the returned request/run ID to correlate results. Dispatch stop (`state`) precedes cleanup completion (`settled`); inspect `primaryFailure`, classified action counts, and `stateKnown` before treating a run as successful. Never automatically rerun against unknown state. Use `action run <id> --wait` or `action wait <request-id>` for one action; `run start ... --wait` or `run wait <run-id> --until settled|persisted` waits by run identity through final rendering and the stop hook. `persisted` requires a recorded run. A wait timeout does not cancel the operation.

`--record` closes only after settlement and saves a self-contained recording under the context's `recordings/<recording-id>.tensnap-recording.json`. Query `GET /v1/runs/<run-id>` for recording `pending`/`persisted`/`failed`, path and error. Persisted does not mean untruncated. `recording list` reports recording IDs, paths, retained ranges, budgets and resource completeness. Default retention is 10,000 frames / 64 MiB rolling. A second recorded run is rejected before dispatch while an earlier recording write is pending; retry after its persistence event/status. Unrecorded runs can continue meanwhile.

Use `--output-version 1` for versioned JSON stdout; diagnostics go to stderr. Unknown/missing flags and extra positional arguments fail before runtime access. Use `--context-dir`, not `--root-dir`. Exit codes and the full error/settlement contract are in [the runtime guide](references/docs/user-guide/agent-runtime.md).

The matching HTTP resource is `POST /v1/runs`, `GET /v1/runs`, and `DELETE /v1/runs`. `stopWhen` is parsed once and evaluated before the first dispatch and after every `action_result`. It can read `steps`, `time`, metadata, `parameters`, `charts`, `agent(envId, layerId, id)`, and `agentCount(envId, layerId)`; it cannot call arbitrary host functions.

## Offline recordings and fixed evidence

```bash
tensnap-agent run start start --max-actions 20 --record --wait --until persisted --context demo
tensnap-agent recording list --context demo
tensnap-agent recording export <recording-id> --output run.tensnap-recording.json --context demo
tensnap-agent recording info run.tensnap-recording.json
tensnap-agent recording seek run.tensnap-recording.json --time 10 --match last
tensnap-agent recording export-frame run.tensnap-recording.json --frame 10 --env main --output evidence
tensnap-agent recording render evidence/state.recording.json --frame 0 --env main --output history.png
tensnap-agent frame save --checkpoint required --env main --output saved --context demo
tensnap-agent frame restore saved --mode checkpoint --history replace --context demo
tensnap-agent frame compare saved evidence
```

Use actual IDs and retained indexes from inspection. Offline operations require an explicit frame or `--time` plus `--match first|last|before|after`, and reject runtime context flags. They work without a daemon or simulator. For a project containing multiple recordings, use `--snapshot-id`; this reads the file without opening its online source. New recording/frame/wait commands emit version-1 JSON by default.

Manual recording uses `recording start --max-frames <n> --max-bytes <n> --retention rolling|bounded` followed by `recording stop`. Conflicting recording sessions fail; action quotas and frame budgets are separate.

A frame evidence directory contains a verified manifest, a self-contained single-frame recording, and requested images. Checkpoint policies are `none|if-supported|required`; required capture must prove an unchanged renderer revision and source identity. Historical checkpoints exist only at their original captured boundary. Never attach a current online checkpoint to historical state. Missing checkpoints allow viewing/rendering but fail exact restoration. Restore validates identity/schema, preserves history on model failure, and reports model/history status and state certainty. A complete manifest is committed only after every requested artifact succeeds; failures preserve explicit partial output. Existing evidence directories are never overwritten.

Use the GUI's **File → Open recording** from an empty app; the replay dialog exports full recordings or the current frame. Cursor selection retains the whole timeline. Checkpoint-only models can replace/truncate renderer charts without projected wire time.

## Rendering

Manual render with default auto-fit viewport:

```bash
tensnap-agent scene render snapshot --context demo
```

Manual render with an explicit canvas background color override:

```bash
tensnap-agent scene render snapshot --context demo --background-color '#101820'
```

Render a specific environment with explicit pixel size:

```bash
tensnap-agent scene render report --context demo --env main --width 1280 --height 720
```

Render a specific viewport:

```bash
tensnap-agent scene render crop --context demo --env main --viewport '{"x":10,"y":5,"width":20,"height":12}'
```

Write to a specific output path:

```bash
tensnap-agent scene render export --context demo --output ./artifacts/main.png
```

## Render Timing

Use manual mode when an agent wants full control over when rendering happens:

```bash
tensnap-agent runtime render-trigger manual --context demo
```

Use action-result mode when every completed simulator action should produce a fresh capture automatically:

```bash
tensnap-agent runtime render-trigger action-result --context demo
```

## Event Streaming

Watch runtime events through SSE:

```bash
tensnap-agent stream events --context demo
```

Useful event families:

- `transport.open`, `transport.close`, `transport.error`
- `scene.sync.requested`
- `action.start.requested`, `action.result`
- `render.requested`, `render.failed`, `render.trigger.updated`

## Operational Guidance

- Prefer `scene inspect` before mutating parameters or actions, so the agent has the current ids.
- If a protocol payload looks wrong, check the bundled specification. In a TenSnap checkout, inspect `packages/protocol/src/schemas.ts` and `packages/protocol/src/layers.ts`, then regenerate the Markdown protocol reference before changing runtime code.
- Prefer `action run` for one action and `run start` for every continuous workflow.
- Use `run start --wait`, `run wait <run-id>`, or the SSE stream; avoid client-side wait loops. Query status with the returned ID before treating a timed-out operation as failed or retryable.
- The retired `scene start|step|reset`, `wait`, and `experiment` commands have no aliases. Use the action id or a bounded run instead.
- Use `manual` render trigger when you need to separate simulation stepping from image capture.
- Use `action-result` render trigger when a downstream workflow expects every action to produce a new image.
- If multiple environments exist and no `--env` is provided, the painter may emit one artifact per environment.
- Use `--background-color` when a workflow needs a different base fill.
- Chart rendering uses `scene render --chart <id>` and chart screenshot requests are supported. Explicit missing targets, empty batches, painter exceptions, and write failures fail the request; partial successes remain in the structured error response.

## Headless Render Pitfalls

- Keep `@leafer-ui/core` and `@leafer-ui/node` on the same runtime identity in the built CLI. If bundling splits them, headless export can fail even when source tests pass.
- Leafer export must use screenshot mode for full-canvas captures. Element-bounds export can collapse to the rendered element bounds and produce tiny artifacts.
- Browser `blob:` URLs are not portable into the agent runtime. Prefer asset bytes, data URLs, or file/HTTP URLs for headless rendering.
- Grid lines in headless exports must be clipped to the current viewport span. Extremely large pseudo-infinite line segments can disappear during Leafer headless export or culling.
