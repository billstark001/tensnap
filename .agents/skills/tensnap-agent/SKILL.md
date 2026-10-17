---
name: tensnap-agent
description: Drive a TenSnap simulator through the scene-level CLI, inspect state, run bounded actions, and render evidence. Use for simulator automation, not binding implementation.
---

# tensnap-agent Skill

Use this skill when you need an automation agent to drive a TenSnap simulator through the scene-level CLI in `packages/tensnap-agent`.

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
- Protocol message shapes, screenshot payloads, asset payloads, and built-in layer item contracts come from `packages/protocol`. Generate the current reference with `pnpm --dir packages/protocol export:protocol` when debugging transport or scene-sync issues.

## Core Commands

Start or reuse a runtime and connect it to a simulator:

```bash
pnpm --filter @tensnap/agent dev -- runtime up --context demo --simulator-url ws://127.0.0.1:8765
```

Inspect runtime status:

```bash
pnpm --filter @tensnap/agent dev -- runtime status --context demo
```

Inspect the synchronized scene:

```bash
pnpm --filter @tensnap/agent dev -- scene inspect --context demo
```

List or update parameters:

```bash
pnpm --filter @tensnap/agent dev -- param list --context demo
pnpm --filter @tensnap/agent dev -- param set infection_rate 0.35 --context demo
```

List or run actions directly by id:

```bash
pnpm --filter @tensnap/agent dev -- action list --context demo
pnpm --filter @tensnap/agent dev -- action run reseed --context demo
```

## Bounded Runs

For a continuous action, use `run start`; `action run` is deliberately a single dispatch. `--max-actions` is required even when a condition is present (`--max-steps` remains a deprecated public spelling; using both is rejected), and the default policy rejects values greater than 1,000,000.

Start the runtime with a higher explicit policy only when the automation workflow requires it:

```bash
pnpm --filter @tensnap/agent dev -- runtime up --context demo --simulator-url ws://127.0.0.1:8765 --max-steps-policy 2000000
```

```bash
pnpm --filter @tensnap/agent dev -- run start start --max-actions 1000 --context demo
pnpm --filter @tensnap/agent dev -- run start start --max-actions 10000 --stop-when 'time >= 100 || charts.infected <= 0' --context demo
pnpm --filter @tensnap/agent dev -- run start start --max-actions 1000 --max-wall-time-ms 60000 --record --context demo
pnpm --filter @tensnap/agent dev -- run status --context demo
pnpm --filter @tensnap/agent dev -- run stop --context demo
```

`action run` and `run start` return acceptance, not completion. Use the returned request/run ID to correlate results. Dispatch stop (`state`) precedes cleanup completion (`settled`); inspect `primaryFailure`, classified action counts, and `stateKnown` before treating a run as successful. Never automatically rerun against unknown state. The core `waitForSettled(runId)` waits through final rendering and the stop hook; CLI `--wait` is not implemented.

`--record` closes only after settlement and saves the existing SnapshotArchive under the context's `recordings/<run-id>.snapshot.json`. Query `GET /v1/runs/<run-id>` for recording `pending`/`persisted`/`failed`, path and error. This is not the future standalone recording file format; persisted does not mean untruncated. Default retention is 10,000 frames / 64 MiB rolling. A second recorded run is rejected before dispatch while an earlier recording write is pending; retry after its persistence event/status. Unrecorded runs can continue meanwhile.

Use `--output-version 1` for versioned JSON stdout; diagnostics go to stderr. Unknown/missing flags and extra positional arguments fail before runtime access. Use `--context-dir`, not `--root-dir`. Exit codes and the full error/settlement contract are in [the runtime guide](../../../docs/user-guide/agent-runtime.md).

The matching HTTP resource is `POST /v1/runs`, `GET /v1/runs`, and `DELETE /v1/runs`. `stopWhen` is parsed once and evaluated before the first dispatch and after every `action_result`. It can read `steps`, `time`, metadata, `parameters`, `charts`, `agent(envId, layerId, id)`, and `agentCount(envId, layerId)`; it cannot call arbitrary host functions.

## Rendering

Manual render with default auto-fit viewport:

```bash
pnpm --filter @tensnap/agent dev -- scene render snapshot --context demo
```

Manual render with an explicit canvas background color override:

```bash
pnpm --filter @tensnap/agent dev -- scene render snapshot --context demo --background-color '#101820'
```

Render a specific environment with explicit pixel size:

```bash
pnpm --filter @tensnap/agent dev -- scene render report --context demo --env main --width 1280 --height 720
```

Render a specific viewport:

```bash
pnpm --filter @tensnap/agent dev -- scene render crop --context demo --env main --viewport '{"x":10,"y":5,"width":20,"height":12}'
```

Write to a specific output path:

```bash
pnpm --filter @tensnap/agent dev -- scene render export --context demo --output ./artifacts/main.png
```

## Render Timing

Use manual mode when an agent wants full control over when rendering happens:

```bash
pnpm --filter @tensnap/agent dev -- runtime render-trigger manual --context demo
```

Use action-result mode when every completed simulator action should produce a fresh capture automatically:

```bash
pnpm --filter @tensnap/agent dev -- runtime render-trigger action-result --context demo
```

## Event Streaming

Watch runtime events through SSE:

```bash
pnpm --filter @tensnap/agent dev -- stream events --context demo
```

Useful event families:

- `transport.open`, `transport.close`, `transport.error`
- `scene.sync.requested`
- `action.start.requested`, `action.result`
- `render.requested`, `render.failed`, `render.trigger.updated`

## Operational Guidance

- Prefer `scene inspect` before mutating parameters or actions, so the agent has the current ids.
- If a protocol payload looks wrong, inspect `packages/protocol/src/schemas.ts` and `packages/protocol/src/layers.ts`, then regenerate the Markdown protocol reference before changing agent runtime code.
- Prefer `action run` for one action and `run start` for every continuous workflow.
- Use `run status` or the SSE stream to observe a run; do not build a client-side wait loop for conditions the shared controller can evaluate.
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
