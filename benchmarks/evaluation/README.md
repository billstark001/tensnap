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

Publication source checks, including the Fire/DQN entry point, exclude generated results under `benchmark-results/`, `evaluation-results/` and the selected output/work/cache directories. Git-visible evidence can therefore be retained without invalidating its own run; tracked and untracked source edits still prevent publication.

Source checks exclude `benchmark-results/`, `evaluation-results/`, the selected batch output, and configured work/cache directories, even when Git can track their contents. Creating or updating these generated files does not invalidate the running batch. Benchmark child processes use the same exclusions. Changes to tracked or untracked source outside those directories still invalidate the batch; committing any change during a run also changes its recorded revision. Use dedicated generated directories, never a source directory, for output, work or cache paths.

## Commands

From the repository root:

```sh
pnpm evaluation plan
pnpm evaluation doctor
pnpm evaluation run --smoke --out benchmark-results/evaluation-smoke --gzip-level 6
pnpm evaluation verify --input benchmark-results/evaluation-smoke

# Commit the reviewed source before the publication run.
pnpm evaluation run --out benchmark-results/evaluation-2026
pnpm evaluation resume --input benchmark-results/evaluation-2026
pnpm evaluation verify --input benchmark-results/evaluation-2026/export/data.tar.gz

# A second export can go directly into the companion paper repository.
pnpm evaluation export --input benchmark-results/evaluation-2026 --out /absolute/path/to/paper/artifacts/evaluation-2026 --gzip-level 9

# Extract original figures only when needed, or unpack the complete checked evidence.
pnpm evaluation extract --input benchmark-results/evaluation-2026 --out benchmark-results/evaluation-figures --figures-only
pnpm evaluation extract --input benchmark-results/evaluation-2026 --out benchmark-results/evaluation-unpacked
pnpm bench verify --input benchmark-results/evaluation-unpacked/raw/protocol-core
```

`--spec PATH` selects a reusable experiment specification. Each experiment has a unique ID and one of four adapters: benchmark, conformance, workflow or Fire/DQN. `archive` is an alias for `export`, which emits both evidence and tables.

`--gzip-level 0..9` selects the compression level for both archives, defaulting to 6. It is accepted by `run`, `resume`, `export` and `archive`, and recorded in the export index. A resume with an existing verified export retains that export's compression level; choose a fresh export destination to recompress it. The extraction destination must be a fresh directory outside the export. `--figures-only` retains original evidence-relative paths, such as `raw/schelling-ui-mesa/screenshots/...png`.

## Working directories and caches

All commands accept `--work-dir PATH` and `--cache-dir PATH`. Relative paths resolve from the checkout root. Their environment equivalents are `TENSNAP_EVALUATION_WORK_DIR` and `TENSNAP_EVALUATION_CACHE_DIR`; explicit flags take precedence. Both directories must be outside `--out` so creating scratch space cannot create or alter the evidence destination.

| Purpose | Default | Lifetime |
| --- | --- | --- |
| Raw results, journals, profiles and logs | The required `--out` batch directory | Retained for recovery; pruned after the checked export |
| Temporary extraction and large export copies | `benchmark-results/.work/` | Unique operation directories; removed in `finally` |
| Runtime temporary files and workflow daemon contexts | `benchmark-results/.work/` through `TMPDIR`, `TMP` and `TEMP` | Runners remove their own temporary directories on completion |
| Python bytecode, Go build and Vite caches | `benchmark-results/.cache/{python,go,vite}/` | Reusable across runs; may be deleted when no run is active |
| Atomic output staging | Beside the selected output, with `.evaluation-export-`, `.archive-` or similar prefixes | Removed after successful publication or normal failure |

The final archive staging remains on the output filesystem so publishing uses an atomic rename/link even when `--work-dir` is on another disk. Large uncompressed copies and temporary extractions use the selected work directory. These defaults are Git-ignored. `plan` does not create working directories; `doctor` displays the selected work/cache locations.

Dependency installations remain separate from disposable caches: the Python environment is `.evaluation-venv`, browser downloads normally use `~/Library/Caches/ms-playwright` on macOS (`PLAYWRIGHT_BROWSERS_PATH`), Go module downloads use `go env GOMODCACHE` (`GOMODCACHE`), and Julia packages/precompilation use `DEPOT_PATH` (`JULIA_DEPOT_PATH`). These standard environment controls are inherited; moving dependency stores may require installing the locked dependencies at the new location.

```sh
pnpm evaluation run --smoke --out benchmark-results/evaluation-smoke \
  --work-dir /absolute/path/to/scratch --cache-dir /absolute/path/to/cache
```

Archive creation, gzip compression, sample compaction and batch table export run only after all declared experiments finish and the complete batch verifies. Each performance profile writes its raw artifact/report after its measured replicates finish, before the next profile starts. Journal records are synchronously persisted between replicates. Figure capture remains part of the existing correctness audit, outside the measured action intervals; archival processing is never inserted into a timed interval.

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
  data.tar.gz             # samples, compact manifests/journals, checkpoints and logs
  figures.tar.gz          # original PNGs and plots, with their original paths
  tables/                 # JSON, full-precision CSV and standalone LaTeX tables
  reports/                # human reports and compact analyses
```

No figures remain outside the archives, including SVG plots formerly copied into reports. Figure bytes are not reencoded. Each gzip inventory checks every file's size and SHA-256. Timestamps, ownership and ordering are fixed for deterministic compression. Extraction rejects links, duplicate members and paths outside the destination. Split archives must contain disjoint data and figure file sets. The export index also checks the complete external result-file set. `verify` performs offline checks; it never starts a simulator, training loop or timing workload.

Finder's `.DS_Store` files are excluded from evidence inventories and archives; opening an export in Finder does not invalidate it.

The compact archive keeps benchmark samples once in `samples.jsonl`. Each manifest run has a `samplesReference` containing a relative path, SHA-256 and run ID. Journal entries use `sampleReference` with the same fields plus the replicate block. These references replace embedded sample arrays and screenshot base64. The retained sample rows refer to original PNG paths and checkpoint hashes. Compaction verifies each journal record against its retained row before removing the embedded copy; resume journals remain unchanged while a batch is running.

Readers verify the referenced file hash and load the original samples in memory, so `bench verify`, `bench report`, `bench analyze`, journal merge and evaluation commands retain their behavior. Journal merge rehydrates referenced PNG bytes in memory for the existing artifact writer. Compacting an already compact export is supported. Tables are rebuilt from the checked archive and compared with the source tables before export succeeds.

`export` and `verify` accept a live batch, a completed/pruned batch, an export directory or `data.tar.gz` beside its required `figures.tar.gz`. Legacy `evidence.tar.gz` and schema-1 export indexes remain readable. `extract` supports both layouts and does not overwrite a destination. Use `--prune` only with `--out INPUT/export` to request verified pruning manually. Failures leave the original evidence available; incomplete batches cannot export.

## Tables and scope

`tables.json` names the exact run IDs and metrics used in the paper. Protocol median/P95 values are measured-action statistics. Model-step values divide the median of 500-step replicate totals by their declared step count. rAF and timeout rows must have their respective primary metrics; a mismatched or ambiguous run fails export. Conformance `2/2` counts encodings, and workflow `3/3` counts future trajectory points. Their interpretation is not changed by the orchestration.

CSV preserves numeric precision. LaTeX rounds fractional display values to three decimal places and requires `booktabs`, `tabularx` and `array`. The exporter additionally retains the recording storage metrics, all sixteen conformance properties and the Fire/DQN policy/stability results. It does not edit manuscript prose or widen scientific claims. Table selectors are retained in the evidence archive for later exports.

Historical outputs were moved to the companion paper repository as `artifacts/evaluation-before-rerun-2026-10-09.tar.gz`, which includes its original file inventory. The source Git history retains the old measured revisions and result snapshots. The immutable historical profiles remain available; the `evaluation-2026-*` profiles record current locks for the new batch.
