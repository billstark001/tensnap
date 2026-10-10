# Schelling checkpoint workflow audit

This publication driver operates four real Schelling hosts through the built agent CLI. It checks protocol projections against opt-in independent model audit writers, captures at time 5, advances three steps, restores, compares the three rerun points, runs two six-step threshold branches and retains a PNG.

```sh
node benchmarks/schelling/headless/run.mjs --out benchmark-results/schelling-workflow
# A host subset is diagnostic and does not satisfy the four-host batch verifier.
node benchmarks/schelling/headless/run.mjs --hosts python,go --out benchmark-results/workflow-subset
```

Output is published to a fresh directory; an existing output is never replaced. The CLI is built unless `--skip-build` is supplied by an owning orchestrator. Julia uses `benchmarks/evaluation/environments/julia` by default; the orchestrator sets the exact committed project through `TENSNAP_JULIA_PROJECT`.

Each host retains a report, the original checkpoint capture bytes and a PNG. Hashes are computed over the same checkpoint bytes actually retained. The summary records the source inventory and within-host comparisons; different language RNGs and schedulers need not produce the same microscopic trajectory. Exact continuation concerns the independently audited fields of each model.

Temporary daemon contexts and sidecar files are cleaned up after each host. A failed run leaves its staging evidence and failure log for diagnosis and never publishes a completed output. The batch adapter restarts a failed workflow and performs an independent offline check before accepting its output.

See [`../../evaluation`](../../evaluation/README.md) for the complete paper matrix, standalone verification, gzip archive and table exporter. The published summary is in `benchmark-results/evaluation-full-2026-10-09/export/reports/schelling-workflow/`. Full extraction supplies original per-host reports/checkpoints under `raw/schelling-workflow/`; figures-only extraction supplies its original PNGs. Use `pnpm evaluation verify` for offline validation; it does not launch any host.
