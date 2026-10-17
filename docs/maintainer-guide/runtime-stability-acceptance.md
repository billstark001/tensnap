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
