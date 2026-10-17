# Runtime stability: plan-one acceptance

Date: 2026-10-18. Scope: A1–A4 of the detailed runtime/recording improvement plan. Implementation started from clean primary worktree HEAD `1db5bf7dead0f93e78bafd82b6a9a2fed90c82d0`, on `fix/runtime-recording-stability`. The plan's earlier `ee261d0b` baseline was treated as historical context. Plans two/three and their file/GUI/frame workflows remain pending.

## Delivery

| Unit | Delivery | Commit |
| --- | --- | --- |
| A1a/A1b | Classified target counts, request correlation, duplicate rejection, observed times, complete reason collection and failure priority | `5080f8f6`, `5cee9280` |
| A2a | ID-scoped settlement and retained summaries, final barrier/stop-hook recording, lifecycle provenance, unknown states, waiter cleanup and reentrant recording ownership | `5080f8f6`, `5cee9280` |
| A2b | Explicit and partial painter failures, filesystem failure categories, atomic run archive writes and queryable persistence failures | `d8d10d85` |
| A3a/A3b | Per-command/HTTP input validation, versioned stdout, structured partial errors, acceptance request IDs and exit codes | `9d1e3a18` |
| A4 | Stored edge geometry on initialization/update, typed ID resolution, readonly immutability, normal-layout and real headless regressions | `4067d9cf`, `d8d10d85` |
| Consumers | GUI classified counts, settlement display and failure priority over pause | `384c3680` |

The complete public contract is in [Agent runtime](../user-guide/agent-runtime.md) and [core README](../../packages/core/README.md). The repository agent skill is updated to the implemented commands. Public `completedSteps` and `--max-steps` are retained and marked deprecated; internal consumers use completed-action counts. The existing public core/HTTP `maxSteps` field retains its meaning. No internal compatibility aliases or fallback command implementations were added.

Core and agent each advance from 0.3.3 to 0.3.4; web advances from 0.3.4 to 0.3.5. Protocol/binding and file-format versions do not change. The optional action-frame `source` describes renderer-run provenance and is preserved in the existing archive format. No wire contract changes require cross-language binding migrations.

## Behavioral acceptance

| Check | Result |
| --- | --- |
| T01 | Failed result at maxSteps=1 gives completed=1, failed=1, succeeded=0; action-error remains primary |
| T02 | Successful action with unchanged time counts as success; before/after times remain equal |
| T03 | Duplicate/wrong request/action IDs do not count or wake the wrong client waiter; old run summaries stay keyed by ID |
| T04 | Final barrier and stop-hook commits precede settlement/recording close; lifecycle frames retain their source; starting another run from a settled listener cannot close the new recording |
| T05 | Final barrier rejection after quota changes the final outcome to render-error |
| T06 | Painter throws, explicit missing targets, empty batches, per-target partial success, real filesystem failures, checkpoint-write failures and injected recording-store failures produce explicit failure information |
| T07 | Unknown/missing/duplicate/conflicting flags, extra positions, invalid enums/numbers/JSON/viewport/URL fail before runtime access; real built CLI creates no context for invalid input |
| T08 | Numeric/string IDs resolve separately; readonly edge geometry follows fixed and updated node positions without force simulation/input changes; normal layout and browser/headless equivalence remain covered; repeated headless PNGs show the connecting edge |

Final package suites: core **552**, agent **142**, web **211** tests passed (905 total). Core/agent/web typechecks and production builds passed. Built runtime/painter exports were imported and verified. Affected TypeScript lint, strict Lingui compilation, version consistency, 7 JavaScript release-tool tests and agent-skill validation passed.

Reproduce the main automated checks:

```sh
pnpm --filter @tensnap/core test
pnpm --filter @tensnap/agent test
pnpm --filter @tensnap/web test
pnpm --filter @tensnap/core typecheck
pnpm --filter @tensnap/agent typecheck
pnpm --filter @tensnap/web typecheck
pnpm --filter @tensnap/core build
pnpm --filter @tensnap/agent build
pnpm --filter @tensnap/web build
pnpm --filter @tensnap/web i18n:check
pnpm run check:versions
pnpm run test:release
```

## Real model acceptance

The checked-in script runs a real local Schelling model (12×12, seed 42) and the built CLI. It uses the continuous `start` action; standard `step` is explicitly one-shot and can stop after one action. It requests a three-action run, waits by run ID for settlement and persistence, decodes the saved archive, compares metadata/environments/charts against the online snapshot, and generates a PNG. It also verifies missing-target/write failures, machine-readable stdout and side-effect-free input rejection. It shuts down its processes and removes its temporary context.

```sh
pnpm --filter @tensnap/agent build
pnpm --filter @tensnap/agent exec tsx scripts/verify-runtime-stability.mts
```

Observed output:

```json
{
  "ok": true,
  "model": "schelling",
  "seed": 42,
  "completedActions": 3,
  "modelTime": 3,
  "lifecycleRecorded": true,
  "replayMatches": true,
  "pngBytes": 34101,
  "verifiedExitCodes": [0, 2, 5, 6]
}
```

The PNG byte count is an observation, not a cross-platform equality assertion. The script does not call a remote LLM/provider. Execution/unknown categories also have controlled action-failure, timeout/disconnect and waiter tests; acceptance remains distinct from completed execution.

## Boundaries

The recording write added for A2.6 persists the existing SnapshotArchive and reports pending/persisted/failed by run ID. It does not implement standalone recording files, import/export management or frame evidence directories. Defaults remain 10,000 frames / 64 MiB rolling; persistence does not promise untruncated history. Summaries and recording statuses are retained in memory for 100 settled runs and reset with the runtime; files remain on disk.

CLI action/run waiting commands, public persistence extraction, independent recording/GUI interchange and frame restoration/comparison belong to plans two/three. Their joint business scenarios were not claimed or tested as implemented. Browser behavior was checked with the existing automated web and browser/headless equivalence suites; no manual browser/Tauri walkthrough or cross-language conformance run was needed for this renderer-only change.

## Performance and stability follow-up (2026-10-18)

Review baseline: `226f4625`. Corrections: core `5eb94ec5`, agent `2fc11ef7`. The initial full suites missed a graph extraction error: the geometry helper still contained position-write code and the original synchronous push helper was empty. Earlier readonly tests compared selected coordinates or the caller’s scene, which did not detect added velocity fields in the internal storage. New regressions assert exact storage snapshots/revisions/notifications, one publication per force tick, immediate positions for newly laid out nodes, and no redraw of unrelated edges after one appearance delta.

The follow-up corrects these paths:

- Geometry projection is pure and bounded to the changed shape on an appearance update; simulation ticks alone publish force positions once, and initialization/new-node layout still publishes synchronously.
- Ordinary run statuses/results use explicit owned copies of their known small fields; recording options and arbitrary structured condition/error values retain deep-copy boundaries. Settlement is published once. Reset finishes clearing the old pipeline before settled listeners may start a new run.
- The agent checkpoints on `run:settled`, joins a pending non-forced write of the same scene revision, and rejects another recorded run before dispatch while the previous snapshot is pending. This bounds retained recording-write memory; non-recorded runs are unaffected.
- CLI machine output serializes the response only once. Non-JSON text output keeps its public behavior; malformed upstream error bodies remain available to callers.

An isolated synchronous run-controller microbenchmark (30,000 actions, flat timing buckets, status observer, nine rounds with two warmups discarded) measured about **118 ms before / 16 ms after** on this host. This measures controller overhead only; it is not an end-to-end model or rendering speed claim. The redraw/notification regressions use deterministic work counts rather than timing thresholds. Reproduce the current microbenchmark with:

```sh
pnpm --filter @tensnap/agent exec tsx scripts/benchmark-run-controller.mts
```

Follow-up package suites: core **557**, agent **145**, web **211** (913 tests), plus typechecks, affected builds, built-CLI seeded Schelling acceptance and changed-file lint. Existing core/agent 0.3.4 changelog entries are updated; no additional packages or package versions are changed. The empty Unreleased heading is removed.

Large recording archive encoding still runs synchronously and is bounded by the configured recording budget; this review does not implement the plan’s later streaming/worker storage work or claim crash-tail recovery. Only duplicate non-forced writes of the same revision are joined. The second follow-up below corrects the revision association of forced render checkpoints.

## Second performance and stability follow-up (2026-10-18)

Review baseline: `3f832c23`. Corrections: core `989443b`, agent `33f786b`. Four reproduced regressions are corrected:

- A delayed render could save its older captured scene under the current revision and clear the dirty flag, including after a newer render had already saved. Render requests now retain their capture revision privately. Images still use their captured input; cache writes use that snapshot only while its revision is current, otherwise they save or join the latest scene checkpoint. Tests cover both a live update alone and a newer render completing first.
- Rendering the last run action could dispatch an unrelated queued action before closing the recording. A synchronous response from that action then appeared in the old archive. Settlement now precedes sending unrelated queued work; owned stop hooks still block settlement. The regression asserts the archived model time and excludes the unrelated control frame.
- Disconnect previously waited for scene storage before detaching the simulator. A slow or failed disk write could leave the connection active. Detachment now happens first. Tests gate the writer, assert immediate detachment, then verify shared write failures reach both render and disconnect, preserve partial artifacts and dirty state, and allow shutdown to retry successfully.
- Environment render-data projection ran outside the per-target error boundary. A preparation failure discarded earlier successful artifacts. It now reports that target's error while retaining other targets' outputs, tested with a real in-memory PNG for the successful environment.

Recording backpressure tests also cover failed archive writes and starting the next recorded run directly from the completion event. No internal alias or fallback is introduced. Package versions remain core/agent **0.3.4**, web **0.3.5**; only the existing core/agent changelog entries are extended, with no Unreleased section.

Validation: core **558**, agent **151**, web **211** tests passed (**920** total). Core/agent/web typechecks and production builds, changed-file lint and version consistency passed. The built CLI's seeded Schelling acceptance again reported three completed actions, time 3, lifecycle recording, matching replay, a 34,101-byte PNG and exit codes 0/2/5/6. The same isolated 30,000-action controller microbenchmark measured about **18 ms** on this host; this is a controller-only observation, not an end-to-end speed guarantee. Reproduction commands remain those above.

## Format, ownership and atomicity review (2026-10-18)

Review baseline: `eefbc049`. Corrections: core `b3ddf85`, agent `40e8987`. The review uses the repository's Oxfmt/Oxlint configuration, [contributing guide](./contributing.md), the value-lifetime principles in [projection ownership](./projection-ownership.md), and the transaction/filesystem boundaries in [architecture](./architecture.md). Binding-specific projection options are not applied to renderer APIs. This round adds no binding, wire, file-format or public compatibility aliases.

| Boundary | Corrected policy and evidence |
| --- | --- |
| Run recording options | Copy value data and codec descriptors, preserve callable policy functions. A real run previously failed with DataCloneError when a callback was present; the regression now starts and settles it, mutates caller/status descriptors and checkpoint bytes, and verifies retained values are independent. The recorder retains only used policy fields, avoiding duplicate retention of checkpoint data. |
| Queued action invocation | Detach nested target/argument values before queue mutation. Tests mutate caller containers while the action is queued, and verify an uncloneable invalid argument cannot stop the current run or dispatch replacement work. |
| Runtime status | Copy render settings and painter arrays at the public return boundary. Mutating returned nested fields cannot change the runtime configuration. |
| Render request | Copy flat viewport values and detach caller-owned inspection scenes before awaiting. Tests mutate them while a painter is suspended and assert the original input is rendered. Inspection rendering also avoids the unrelated full live-scene dump. Painters borrow shared read-only request/asset values; recording event consumers likewise borrow shared read-only snapshots. |
| Context encoding | Encode status, scene, archive and log values before filesystem awaits. Tests mutate input data immediately after calling the writers and verify the original values reached disk, including the captured pid sidecar. Already encoded strings need no additional deep copy. |
| File commit | Reuse one same-directory temporary-write/rename implementation for control, scene, recordings and both image painters. Injected partial-write and rename failures preserve the previous file, remove temporary output and permit a later successful commit. Binary writer inputs remain stable until completion; there is no per-painter image-buffer clone. |
| Background failures | Status/log writes and automatic sync checkpoints report failure events rather than unhandled rejections. The sync's committed scene remains readable and dirty until a successful retry. Screenshot response failures after transport loss are also reported. Real blocked-directory and injected checkpoint/transport tests reproduce these paths. |

All 48 affected files pass Oxfmt and the full repository JavaScript lint passes with warnings denied. Core **561**, agent **160**, web **211** tests pass (**932** total), along with affected typechecks/builds, version consistency and all **7** release-tool tests. Built-CLI seeded Schelling acceptance reports three completed actions, time 3, lifecycle recording, matching replay, a 34,101-byte PNG and exit codes 0/2/5/6. The controller microbenchmark is approximately **17 ms** per 30,000 actions on this host. Per-file rename atomicity does not imply an all-target transaction or fsync-backed crash durability. Existing core/agent **0.3.4** changelog entries are extended without new bumps or an Unreleased section.
