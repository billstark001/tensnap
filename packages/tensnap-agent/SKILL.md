# tensnap-agent Skill

Use this skill when you need an automation agent to drive a TenSnap simulator through the scene-level CLI in `packages/tensnap-agent`.

## When To Use

- You need to connect to a running simulator and inspect the current scene state.
- You need to trigger reserved simulator actions such as `start`, `step`, or `reset`.
- You need to change parameters from an agent workflow.
- You need an environment render, optionally for a specific viewport.
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

## Operational Guidance

- Prefer `scene inspect` before mutating parameters or actions, so the agent has the current ids.
- Prefer reserved scene actions when they exist, because they carry simulator semantics directly.
- Use `manual` render trigger when you need to separate simulation stepping from image capture.
- Use `action-end` render trigger when a downstream workflow expects every action to produce a new image.
- If multiple environments exist and no `--env` is provided, the painter may emit one artifact per environment.
- The current node-canvas painter covers environment rendering only. Chart screenshot requests are not implemented yet.