# Agent runtime and reliable results

Install with Node.js 22 or newer using `npm install --global @tensnap/agent`, or add it to a model project with `npm install --save-dev @tensnap/agent` and use `npx --no-install tensnap-agent`. A TenSnap source checkout is not required. Start the simulator separately; the CLI connects to its WebSocket endpoint.

Install optional version-matched skills from the npm bundle with `tensnap-agent skills install tensnap-agent`, `tensnap-agent skills install tensnap-abm-binding --scope user`, or `tensnap-agent skills install --all`. These commands are offline and non-interactive. Project scope defaults to `<cwd>/.agents/skills`, user scope to `~/.agents/skills`; `--agent claude-code` uses `.claude/skills` in the selected scope. `--project-dir` selects another project. `skills list` reports available names, version, and bundle location. See the [agent package README](https://github.com/billstark001/tensnap/tree/main/packages/tensnap-agent#readme) for conflict handling and the Vercel `skills` alternative.

Reinstalling an unchanged managed skill is a no-op. Re-run installation after CLI upgrades to update unmodified managed copies. Existing same-name content and local edits fail with exit 2 and remain intact; `--force` preserves a backup outside the skills directory before replacement. `--output-version 1` reports installation results and errors through the same versioned envelope as runtime commands.

Start a local runtime, then use its context for later requests:

```sh
tensnap-agent runtime up --context demo --simulator-url ws://127.0.0.1:8765
tensnap-agent run start start --max-actions 100 --record --context demo --output-version 1
tensnap-agent run status --context demo --output-version 1
tensnap-agent scene render --env main --output ./main.png --context demo --output-version 1
tensnap-agent runtime down --context demo
```

Use `--context-dir <path>` to change the `.tensnap` storage root. Every command validates flags, value types, enums, mutually exclusive options and positional argument counts before runtime access or file writes. `--root-dir` is rejected with a `--context-dir` hint. `--record` and `--foreground` are switches; do not append `true` or `false`. `--max-actions` is a positive completed-action limit, including failed results. The deprecated public `--max-steps` spelling remains accepted; combining the two fails. HTTP/core still name this quota `maxSteps`.

Commands and command groups provide generated help through `--help` (or `-h`). For example, `tensnap-agent run start --help` works without an action ID or quota, and `tensnap-agent scene --help` lists scene commands. Help does not access the runtime or write files; `--output-version 1` wraps the complete help text in one successful JSON envelope. Global options may appear before or after subcommands; `--context` and `--context-dir` apply to runtime operations and are rejected by skills commands. Use `--` to end option processing when a positional value begins with a dash: `tensnap-agent param set label -- --literal`.

HTTP connection requests require a `ws://` or `wss://` URL. Recording options validate nested codec names, model identity and checkpoint fields before starting a run. Checkpoint bytes in JSON must use base64 or a base64 data URL.

A run is driven by its target action's `should_continue` result. For standard model-builder examples, use the continuous `start` action for bounded runs; the one-shot `step` action can explicitly stop after one result. Model time need not advance on a successful action.

## Acceptance, completion and settlement

`action run` and `run start` return HTTP acceptance. Exit code 0 at this stage means the request was accepted. It does not mean the simulator action completed. An accepted action includes `requestId`; run responses include `run.id`. Correlate `action.result` SSE events by both action ID and request ID.

A run status reports:

- `dispatchedActions`, `completedActions`, `succeededActions`, `failedActions`. Only matched target action results count; lifecycle hooks do not consume the quota. `completedActions = succeededActions + failedActions`. Timeout/disconnect never fabricate a result. The deprecated public `completedSteps` field equals `completedActions`.
- `lastAction` with the target result, request ID and observed `timeBefore`/`timeAfter`; `lastLifecycleAction` separately records cleanup. Snapshot frame indices and model time are independent of action counts.
- `state` (`running`, `paused`, `stopped`) for dispatch control, and `settled`/`settledAt` for completion of all owned actions, the stop hook, and configured host barriers. `stoppedAt` marks dispatch stop. Manual rendering does not promise images at settlement.
- `stopReasons` for every observed reason, and `primaryFailure` when a failure occurred. The compatible `stopReason` prioritizes disconnected, action-timeout, validation-error, action-error, condition-error, then render-error over normal stop reasons. A failure on the quota action or its final render is preserved.
- `stateKnown: false` after action timeout/disconnection while an owned action is in flight. Do not automatically run a recovery comparison against unknown state.

Use `GET /v1/runs/<run-id>` to query a particular run rather than whichever run happens to be latest. Core's `run.getRun(id)` and `run.waitForSettled(id, timeoutMs, signal)` use the same identity. The last 100 settled summaries are retained in memory; the active run remains available. Restarting the runtime clears these summaries. Unknown or expired IDs fail immediately. Wait timeout/abort stops the wait only and does not cancel simulator work. CLI `action run --wait`, `run start --wait`, `action wait <request-id>` and `run wait <run-id>` expose these boundaries. `--until persisted` requires a recorded run and also waits for its file commit. Wait endpoints propagate failure categories and preserve their correlated summaries.

`RendererClient.invokeAction()` waits through the matching host barrier. A barrier failure rejects with `ActionRenderError`, which preserves the simulator's correlated `result`. An action result's own `error` remains part of that result.

## Recording and rendering failures

`--record` begins before first dispatch and closes after settlement. Stop-hook frames carry `source: 'lifecycle'` and retain their control request IDs. The runtime atomically saves a self-contained recording under `contexts/<context>/recordings/<recording-id>.tensnap-recording.json`. Run status exposes `recording.status` (`pending`, `persisted`, `failed`), with `path` or `error`; SSE emits `recording.persistence` with `runId`. `settled` does not imply that this write succeeded. Runtime shutdown waits for pending recording writes. A runtime holds at most one pending recording snapshot: another recorded run is rejected before model dispatch until that write finishes; inspect the previous run’s recording status and retry after it is persisted or failed. Unrecorded runs can continue meanwhile. Settlement checkpoints are emitted once, and non-forced saves/shutdown join an existing write of the same scene revision.

The default recording budget remains 10,000 retained frames / 64 MiB with rolling retention. `persisted` means the archive reached disk; inspect the archive's `truncated` field before claiming full history. Standalone recordings can be opened in the GUI and queried/rendered offline; fixed-frame evidence has its own manifest workflow below.

Recording closes before unrelated queued actions are dispatched, so their updates cannot enter the previous run's archive. Disconnect detaches the simulator before waiting for the final scene checkpoint. A failed checkpoint of changed scene state is reported and leaves the scene dirty; a later disconnect or shutdown can retry saving it. Pending recording writes release their admission limit after either success or failure; this permits a new recorded run without retrying the failed archive automatically.

`scene render` accepts an environment or chart target, PNG/JPEG format, positive integer dimensions, quality from 0 through 1, and a viewport with finite x/y and positive width/height. It rejects mutually exclusive targets and malformed values. Missing targets, no artifacts, painter exceptions, export failures and filesystem writes fail explicitly.

A multi-target render continues collecting successful artifacts after a target fails, including failures while preparing an environment's render data. HTTP returns 422 with `category`, `partial`, `artifacts` and target `errors`; successful files remain available. Binary artifact data is base64 with `dataEncoding: 'base64'`. `AgentRuntime.requestRender()` throws `RenderBatchError` with the same artifacts and target failures. Custom painters use `RenderPersistenceError` for output-write errors; other painter exceptions are rendering failures. Failure to write the scene checkpoint after rendering is also a persistence failure with the already generated artifacts preserved.

Each render uses the scene captured when its request starts. If the live scene advances while rendering, the final checkpoint saves the latest live scene; a slower earlier render cannot overwrite a newer checkpoint with its captured input. The scene cache therefore need not describe the same frame as an earlier image.

Readonly graph rendering uses stored coordinates without force simulation or writes to the input scene. Numeric and string IDs remain distinct. Normal interactive layouts continue using d3-force.

## Library ownership and file commits

`getStatus()` returns owned render settings and painter lists. Render requests copy viewport values before awaiting a painter; inspection renders also detach the supplied inspection scene and avoid dumping the unrelated live scene. The captured request, scene and assets are shared read-only among painters for that render. A custom painter must copy any values it intends to mutate. Returned artifacts are also published read-only: detach reusable byte buffers and metadata before returning them, and keep those values stable while consumers persist them.

Concurrent action waits return independent settlement values, separate from event-observer data. Frame save/restore and offline recording operations capture their value options before the first asynchronous wait; nested render settings and target arrays are detached. Manual recording status contains serializable option data; callable codec policies stay with the recorder and are not passed to `structuredClone`.

Connection requests capture scalar options and resolved defaults before waiting for status writes. Disconnect cancels attempts still waiting on that write or their handshake, as well as an installed connection. Retired attempts reject without attaching later or replacing the current operation's phase/error.

Context persistence captures control, scene, recording and log values by encoding them before its first filesystem await. Status, scene, recording and image files are written to a temporary file in the destination directory and renamed only after the write completes. A write or rename failure preserves the previous destination and cleans the temporary output. Image buffers remain owned and stable until that write resolves. Atomicity applies to each file; multi-target renders retain their documented partial-result behavior. Rename commits do not add an fsync or multi-file crash-recovery guarantee. Evidence-directory failure cleanup removes only its empty reservation, preserving files placed there by another writer. If partial-output persistence or relocation also fails, the error retains the original failure, cleanup failures, completed artifact values and the actual retained directory; it does not advertise an image path whose write failed.

Background write failures emit `runtime.status-write-failed`, `runtime.log-write-failed` or `scene.persistence-failed`; failure to deliver a screenshot response emits `render.screenshot-failed`. These events do not fabricate model failures or discard a successfully committed state sync. Callers awaiting an explicit persistence operation still receive its rejection.

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

## Recording and fixed-frame workflow

New `recording`, `frame`, `run wait`, and `action wait` commands use the version-1 JSON envelope by default. Offline recording commands reject runtime context options and require an explicit retained `--frame`, or `--time` together with `--match first|last|before|after`. A model time can repeat, move backwards, jump, or be absent. `before`/`after` select the nearest time on that side, then respectively the last/first frame at that time; exact `first`/`last` resolve repeated times in recording order. Positions always report an actual retained frame. No CLI-global replay cursor is retained.

```sh
# Single-action acceptance and settlement are separate; --wait includes the host barrier.
tensnap-agent action run step --wait --timeout-ms 30000 --context demo
tensnap-agent action wait <request-id> --context demo

# Recording includes target actions and stop lifecycle commits.
tensnap-agent run start start --max-actions 20 --record --wait --until persisted --context demo
tensnap-agent run wait <run-id> --until persisted --context demo
tensnap-agent recording list --context demo
tensnap-agent recording export <recording-id> --output run.tensnap-recording.json --context demo

# Manual recordings cannot overlap run-owned recordings.
tensnap-agent recording start --max-frames 500 --max-bytes 16777216 --retention rolling --context demo
tensnap-agent action run step --wait --context demo
tensnap-agent recording stop --context demo

# These commands work after both the daemon and simulator have stopped.
tensnap-agent recording info run.tensnap-recording.json
tensnap-agent recording seek run.tensnap-recording.json --time 10 --match last
tensnap-agent recording inspect run.tensnap-recording.json --frame 10
tensnap-agent recording render run.tensnap-recording.json --frame 10 --env main --output history.png
tensnap-agent recording export-frame run.tensnap-recording.json --frame 10 --env main --chart series --output evidence
```

Replace IDs and frame indexes with those reported by the simulator and recording. An action count is never assumed to equal a frame index or a model tick. `recording info` reports retained range, frame/keyframe count, truncation, retention limits, missing assets and external URL dependencies. `--max-frames` applies to recorded protocol frames, while run `--max-actions` limits target action results. Manual `bounded` retention stops retaining once its budget is exhausted and reports `truncated`; rolling retention drops the oldest seekable prefix. Neither policy promises full-history preservation after a budget is reached.

Recordings persist as `kind: "tensnap-recording", version: 1`, wrapping the existing segmented SnapshotArchive and an independent content-addressed asset table. JSON and MessagePack are supported by core. CLI output uses JSON recordings. File recognition uses contents, including when a browser file adapter returns JSON as bytes. Bare Snapshot/Archive files are explicit legacy imports with a `legacy` report. Export always writes the new wrapper; missing resources or external dependencies fail a complete export. The low-level core encoder can explicitly permit incomplete exports and returns a truthful resource report on import.

An enclosing project file can be inspected with the same offline commands. If it contains multiple recordings, provide `--snapshot-id <id>`; the error lists available IDs. Reading a project for this purpose never opens its source or connects its simulator. In the GUI, **File → Open recording** works from an empty app and lets you select a recording from another project. **Open File** recognizes independent recordings too. Independent recordings receive an automatic layout and synthetic start/step/stop/reset playback controls. Opening at a selected frame moves the playback cursor and retains the full timeline. Parameter edits and simulator-specific actions remain disabled; the recording serving as a tab's source cannot be deleted.

### Save, restore and compare evidence

```sh
tensnap-agent frame save --checkpoint required --env main --chart series --output saved --context demo
tensnap-agent action run step --wait --context demo
tensnap-agent frame restore saved --mode checkpoint --history replace --context demo
tensnap-agent frame save --checkpoint none --output restored --context demo
tensnap-agent frame compare saved restored
```

`frame save` stops new run dispatch, waits for in-flight work and the stop lifecycle, then owns a fixed scene. Checkpoint policies are `none` (default), `if-supported`, and `required`. A checkpoint is associated only when renderer revision and source identity remain unchanged through capture. Concurrent updates produce an inconsistent result; required mode fails. This proves alignment at the protocol capture boundary under the simulator's checkpoint contract, not reproducibility of future external services or hidden autonomous model changes that were never published.

The evidence directory contains `manifest.json`, `state.recording.json`, and requested environment/chart images. The manifest records provenance, model identity/schema, renderer revision when available, checkpoint availability, render settings, relative artifact paths and SHA-256 checksums; it does not duplicate the scene. All painters consume the same owned scene and asset bytes. An existing directory is never overwritten. A failed required image leaves an explicitly failed sibling directory with `failure.json` and available partial artifacts, without a successful manifest. The complete manifest and directory are committed only after every requested artifact succeeds. This is a normal-completion guarantee; it does not provide fsync or crash-tail recovery.

`frame restore` verifies the manifest, artifact checksums, single-frame state, provenance and checkpoint association before model dispatch. It requires an explicit `--mode checkpoint|projected` and verified source/target model ID and schema. The default history policy is `replace`, using the entire saved chart prefix. `--history preserve` retains live charts; `--history truncate` uses the saved model time or an explicit `--history-time`. Checkpoint restore never automatically sends projected `time`, `parameters`, or `envs`. The low-level `scene restore` also accepts local `--history-time` and `--replacement-charts <json>`; the released payload-time fallback for truncate remains supported.

Restore returns `modelStatus`, `historyStatus`, and `stateKnown`. Failed/unknown model restores do not install the saved chart history. Timeout/abort stops the wait, leaves state unknown when appropriate, and never starts a comparison action automatically. To rerun, verify successful restoration, issue an action/run with `--wait`, and save to a new evidence directory. `frame compare` compares the entire public scene, including charts and model time, exactly by default. It reports field paths and before/after values. Checkpoints are compared only as opaque encoding and decoded-byte equality, without interpreting model-private fields.

A historical frame without an associated checkpoint remains viewable, renderable and exportable. Only the recording's actual initial boundary can carry its initial checkpoint; rolling retention removes that checkpoint when the initial boundary advances. Seek/cursor movement does not create model checkpoints. GUI full recording and current-frame export are separate controls in the replay dialog; current-frame exports preserve original recording/frame provenance through subsequent imports and exports.

For a repeatable local real-model acceptance run, execute `pnpm --filter @tensnap/agent test:recording-workflow`. It runs seeded Schelling through the public built CLI, checks persisted recording, checkpoint restore, chart-prefix equality, deterministic rerun, missing-target failure, and identical offline rendering after shutdown. It makes no paid provider calls.

Segment stores, crash-tail recovery, large-recording range indexes, typed query/diff commands, monitor triggers and collection windows remain future enhancements (B4–B5/C4–C5).
