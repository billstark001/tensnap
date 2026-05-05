# tensnap-agent Skill

Use this skill when you need an automation agent to drive a TenSnap simulator through the scene-level CLI in `packages/tensnap-agent`.

## When To Use

- You need to connect to a running simulator and inspect the current scene state.
- You need to trigger reserved simulator actions such as `start`, `step`, or `reset`.
- You need to change parameters from an agent workflow.
- You need to wait on action completion, time, chart values, or scene metadata before continuing.
- You need an environment render, optionally for a specific viewport.
- You need to run a structured experiment spec that combines parameter changes, actions, waits, and optional renders.
- You need a long-lived local runtime instead of a one-shot WebSocket client.

## Runtime Model

- Start the daemon once per working context.
- Runtime state is persisted under `.tensnap/contexts/<context>/` by default.
- The daemon exposes local HTTP control endpoints and an SSE event stream.
- Reserved scene actions map directly to simulator action ids: `start`, `step`, `reset`.

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

Run reserved scene actions:

```bash
pnpm --filter @tensnap/agent dev -- scene step --context demo
pnpm --filter @tensnap/agent dev -- scene reset --context demo
pnpm --filter @tensnap/agent dev -- scene start --context demo --continuous
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

Use action-end mode when every completed simulator action should produce a fresh capture automatically:

```bash
pnpm --filter @tensnap/agent dev -- runtime render-trigger action-end --context demo
```

## Event Streaming

Watch runtime events through SSE:

```bash
pnpm --filter @tensnap/agent dev -- stream events --context demo
```

Useful event families:

- `transport.open`, `transport.close`, `transport.error`
- `scene.sync.requested`
- `action.start.requested`, `action.end`
- `render.requested`, `render.failed`, `render.trigger.updated`

## Waits And Experiments

Wait for the current or named action to complete:

```bash
pnpm --filter @tensnap/agent dev -- wait action-end --context demo
pnpm --filter @tensnap/agent dev -- wait action-end start --context demo --timeout-ms 60000
```

Wait for simulation time or a chart threshold:

```bash
pnpm --filter @tensnap/agent dev -- wait time 100 --context demo --comparison gte
pnpm --filter @tensnap/agent dev -- wait chart infected 25 --context demo --comparison lte
```

Wait for scene metadata to reach a value:

```bash
pnpm --filter @tensnap/agent dev -- wait metadata metadata.time 100 --context demo --comparison gte
```

Run an experiment spec in one request:

```bash
pnpm --filter @tensnap/agent dev -- experiment run '{"label":"baseline","parameters":{"infection_rate":0.35},"action":{"id":"start","continuous":true},"waits":[{"kind":"time","time":100,"comparison":"gte"}],"render":{"reason":"baseline","envId":"main"}}' --context demo
```

## Operational Guidance

- Prefer `scene inspect` before mutating parameters or actions, so the agent has the current ids.
- Prefer reserved scene actions when they exist, because they carry simulator semantics directly.
- Prefer `wait ...` commands over ad-hoc polling when the workflow depends on a time step, chart threshold, or action boundary.
- Prefer `experiment run` when a workflow would otherwise need several sequential CLI calls and intermediate bookkeeping.
- Use `manual` render trigger when you need to separate simulation stepping from image capture.
- Use `action-end` render trigger when a downstream workflow expects every action to produce a new image.
- If multiple environments exist and no `--env` is provided, the painter may emit one artifact per environment.
- Use `--background-color` when a workflow needs a different base fill.
- The current headless environment painter covers environment rendering only. Chart screenshot requests are not implemented yet.

## Headless Render Pitfalls

- Keep `@leafer-ui/core` and `@leafer-ui/node` on the same runtime identity in the built CLI. If bundling splits them, headless export can fail even when source tests pass.
- Leafer export must use screenshot mode for full-canvas captures. Element-bounds export can collapse to the rendered element bounds and produce tiny artifacts.
- Browser `blob:` URLs are not portable into the agent runtime. Prefer asset bytes, data URLs, or file/HTTP URLs for headless rendering.
- Grid lines in headless exports must be clipped to the current viewport span. Extremely large pseudo-infinite line segments can disappear during Leafer headless export or culling.