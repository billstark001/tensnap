# Schelling checkpoint workflow audit

This publication driver operates four real Schelling hosts through the built agent CLI. It checks protocol projections against opt-in independent model audit writers, captures at time 5, advances three steps, restores, compares the three rerun points, runs two six-step threshold branches and retains a PNG.

It then restores the time-5 checkpoint, changes the next-reset seed to 42 and
captures a temporary checkpoint. All three subsequent points must retain the
original active state, agent positions and RNG trajectory; only the staged seed
is excluded from the active-state comparison. After overwriting the seed with 99,
one more step independently observes seed 99 in the live model audit. Restoring
that capture must recover seed 42 and the same three-step future. Two resets must produce identical
seed-42 initial states, distinct from the original seed-7 population.

```sh
node benchmarks/schelling/headless/run.mjs --out benchmark-results/schelling-workflow
# A host subset is diagnostic and does not satisfy the four-host batch verifier.
node benchmarks/schelling/headless/run.mjs --hosts python,go --out benchmark-results/workflow-subset
```

Output is published to a fresh directory; an existing output is never replaced. The CLI is built unless `--skip-build` is supplied by an owning orchestrator. Julia uses `benchmarks/evaluation/environments/julia` by default; the orchestrator sets the exact committed project through `TENSNAP_JULIA_PROJECT`.

Each host retains a report, the original checkpoint capture bytes and a PNG. Hashes are computed over the same checkpoint bytes actually retained. The summary records the source inventory and within-host comparisons; different language RNGs and schedulers need not produce the same microscopic trajectory. Exact continuation concerns the independently audited fields of each model.

Seed checks are runtime assertions: a failure stops the driver. Reports,
trajectory points and the offline verifier retain their original format and
checks. Seed observations are not added to the publication report, and the
temporary seed checkpoint is removed with the host context.

The driver prints a diagnostic directory under the system temporary directory.
Its per-host JSONL traces retain raw audit observations and protocol agent
projections, with phase labels for seed overwrite, restore, replay and reset.
These traces are diagnostic files without a report schema or offline acceptance
contract. They remain available after host cleanup, including on failure.

Temporary daemon contexts and sidecar files are cleaned up after each host. A failed run leaves its staging evidence and failure log for diagnosis and never publishes a completed output. The batch adapter restarts a failed workflow and performs an independent offline check before accepting its output.

See [`../../evaluation`](../../evaluation/README.md) for the complete paper matrix, standalone verification, gzip archive and table exporter. The published summary is in `benchmark-results/evaluation-full-2026-10-09/export/reports/schelling-workflow/`. Full extraction supplies original per-host reports/checkpoints under `raw/schelling-workflow/`; figures-only extraction supplies its original PNGs. Use `pnpm evaluation verify` for offline validation; it does not launch any host.

The driver launches the publication subjects in `../v1/subjects/{mesa,go,js,julia}`. Those adapters read `TENSNAP_SCHELLING_AUDIT_STATE`; ordinary example launchers ignore it. Audit callbacks are local to the model factory/definition, not shared module state. Current hosts advertise checkpoint schema 3. Mesa collector history begins a new segment after restore; it is not part of the independently compared scientific state. Historical schema-2 evidence above remains unchanged and is verified offline against its recorded identity.
