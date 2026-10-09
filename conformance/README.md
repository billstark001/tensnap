# Protocol conformance

The deterministic hosts and independent private-state sidecars live in [`fixtures/`](fixtures/). The probe drives four language bindings over JSON and MessagePack, the public renderer client, schema traces and harness canaries.

```sh
# Live regression checks; does not require or write saved results.
python conformance/run_matrix.py --check
pnpm exec tsc --noEmit -p conformance/tsconfig.json

# Publish new saved evidence to a fresh, ignored directory.
python conformance/run_matrix.py --write --out benchmark-results/conformance

# Offline validation; does not launch hosts.
python conformance/run_matrix.py --verify --input benchmark-results/conformance

# Optionally compare saved source digests while also running live checks.
python conformance/run_matrix.py --check --input benchmark-results/conformance
```

`--write` requires all four bindings and publishes through a staging directory. `--check --bindings python` is available for a diagnostic subset. Saved results contain `results.json`, `MATRIX.md` and sixteen per-property files under `evidence/`; they are generated outputs, not source fixtures. The CI workflow runs live `--check` and needs no retained matrix in the source checkout.

For the paper's locked environment, full batch, gzip evidence and table export, use [`benchmarks/evaluation`](../benchmarks/evaluation/README.md). Historical results are retained in the companion paper archive and source Git history. The transport-neutral trajectories under [`traces/`](traces/) remain test inputs.
