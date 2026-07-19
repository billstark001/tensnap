# Benchmark results: macOS 15.7.5 arm64

This directory contains the complete rerun of the Schelling v2 benchmark
matrix. It supersedes an earlier local run affected by concurrent system load.
The six profiles below were executed sequentially against source commit
`771a9601206e629b2a09fbe8049df4d5667dc3ad`, and every manifest records
`implementation.dirty: false`.

## Run record

- Local date: 2026-07-20 (Asia/Tokyo, UTC+09:00).
- Run window: 05:51:46--06:51:50 JST (2026-07-19
  20:51:46--21:51:50 UTC).
- Scientific configuration: 50x50 grid, similarity threshold 0.8, final tick
  500. UI and in-memory NetLogo profiles use 5 warm-up actions followed by 495
  measured actions; kernel subjects execute 500 model steps.
- Replication: 15 fresh, process-isolated replicates per condition. UI profiles
  randomize condition order within each replicate block.
- Timestamp provenance: start times below were recorded from the journal
  creation timestamps before the append-only journals were removed; completion
  times are the generated artifact timestamps in each `manifest.json`.

| Profile | Conditions | Samples | Start (JST) | Complete (JST) |
|---|---:|---:|---|---|
| `schelling-kernel-v2` | 4 | 60 | 05:51:46 | 05:53:59 |
| `schelling-ui-go-v2` | 3 | 45 | 05:54:00 | 05:57:28 |
| `schelling-ui-js-v2` | 3 | 45 | 05:57:29 | 06:00:59 |
| `schelling-ui-julia-v2` | 4 | 60 | 06:01:00 | 06:21:30 |
| `schelling-ui-mesa-v2` | 4 | 60 | 06:21:31 | 06:50:43 |
| `schelling-netlogo-render-v2` | 1 | 15 | 06:50:44 | 06:51:50 |

## Execution environment

| Component | Recorded value |
|---|---|
| Operating system | macOS 15.7.5 (Darwin 24.6.0), arm64 |
| Processor and memory | Apple M3, 8 logical CPUs, 16 GiB RAM |
| Node.js / V8 | 24.14.1 / 13.6.233.17-node.44 |
| pnpm user agent | 11.9.0 |
| Browser | Headless Chromium 149.0.7827.55, 1280x800, device scale factor 1 |
| Python / Mesa / Solara | 3.12.13 / 3.5.1 / 1.57.3 |
| Go | 1.26.5 |
| Julia / Agents.jl / WGLMakie | 1.12.6 / 7.0.2 / 0.13.11 |
| NetLogo / PyNetLogo / Pillow | 7.0.4 / 0.5.2 / 11.3.0 |

Versions not emitted directly by a subject are taken from the immutable
dependency locks whose hashes are recorded in the profile and manifest.

## Contents

Each profile directory contains `manifest.json`, `samples.jsonl`, `report.md`,
and derived files under `analysis/`. Mesa/Solara and Julia/WGLMakie additionally
retain visually stable PNG checkpoints. The NetLogo rendering profile retains
its final state-validated PNG, but measures only model transition, patch
recoloring, and in-memory view rasterization; final PNG encoding occurs outside
the timed interval and no measured action performs file I/O.

Append-only `.journal.jsonl` files are not retained: they duplicate raw sample
payloads and are only needed to resume an interrupted run. The finalized
`samples.jsonl` and manifest integrity hashes are the archival records.

## Commands executed

```bash
pnpm bench run --profile benchmarks/profiles/schelling-kernel-v2.json --out benchmark-results/macos-15.7.5-arm64/schelling-kernel-v2
pnpm bench run --profile benchmarks/profiles/schelling-ui-go-v2.json --out benchmark-results/macos-15.7.5-arm64/schelling-ui-go-v2
pnpm bench run --profile benchmarks/profiles/schelling-ui-js-v2.json --out benchmark-results/macos-15.7.5-arm64/schelling-ui-js-v2
pnpm bench run --profile benchmarks/profiles/schelling-ui-julia-v2.json --out benchmark-results/macos-15.7.5-arm64/schelling-ui-julia-v2
pnpm bench run --profile benchmarks/profiles/schelling-ui-mesa-v2.json --out benchmark-results/macos-15.7.5-arm64/schelling-ui-mesa-v2
pnpm bench run --profile benchmarks/profiles/schelling-netlogo-render-v2.json --out benchmark-results/macos-15.7.5-arm64/schelling-netlogo-render-v2
```

The completed outputs were then retained under this
`artifacts/benchmark-results/macos-15.7.5-arm64/` directory; resumable journals
were removed after successful final verification.

## Verification

From the repository root:

```bash
for directory in artifacts/benchmark-results/macos-15.7.5-arm64/*-v2; do
  pnpm bench verify --input "$directory"
done
```

All six directories passed verification after the rerun. Verification checks
the profile and source hashes, complete run matrices, raw-sample integrity,
declared comparisons, and retained visual files.
