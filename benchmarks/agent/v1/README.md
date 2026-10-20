# Agent CLI v1 benchmarks

This versioned subject reuses the generic benchmark harness for Schelling control, frozen bounded queries, and deterministic random-walk history collection. The first version uses JavaScript bindings and real loopback WebSockets. Operations are scripted; no LLM/provider calls are involved.

## Root evaluation commands

The default `paper-2026.json` matrix includes `agent-cli-v1`. The standalone specification selects just these experiments and checks native Node/canvas/SQLite plus Python's standard-library archiver:

```sh
pnpm evaluation plan --spec benchmarks/evaluation/agent-cli-v1.json --smoke
pnpm evaluation doctor --spec benchmarks/evaluation/agent-cli-v1.json --python python3
pnpm evaluation run --spec benchmarks/evaluation/agent-cli-v1.json --python python3 \
  --smoke --out benchmark-results/agent-cli-evaluation-smoke
pnpm evaluation verify --python python3 --input benchmark-results/agent-cli-evaluation-smoke
```

The runner builds the public CLI, verifies evidence, and publishes checked reports, three CSV/LaTeX tables (`agent-cli-control`, `agent-cli-query`, `agent-cli-collection`) and data/figure archives. `resume`, `export` and `extract` use the existing root command contracts. Offline verification reconstructs scientific references without starting a simulator or daemon.

The explicit smoke profile has 14 conditions. Evaluation smoke uses one replicate per condition; direct execution uses two. Small grids/action counts validate every operation and force rolling eviction. Smoke accepts dirty source and produces diagnostic data. For publication, omit `--smoke`, use reviewed committed source and a fresh output. The full profile has 57 conditions and 15 randomized independent blocks (855 replicates).

Direct harness execution requires a fresh CLI build:

```sh
pnpm build:agent
pnpm bench run --profile benchmarks/profiles/agent-cli-smoke-v1.json \
  --out benchmark-results/agent-cli-direct-smoke
pnpm bench verify --input benchmark-results/agent-cli-direct-smoke
pnpm bench analyze --input benchmark-results/agent-cli-direct-smoke
```

Samples record a digest of the built JavaScript alongside source/environment identity. Existing outputs are immutable. Resume requires identical source and environment; choose a fresh output after implementation changes.

## Conditions

| Workload | Full profile | Primary timing |
| --- | --- | --- |
| Schelling control | 50×50, density/threshold 0.8; 5 preparation + 495 target actions, final tick 500; individual CLI steps, CLI batch, HTTP batch | Complete target batch, including CLI startup/exit or HTTP responses; startup/preparation excluded |
| Frozen query | 25×25, 50×50, 100×100; snapshot, population monitor, typed agent, radius-3 neighbors, cell; CLI/HTTP; 5 warm-ups + 30 queries | One complete command/response against the prepared boundary; scientific checking excluded |
| Collection | 1,000 agents × 1,000/5,000/20,000 actions and 10,000 agents × 1,000 actions, 10% changes/action; extra 1%/100% at 1,000 agents × 1,000 actions | Complete CLI workflow through settlement and final persistence when requested |

Collection compares no recording, bounded JSON archive, full-history indexed store and rolling store. Archives explicitly allow the full run (actions + 10 frames, 512 MiB); truncation fails. Stores use 4 MiB segment, 8 MiB pending input, two pending segments, 1 MiB decoded-cache and 2 GiB encoded-storage budgets. Rolling retains 128 transitions plus a baseline. No triggers/checkpoints are enabled. Random-walk emits no charts/logs, so these conditions do not measure growing chart/log histories.

Archive timing includes `recording start`, bounded run and `recording stop` through file publication. Store timing includes initialization and final commit in `run start --collection ... --until persisted`. Config-file creation is excluded. Extra CLI calls belong to their workflows. Retention contracts differ, so collection modes do not enter a paired superiority ranking.

`runtimeSettledMs` is the daemon's monotonic run duration, including per-action host/store barriers. `completionOverheadMs` is whole-workflow time minus that duration: CLI startup, control round trips and finalization, **not a storage-only persistence tail**. It is checked rather than clamped to zero. Scientific/status assertions run after the measured workflow; normal client response parsing remains part of the workflow. Single-step command latencies are an auxiliary series. Rendering/PNG encoding is excluded. Runs use manual rendering, JSON and error validation; metadata records actual host codec settings and daemon configured policies, without presenting configuration as a low-level validation probe.

## Resources and correctness

- `startupReadyMs` measures new foreground daemon spawn to ready against an already listening model. It is not an OS cold-cache measurement.
- `daemonMaxRssBytes` and `hostMaxRssBytes` are separate process-lifetime high-water values captured on graceful exit. They include initialization, exclude short CLI processes/offline readers, and cannot be summed into a simultaneous aggregate peak.
- `recordingDiskBytes` sums retained file sizes after shutdown/offline checking, including SQLite indexes. `storedEncodedBytes` is payload-budget accounting. `contextDiskBytes` may already include an archive and must not simply be added to recording bytes. File size is not allocated disk blocks.
- Each replicate owns fresh processes and an isolated context. Shutdown/persistence complete before offline reads. Temporary contexts and full histories are removed afterward.
- Independent seeded models check time, typed agent IDs and x/y positions. Query expectations use plain-array scans, selected fields, limits, truncation and cursor presence, without calling the production query engine. Control conditions share a canonical-state equivalence group.
- `measurementEvidence` retains the actual action/run completion summaries, monotonic runtime timestamps, transaction durations, response byte counts and recording commit status. Offline verification checks these against the requested workload, stage arithmetic and throughput. Accepted commands, unknown state, failed actions, missing commits and mixed CLI builds do not pass.
- Histories check retained counts/truncation and independently reconstructed initial-retained, middle and final states. Small observed/reference proofs remain in raw samples; large temporary histories are not retained. This projection/history check complements the separate cross-language checkpoint/RNG workflow audit.

## Integration boundary

The subject owns its driver, oracle, configuration and report extension. Profiles reference `benchmark.ts` for execution and declare an `artifactExtension` with a repository-relative `module` and SHA-256 `sources` map. The map pins production subject files and the shared model sources determining its reference model, configuration and measurements. Source checks run before workload loading and offline extension import; mismatches require the recorded source checkout. This also prevents resuming these profiles after editing a pinned driver while leaving the source commit unchanged. Refresh the pinned hashes only when intentionally updating a profile's source dependency. The module exports `verify()` and `tables()` through the public harness types. The same extension participates in `bench verify`/`analyze`, evaluation archive verification and CSV/LaTeX export. Generic code contains no subject-name/version/path dispatch.

Other workloads can reuse the extension interfaces. Extensions are trusted source modules: deterministic, offline and free of workload-starting side effects. Profiles without extensions retain their prior contracts. The extracted random-walk model is shared with the v0.3 protocol benchmark, with unchanged dynamics and workload ID.
