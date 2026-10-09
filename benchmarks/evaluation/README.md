# Paper evaluation

This directory declares the paper experiment matrix, table selectors, scientific runtime locks and portable gzip format. The orchestration modules live in `packages/benchmark/src/evaluation`. Existing benchmark subjects continue to own their measurement intervals and correctness oracles; the orchestrator does not insert archive work into a timed interval.

## Environment

Use Python 3.13 on the recorded macOS arm64 environment. The complete Python lock includes Mesa, Solara, NetLogo bridge dependencies and CPU PyTorch. Its `ipyvue` and `ipyvuetify` pins retain the Vue 2 widgets used by Solara 1.57.3. Import the local Python binding through the orchestrator's `PYTHONPATH`, rather than a separately installed TenSnap release.

```sh
pnpm install --frozen-lockfile
pnpm bench:browser:install
python3.13 -m venv .evaluation-venv
.evaluation-venv/bin/python -m pip install -r benchmarks/environments/python-evaluation.requirements.lock
julia --project=benchmarks/evaluation/environments/julia -e 'using Pkg; Pkg.instantiate()'
```

NetLogo 7.0.4 is required; set `NETLOGO_HOME` if it is not installed at `/Applications/NetLogo 7.0.4`. Go, Julia and pnpm must be available on `PATH`. Pass `--python /absolute/path/to/python` or set `TENSNAP_EVALUATION_PYTHON` for an alternative interpreter matching the lock. Both Julia probes and workflow hosts use the committed evaluation project and its relative local binding path.

Go subjects use the evaluation `go.mod` through `-modfile` with `-mod=readonly`. Its relative replacements resolve from the existing subject module root, so the historical subject files and locks stay intact.

`doctor` checks every profile/lock hash, Python dependencies, local Python/Julia binding resolution, Go dependency resolution and Chromium startup before any timed experiment. Runtime versions and source fingerprints are saved with the batch. Publication runs require a clean source commit; diagnostic runs record the dirty source bytes.

## Commands

From the repository root:

```sh
pnpm evaluation plan
pnpm evaluation doctor
pnpm evaluation run --smoke --out benchmark-results/evaluation-smoke
pnpm evaluation verify --input benchmark-results/evaluation-smoke

# Commit the reviewed source before the publication run.
pnpm evaluation run --out benchmark-results/evaluation-2026
pnpm evaluation resume --input benchmark-results/evaluation-2026
pnpm evaluation verify --input benchmark-results/evaluation-2026/export/evidence.tar.gz

# A second export can go directly into the companion paper repository.
pnpm evaluation export --input benchmark-results/evaluation-2026 --out /absolute/path/to/paper/artifacts/evaluation-2026
```

`--spec PATH` selects a reusable experiment specification. Each experiment has a unique ID and one of four adapters: benchmark, conformance, workflow or Fire/DQN. `archive` is an alias for `export`, which emits both evidence and tables.

The complete matrix contains eight conformance connections, four Schelling workflow hosts, seven performance profiles with 1,680 fresh-process replicates, and five 500-episode Fire/DQN training runs plus their declared holdouts. Profile order is fixed; each performance profile retains its own randomized blocks. Performance experiments run sequentially to avoid concurrent experiment load.

Smoke retains all 112 performance conditions but uses one replicate and short action series. Kernel conditions retain their 500-step trajectory as one sample. The conformance and four-host checkpoint audit retain their actual assertions. Fire/DQN smoke uses two training/reference/stability episodes per policy and is explicitly marked diagnostic. Smoke estimates are not publication evidence.

## Output, recovery and verification

A running batch writes `batch.json`, raw experiment directories, per-profile journals and logs. Each completed experiment is verified before its progress record becomes complete. Resume accepts prior work only when the source commit, source bytes, profiles, dependency locks and recorded environment match. The benchmark adapter uses the harness's per-replicate journal recovery. Conformance and the workflow are rerun as a complete experiment after failure; Fire/DQN restarts its training/evaluation experiment after failure.

An exclusive `.execution.lock` prevents two runners from owning a batch. Normal errors and signals remove the lock. After a forced kill, confirm that no runner is active before removing a leftover lock and resuming. Publication output folders and exports are never overwritten.

After all experiments pass, the runner verifies the whole batch, creates the export, extracts it to a temporary directory, reruns offline verification and rebuilds its tables. Only then are raw files, journals, profiles and logs removed from the outside of the archive. A completed batch retains:

```text
batch.json
export/
  index.json
  summary.md
  evidence.tar.gz
  tables/                 # JSON, full-precision CSV and standalone LaTeX tables
  reports/                # human reports and compact analyses
  figures/                # retained PNG evidence
```

The gzip inventory checks every file's size and SHA-256. Timestamps, ownership and ordering are fixed for deterministic compression. Extraction rejects links, duplicate members and paths outside the destination. The export index also checks the complete external result-file set. `verify` performs offline checks; it never starts a simulator, training loop or timing workload.

`export` accepts a live batch, a completed/pruned batch or its `evidence.tar.gz`. Use `--prune` only with `--out INPUT/export` to request verified pruning manually. Failures leave the original evidence available; incomplete batches cannot export.

## Tables and scope

`tables.json` names the exact run IDs and metrics used in the paper. Protocol median/P95 values are measured-action statistics. Model-step values divide the median of 500-step replicate totals by their declared step count. rAF and timeout rows must have their respective primary metrics; a mismatched or ambiguous run fails export. Conformance `2/2` counts encodings, and workflow `3/3` counts future trajectory points. Their interpretation is not changed by the orchestration.

CSV preserves numeric precision. LaTeX rounds fractional display values to three decimal places and requires `booktabs`, `tabularx` and `array`. The exporter additionally retains the recording storage metrics, all sixteen conformance properties and the Fire/DQN policy/stability results. It does not edit manuscript prose or widen scientific claims. Table selectors are retained in the evidence archive for later exports.

Historical outputs were moved to the companion paper repository as `artifacts/evaluation-before-rerun-2026-10-09.tar.gz`, which includes its original file inventory. The source Git history retains the old measured revisions and result snapshots. The immutable historical profiles remain available; the `evaluation-2026-*` profiles record current locks for the new batch.
