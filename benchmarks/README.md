# TenSnap benchmark workloads

`packages/benchmark` is an execution harness only. This directory owns the
versioned benchmark models, deterministic fixtures, semantic contracts, and
publication profiles. Every runnable case is a registered workload; there is
no interactive benchmark page or unregistered browser case.

## Run

```bash
# Quick protocol/codec/WS check
pnpm bench run --profile benchmarks/profiles/smoke.json

# Install the pinned browser once, then execute every registered browser case.
pnpm bench:browser:install
pnpm bench:browser:all

# Submission suites
pnpm bench run --profile benchmarks/profiles/tensnap-core-v0.3.json --out benchmark-results/core-v0.3
pnpm bench run --profile benchmarks/profiles/paper-v0.3.json --out benchmark-results/paper-v0.3
pnpm bench verify --input benchmark-results/paper-v0.3
pnpm bench report --input benchmark-results/paper-v0.3
```

Each run writes `manifest.json`, `samples.jsonl`, and `report.md`. The manifest
records implementation and harness SHA, dirty state, lockfile hash, machine
fingerprint, Chromium version, exact configuration, raw samples, wire bytes,
auxiliary measurements, and state hashes. Do not use an artifact whose
`verify` command fails.

## Workload kinds

`protocol` workloads are the actual TenSnap simulator contract. The v0.3
random walk checks handshake and transactional synchronization, zero-delta
steps, sparse update cardinality and fields, and final state. It runs through:

- `node`: binding and independent JSON/MessagePack codec boundaries;
- `ws`: a real loopback WebSocket with validated endpoints;
- `browser`: production Vite output, pinned Chromium, production Web host, and
  real WebSocket transport.

`node` workloads isolate meaningful renderer-core operations without making
them look like transport performance:

- `core-trace`: sparse item updates, chart append, and structured monitor
  replacement in `Scenario`;
- `state-sync`: `RendererSession` staged replacement transaction and commit;
- `snapshot-restore`: recording, archive encoding/decoding, and materialized
  restore.

All agent-bearing fixtures reject configurations above 10,000 agents.

`browser` workloads are deterministic renderer experiments. The
`browser-all-v0.3` profile runs every one by command line, including the
production TenSnap renderer and the direct Canvas 2D and direct Leafer control
implementations. They consume the same seeded random-walk state trace and
verify its final canonical state hash. Browser reports therefore contain both
the frame-bound `cycle` measure and `browserMutationMs`, the synchronous work
before the shared requestAnimationFrame barrier. Use the latter to distinguish
renderer work when headless Chromium is cadence-limited.

## Interpreting comparisons

The Canvas 2D and direct-Leafer workloads answer a narrow, reproducible
question: what overhead does TenSnap add over the same state trace and drawing
backend? They are renderer controls, not claims about a different ABM model.
The protocol random-walk browser run separately reports complete user-visible
TenSnap action-to-frame latency including binding, codec, WebSocket, and Web
state application.

Do not rank a separately implemented Mesa/Solara or NetLogo model beside these
numbers as a renderer result. Such a study must be an additional system-level
profile with a locked external environment, a canonical model specification,
and per-step semantic invariants; it measures model runtime and UI together.

## Extending the baseline

Add a versioned workload under `v0.3/` (or a future protocol directory) and
register it in `registry.ts`. Choose `protocol`, `node`, or `browser` according
to the path being measured. A protocol workload requires a semantic validator
and independent expected state; every local/browser workload requires a
deterministic state snapshot and expected state. Profiles, not harness code,
select the cases to publish.
