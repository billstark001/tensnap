# Agent runtime and reliable results

Start a local runtime, then use its context for later requests:

```sh
pnpm --filter @tensnap/agent dev -- runtime up --context demo --simulator-url ws://127.0.0.1:8765
pnpm --filter @tensnap/agent dev -- run start start --max-actions 100 --record --context demo --output-version 1
pnpm --filter @tensnap/agent dev -- run status --context demo --output-version 1
pnpm --filter @tensnap/agent dev -- scene render --env main --output ./main.png --context demo --output-version 1
pnpm --filter @tensnap/agent dev -- runtime down --context demo
```

Use `--context-dir <path>` to change the `.tensnap` storage root. Every command validates flags, value types, enums, mutually exclusive options and positional argument counts before runtime access or file writes. `--root-dir` is rejected with a `--context-dir` hint. `--record` and `--foreground` are switches; do not append `true` or `false`. `--max-actions` is a positive completed-action limit, including failed results. The deprecated public `--max-steps` spelling remains accepted; combining the two fails. HTTP/core still name this quota `maxSteps`.

A run is driven by its target action's `should_continue` result. For standard model-builder examples, use the continuous `start` action for bounded runs; the one-shot `step` action can explicitly stop after one result. Model time need not advance on a successful action.

## Acceptance, completion and settlement

`action run` and `run start` return HTTP acceptance. Exit code 0 at this stage means the request was accepted. It does not mean the simulator action completed. An accepted action includes `requestId`; run responses include `run.id`. Correlate `action.result` SSE events by both action ID and request ID.

A run status reports:

- `dispatchedActions`, `completedActions`, `succeededActions`, `failedActions`. Only matched target action results count; lifecycle hooks do not consume the quota. `completedActions = succeededActions + failedActions`. Timeout/disconnect never fabricate a result. The deprecated public `completedSteps` field equals `completedActions`.
- `lastAction` with the target result, request ID and observed `timeBefore`/`timeAfter`; `lastLifecycleAction` separately records cleanup. Snapshot frame indices and model time are independent of action counts.
- `state` (`running`, `paused`, `stopped`) for dispatch control, and `settled`/`settledAt` for completion of all owned actions, the stop hook, and configured host barriers. `stoppedAt` marks dispatch stop. Manual rendering does not promise images at settlement.
- `stopReasons` for every observed reason, and `primaryFailure` when a failure occurred. The compatible `stopReason` prioritizes disconnected, action-timeout, validation-error, action-error, condition-error, then render-error over normal stop reasons. A failure on the quota action or its final render is preserved.
- `stateKnown: false` after action timeout/disconnection while an owned action is in flight. Do not automatically run a recovery comparison against unknown state.

Use `GET /v1/runs/<run-id>` to query a particular run rather than whichever run happens to be latest. Core's `run.getRun(id)` and `run.waitForSettled(id, timeoutMs, signal)` use the same identity. The last 100 settled summaries are retained in memory; the active run remains available. Restarting the runtime clears these summaries. Unknown or expired IDs fail immediately. Wait timeout/abort stops the wait only and does not cancel simulator work. CLI `--wait` and `run wait` are not implemented in this patch.

`RendererClient.invokeAction()` waits through the matching host barrier. A barrier failure rejects with `ActionRenderError`, which preserves the simulator's correlated `result`. An action result's own `error` remains part of that result.

## Recording and rendering failures

`--record` begins before first dispatch and closes after settlement. Stop-hook frames carry `source: 'lifecycle'` and retain their control request IDs. The runtime atomically saves the existing SnapshotArchive JSON under `contexts/<context>/recordings/<run-id>.snapshot.json`. Run status exposes `recording.status` (`pending`, `persisted`, `failed`), with `path` or `error`; SSE emits `recording.persistence` with `runId`. `settled` does not imply that this write succeeded. Runtime shutdown waits for pending recording writes.

The default recording budget remains 10,000 retained frames / 64 MiB with rolling retention. `persisted` means the archive reached disk; inspect the archive's `truncated` field before claiming full history. This patch does not implement the planned standalone recording format, GUI import, offline commands or frame manifests.

`scene render` accepts an environment or chart target, PNG/JPEG format, positive integer dimensions, quality from 0 through 1, and a viewport with finite x/y and positive width/height. It rejects mutually exclusive targets and malformed values. Missing targets, no artifacts, painter exceptions, export failures and filesystem writes fail explicitly.

A multi-target render continues collecting successful artifacts after a target fails. HTTP returns 422 with `category`, `partial`, `artifacts` and target `errors`; successful files remain available. Binary artifact data is base64 with `dataEncoding: 'base64'`. `AgentRuntime.requestRender()` throws `RenderBatchError` with the same artifacts and target failures. Custom painters use `RenderPersistenceError` for output-write errors; other painter exceptions are rendering failures. Failure to write the scene checkpoint after rendering is also a persistence failure with the already generated artifacts preserved.

Readonly graph rendering uses stored coordinates without force simulation or writes to the input scene. Numeric and string IDs remain distinct. Normal interactive layouts continue using d3-force.

## Machine output and exit codes

Existing commands retain their default output shapes. Opt into `--output-version 1` for one JSON envelope per response (one per event for streams):

```json
{ "schemaVersion": 1, "ok": true, "data": { "run": { "id": "..." } }, "correlationId": "..." }
```

On failure, stdout contains `schemaVersion`, `ok: false`, `error.category` and `error.message`. HTTP error bodies, including partial artifacts, are preserved in `data`. Correlation IDs are included when the response supplies a request/run ID. Diagnostics go to stderr. HTTP errors remain non-successful even when partial artifacts exist.

| Exit code | Category | Meaning |
| --- | --- | --- |
| 0 | success | This command succeeded; an accepted request may still be running |
| 2 | `input_error` | Invalid command/flag/value or rejected HTTP input |
| 3 | `execution_failed` | Execution/control request failed |
| 4 | `result_unknown` | Timed out/disconnected while waiting; success/failure is unknown |
| 5 | `render_failed` | Painter/export/missing-target/no-artifact failure |
| 6 | `persistence_failed` | Required output or scene-checkpoint write failed |

A successful `run status` query exits 0 even if its returned run failed. Inspect the run's classified outcome and settlement fields. A background action failure does not retroactively change an earlier acceptance command's exit code.
