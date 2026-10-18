# Runtime recording workflow acceptance — 2026-10-18

## Scope and baseline

The requested main-worktree branch is `feature/runtime-recording-workflows`, based on `5f41c7c2` (the merge of plan A). The original planning baseline was `ee261d0b`; A1–A4 were already merged when this work began. The user confirmed that this delivery covers B1–B3 and C1–C3 only. B4–B5 and C4–C5 remain deferred, with no placeholder commands or claims of crash recovery.

No wire contract changed: protocol version remains 0.3. The independent recording wrapper is version 1; existing segmented archives remain version 1 and project files remain version 3, with released v0/v1/v2 migrations preserved. `core`, `agent`, `web` and `tauri` each receive exactly one patch bump: 0.3.5, 0.3.5, 0.3.6 and 0.3.5 respectively. Other packages and evaluation exports are unchanged. Active evaluation locks reference the unchanged workspace lockfile and example manifests, so no environment fingerprints require replacement.

## Delivery mapping

| Plan items | Commits | Result |
| --- | --- | --- |
| B1a–B1b | `58fcb7f0` | Pure `core/persistence` extraction, development/publish exports, Web consumer migration, removal of old internal modules |
| B2a–B2b | `b13e46b2`, `75884542`, `a81680d7` | Independent recording wrapper, resource closure/reporting, strict ranges/lengths/provenance, sparse/nonmonotonic time selection, retention metadata |
| B3a–B3b | `e0babecb`, `75884542`, `a81680d7` | Owned captures, revision/checkpoint association, historical frame materialization, independent model/history restore, rolling checkpoint invalidation |
| C1 | `677ee5de` | Correlated action/run waits, deadlines without cancellation, retained outcomes and classified HTTP/CLI failures |
| C2a–C2b | `677ee5de`, `33b69d45` | Context catalog, manual/automatic normal-completion persistence, offline info/seek/inspect/render/export-frame, shared painter batches |
| C2c | `ac9b29a9`, `284a95ca` | Empty-app recording open, external project selection without connection, full timeline, auto layout, separate full/frame export, localized native menu |
| C3a–C3b | `677ee5de` | Exclusive evidence directories, fixed-scene painters, checksummed manifest/state/images, partial failure preservation, verified restore and exact scene/checkpoint comparison |

The final release/documentation commit includes this record, the dated version table, API/runtime guidance and a regression for rolling checkpoint invalidation.

## Verification

| Checks | Outcome |
| --- | --- |
| Core full Vitest suite | 577 passed in the final full run, including the rolling-checkpoint regression |
| Agent full Vitest suite | 359 passed |
| Web full Vitest suite | 214 passed |
| Core, agent, Web, Tauri TypeScript | Passed |
| Core, agent and Web production builds | Passed |
| Tauri `cargo check --locked --offline` and Rust formatting | Passed on macOS; includes native localized menu construction |
| Web/Tauri Lingui extraction and strict compilation | Passed; English, Chinese and Japanese catalogs complete |
| Repository Oxlint, version consistency and release tests | Passed; release tests 7/7 |
| Installed npm tarball acceptance | Passed, including pure Node import and JSON/MessagePack round trips through the published `core/persistence` entry |
| Seeded real Schelling CLI workflow | Passed, including multi-target output path separation |

The tarball test installs actual locally packed dependencies outside the checkout. The persistence probe imports without `window`, Web aliases or a Web tsconfig. It tests both recording and existing project round trips from published artifacts, followed by installed CLI sync, bounded recording, headless PNG and shutdown.

### Plan test matrix

| Matrix entries | Evidence |
| --- | --- |
| T03–T07, T17 | Existing runtime/controller tests plus new by-ID wait tests, persistence deadline/retry tests, versioned offline errors, argument/HTTP validation and installed CLI acceptance |
| T09 | Existing 22 project migration/round-trip tests preserved; published pure Node persistence probe passes |
| T10–T12 | `core/src/persistence/recording.test.ts`: JSON/MessagePack assets, binary checkpoints, chart/monitor state, control/sync frames, explicit legacy imports, corrupt lengths/versions/order, unresolved resources, sparse frames and repeated/backward time |
| T13–T16 | `CapturedFrame.test.ts`, `RendererSession.test.ts`, `frame-files.test.ts`: owned nested state, unchanged revision required for checkpoint capture, no invented historical checkpoints, schema/identity validation, checkpoint-only local history operations and rolling invalidation |
| T18 | Runtime recording tests: admission/conflict checks, pending/failed/persisted results, write failure and bounded retention; frame and recording output failures remain classified |
| T19–T20 | Project/file-operation tests plus real browser UI: empty app open, initial frame, full timeline, generated controls, disabled parameter edits, active-source protection, external project recording selection without opening its source |
| T21 | Fixed-frame painter test mutates the caller's scene while requested images are pending; all outputs retain the original capture. A required target failure preserves partial output without a successful manifest |
| T22 | Renderer restore failure/timeout tests preserve history and expose certainty; checkpoint-only truncate sends no projected time. Real checkpoint restore replaces the saved chart prefix |

A1/A4 behavior was rechecked through the full core/agent suites; this branch does not claim to reimplement those completed items. No original slides, tapes or experiment artifacts were edited to manufacture passing results.

## Reproduce the real-model acceptance

```sh
pnpm --filter @tensnap/agent test:recording-workflow
pnpm --filter @tensnap/agent test:package
```

The real-model script starts seeded Schelling (12 × 10, seed 42) and interacts only through the built public CLI. Five successful target actions produce six recording frames because the stop lifecycle is also recorded; model time ends at 5. It saves a required checkpoint and environment/chart images, advances once, restores with `history=replace`, and verifies exact public-scene/chart equality. A second advance after restore matches both the first branch's scene and its opaque checkpoint bytes. Original evidence is retained in separate directories.

The script stops the simulator and daemon before offline inspection, model-time selection, frame export and rendering. `time=5, match=last` selects frame 6, explicitly distinguishing time from frame index. Exporting frame 3 and rendering its single-frame recording again produces identical PNG bytes on this host. A requested missing environment exits 5 and produces explicit failed partial evidence. Rendering all environments/charts produces distinct output paths.

The generated `acceptance.json` records every CLI command and result under `.tensnap/recording-acceptance-<timestamp>/`. These outputs are local disposable acceptance evidence, not benchmark or publication results. No paid LLM/provider request is made.

## Browser → CLI round trip

A fresh isolated Chromium app opened the generated recording through **File → Open recording** using the existing browser file picker. It started at frame/model time 0 with all six recorded frames, generated environment/chart/monitor views and playback controls, and disabled parameter editing and active-source deletion. The inspector's timeline selected frame 3/model time 3, then **Export current frame** wrote `browser-frame3.tensnap-recording.json` through the real save dialog.

CLI `recording info` reported one independent state boundary, original recording/frame/action provenance, complete resources and no fabricated historical checkpoint. `recording export-frame --frame 0` rendered that browser export; `frame compare` against CLI's original frame-3 evidence returned `equal: true, changes: []`. The corresponding 640 × 480 environment PNGs were byte-identical (`cmp` exit 0). Browser rendering was visually inspected, with no JavaScript errors. This uses the stopped simulator's retained file; the offline tab never connects a model source.

Local outputs for this round trip are under `.tensnap/acceptance-recording-20261018/final/`. Browser upload exposed and led to a regression for JSON stored in an ArrayBuffer by an adapter; format detection now examines contents rather than assuming binary containers mean MessagePack.

## Boundaries

Normal completion uses temporary same-directory writes and complete directory/manifest commits. There is no fsync, segment-store, crash-tail or restart reconstruction promise for pending operations. Retained run/action summaries are process-local; persisted recordings are rediscovered from the context directory. Missing historical checkpoints remain unavailable. Exact capture depends on a conforming simulator publishing its state changes and honoring its checkpoint boundary; recorded renderer replay does not promise future external-provider reproducibility.

Compatibility is limited to released file migrations, bare recording legacy import, public quota spellings and low-level payload-time truncate behavior. Removed Web modules have no code-only compatibility aliases. Native menu code and shared Web file handling were checked; no desktop installer was built or published. The branch is intended for review and must not be merged automatically.
