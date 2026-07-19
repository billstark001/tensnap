# TenSnap reproducible benchmarks

`packages/benchmark` is the generic execution harness. This directory owns the
versioned benchmark subjects, deterministic fixtures, semantic oracles,
dependency locks, and publication profiles.

## Boundary between examples and benchmark subjects

Files under `examples/` are user-facing examples. They contain the reusable
scientific model, configuration and small study/server helpers, plus runnable
teaching entry points. Useful capabilities such as Mesa data collection,
deterministic seeds, standalone sweeps, JavaScript WebSocket hosting and full
Go/Julia parameters remain available there. They do not emit benchmark JSON,
expose hidden DOM revision/state signals, or own artifact validation.

Benchmark-only code lives under
[`schelling/v1/subjects`](schelling/v1/subjects). A subject may import a clean
example's model API, but owns all of the following itself:

- fixed profile/environment configuration and scientific-version assertions;
- benchmark JSON adapters and process timing records;
- browser revision and canonical-state signals;
- benchmark-only framework setup and dependency locks;
- semantic validation required by a publication profile.

All Schelling subjects reuse their language's example model. Where useful they
also reuse a study, TenSnap scenario/server, or native-UI constructor. The
subject directories stay thin: Mesa canonical state is projected by the
adapter and its revision uses the example's ordinary model tick; WGLMakie and
Solara hidden DOM probes are attached only by benchmark wrappers. See
[`schelling/v1/README.md`](schelling/v1/README.md) for the exact mapping.

This gives each language three explicit layers:

1. model/config/study code that is useful to learners and researchers;
2. user-facing standalone or UI entry points;
3. versioned publication adapters that translate a profile into the shared
   code and add only harness output, signals and locks.

### Why some example files are split

This partial file split is a repository-level reuse trade-off, not additional
boilerplate required by TenSnap or by the underlying ABM framework. In the
Schelling examples, a `*_viz` launcher calls a reusable TenSnap server/scenario
or native-UI factory because a benchmark subject needs the same binding and
reset behavior. A `*_standalone` launcher calls a reusable `study` helper
because the kernel subject needs the same trial loop and statistics. The thin
launchers remain user-facing commands; the shared helpers prevent the example
and publication harness from acquiring subtly different dynamics.

A one-off application may keep these pieces in one file. Contributors should
split them here only when both the teaching entry point and a benchmark adapter
actually reuse the extracted behavior.

The language implementations intentionally remain independent so they are
readable examples and do not acquire a cross-language code generator. Within a
language, model construction, trial loops and server/app setup should not be
copied into benchmark subjects. Publication stability comes from the immutable
source commit, profile hash, dependency locks and `SCHELLING_DYNAMICS_VERSION`
(or its language equivalent), rather than from a second copy of each model.

## Quick start

```bash
# Protocol/codec/WebSocket smoke test.
pnpm bench run --profile benchmarks/profiles/smoke.json

# Install the pinned browser once, then run all registered browser cases.
pnpm bench:browser:install
pnpm bench:browser:all

# Submission profiles require a clean commit and all declared suites.
pnpm bench run --profile benchmarks/profiles/paper-v0.3.json \
  --out benchmark-results/paper-v0.3
pnpm bench verify --input benchmark-results/paper-v0.3
pnpm bench report --input benchmark-results/paper-v0.3
```

The NetLogo 7 rendering profile is intentionally separate from browser UI
profiles:

```bash
python3 -m venv .benchmark-venv
.benchmark-venv/bin/pip install -r \
  benchmarks/environments/python-netlogo7-render.requirements.lock
export PATH="$PWD/.benchmark-venv/bin:$PATH"
export NETLOGO_HOME='/Applications/NetLogo 7.0.4'

pnpm bench:netlogo:render
pnpm bench verify --input benchmark-results/schelling-netlogo-render-v1

# Current no-I/O profile: 0.8 threshold, exactly 500 ticks.
pnpm bench:netlogo:render-memory
pnpm bench verify --input benchmark-results/schelling-netlogo-render-v2
```

NetLogo is not browser based and a running GUI may skip display refreshes. The
adapter avoids an implicit frame-cadence claim by calling NetLogo's built-in
headless `export-view` after every action. It independently reads the 50x50
patch `group` state and checks every pixel block in the 400x400 PNG against the
documented NetLogo white/blue/red palette. The final checksummed PNG is retained
by the ordinary artifact writer.

This establishes exact agreement between the authoritative NetLogo patch state
and the exported native view. It does not establish cell-for-cell equality with
the independently implemented Mesa/Go/JavaScript/Julia models, whose random
number generators and scheduling differ. Cross-runtime dynamics remain a
distributional/specification comparison. The immutable v1 profile's declared
`actionToPngMs` metric includes model transition, patch recoloring, PNG
encoding, and file I/O; the artifact also reports those stages separately.

The v2 profile instead calls the public headless Java API to paint each view
into a `BufferedImage`. Its `actionToInMemoryViewMs` metric includes model
transition, patch recoloring, and in-memory view rasterization, but excludes
PNG encoding and all file I/O. It encodes only the final frame, after timing,
to retain the same state-to-pixel audit evidence. Both results are descriptive:
a headless CPU raster is not the same completion boundary as a
browser-presented `requestAnimationFrame`, so v2 must not enter a paired browser
latency comparison even though it removes the v1 I/O confound.

An output directory is published only after every planned run and replicate is
present and verified. It is created through a staging directory and atomic
rename, and an existing output directory is never overwritten.

## Long runs: journal, resume, shard, and merge

Every completed replicate is appended immediately to a journal. A late crash
therefore loses at most the active replicate, not the preceding hours of work.
Resume checks the profile hash, implementation commit and dirty state,
lockfile, complete execution-environment fingerprint, suite matrix, and run
matrix before accepting existing samples.

```bash
# Resume one interrupted full run.
pnpm bench run --profile benchmarks/profiles/paper-v0.3.json \
  --out benchmark-results/paper-v0.3 --resume

# Run four deterministic block shards on the same locked execution host; each
# writes a distinct journal.
pnpm bench run --profile benchmarks/profiles/paper-v0.3.json \
  --out benchmark-results/paper-v0.3 --shard 1/4
pnpm bench run --profile benchmarks/profiles/paper-v0.3.json \
  --out benchmark-results/paper-v0.3 --shard 2/4
pnpm bench run --profile benchmarks/profiles/paper-v0.3.json \
  --out benchmark-results/paper-v0.3 --shard 3/4
pnpm bench run --profile benchmarks/profiles/paper-v0.3.json \
  --out benchmark-results/paper-v0.3 --shard 4/4

# Merge fails on duplicate samples or an incomplete profile matrix.
pnpm bench merge --profile benchmarks/profiles/paper-v0.3.json \
  --input benchmark-results/paper-v0.3.shard-1-of-4.journal.jsonl,benchmark-results/paper-v0.3.shard-2-of-4.journal.jsonl,benchmark-results/paper-v0.3.shard-3-of-4.journal.jsonl,benchmark-results/paper-v0.3.shard-4-of-4.journal.jsonl \
  --out benchmark-results/paper-v0.3
```

`--block 1,5,9` is also available for explicit one-based block selection.
`--block` and `--shard` are mutually exclusive. A submission profile cannot be
run with a `--suite` subset; diagnostic profiles may opt into subsets. Use
`--journal PATH` to override the deterministic journal name when an external
job scheduler owns shard paths. Starting without `--resume` never overwrites an
existing journal; the error points to `--resume` or a new output/journal path.
The output path is also checked before any replicate starts, so an immutable
published artifact cannot cause a complete run to be discarded at the end.

## Artifact contents and verification

A complete artifact contains:

- `manifest.json`: profile, commit, environment, planned matrix, runs,
  summaries, comparisons, and checksums;
- `samples.jsonl`: append-independent raw replicate records;
- `report.md`: a generated human-readable report;
- `analysis/runs.csv` and `analysis/comparisons.csv`: publication tables;
- `analysis/figure-data.json` and `analysis/primary-metrics.svg`: plot data and
  a directly inspectable figure;
- `screenshots/`, when a visual checkpoint is requested.

`verify` checks the profile hash and complete run matrix, reconstructs the raw
JSONL rows, summaries, and paired comparisons, enforces canonical-state
equivalence groups, regenerates every report/analysis byte, and validates all
declared SHA-256 checksums. Screenshots are audit evidence and are also hashed;
they are not used as a substitute for semantic correctness.

```bash
pnpm bench verify --input benchmark-results/paper-v0.3

# Rebuild analysis files only after manifest, samples, and screenshots pass
# source verification; the regenerated bytes must match manifest checksums.
pnpm bench analyze --input benchmark-results/paper-v0.3
```

Do not publish or interpret an artifact whose verification fails. Preserve the
whole directory and its journal with the tagged source release.

## UI correctness and timing boundary

Every comparable Schelling UI exposes two independent, machine-readable
signals: a monotonically increasing render revision and a canonical final
agent state. Each measured action must advance the revision by exactly one.
External UIs are timed from click dispatch until the declared revision appears
and the following `requestAnimationFrame` callback runs. Frameworks may replace
the signal node; the harness observes the document and re-resolves it.

TenSnap conditions obtain their state from the production renderer's
`Scenario.dump()` snapshot. Solara and WGLMakie expose the same canonical agent
fields through hidden benchmark DOM nodes. The oracle validates population,
unique IDs and positions, grid bounds, positive size, revision count, and
population conservation. A profile `stateEquivalenceGroup` additionally
requires byte-equivalent canonical hashes for the same seed and replicate
block across native UI and TenSnap conditions.

PNG capture happens outside the timed action series. External native UIs must
also produce three consecutive byte-identical full-page PNGs before a visual
checkpoint is accepted. This prevents an early DOM-ready signal from retaining
a Solara hydration state or a WGLMakie loading canvas as publication evidence.
The shared primary UI metric is `actionToRenderCompleteMs`; old
screenshot-polling and self-equality checks are not accepted as correctness
evidence.

## Reproducing a submission environment

Use a fresh checkout at the commit being reported:

```bash
pnpm install --frozen-lockfile
pnpm bench:browser:install

python3 -m venv .benchmark-venv
.benchmark-venv/bin/pip install -r benchmarks/environments/python-mesa.requirements.lock
export PATH="$PWD/.benchmark-venv/bin:$PATH"
PYTHONPATH="$PWD/packages/tensnap-python" python -c \
  'import mesa, solara, tensnap; print(mesa.__version__, solara.__version__)'

julia --project=benchmarks/schelling/v1/environments/julia -e \
  'using Agents, Bonito, TenSnap, WGLMakie; println(VERSION)'

# Required only for the NetLogo kernel condition. Use NetLogo 7.0.4.
python -c 'import pynetlogo; print(pynetlogo.__version__)'

# Must print nothing before a submission run.
git status --short
```

The Python lock includes Mesa/Solara and their required runtime dependencies.
The Julia benchmark has a separate committed `Project.toml`/`Manifest.toml`;
the example directory intentionally does not carry the publication lock. Each
profile validates declared environment-lock hashes before launching a subject.
If NetLogo needs a local installation path, configure it without changing the
recorded version.

## Profiles and measured layers

`paper-v0.3` predeclares stable workload IDs, dimensions, feature levels, and a
primary metric for every run. Its renderer comparisons use
`browserMutationMs`, with Canvas as the baseline and direct Leafer/TenSnap as
treatments for each agent-count/change-rate tuple. Protocol and core workloads
remain separate from these renderer-only comparisons.

The Schelling profiles separate model, framework UI, and TenSnap layers. The
immutable `v1` profiles retain the original 0.7-threshold evidence. The current
`v2` profiles use a 0.8 similarity threshold and end every scientific or UI
trajectory at tick 500 (5 warm-up actions plus 495 measured UI actions):

- `schelling-kernel-v2`: Mesa, Go, Agents.jl, and descriptive NetLogo kernels;
- `schelling-ui-mesa-v2`: Mesa kernel, Solara, and Mesa + TenSnap;
- `schelling-ui-julia-v2`: Agents.jl kernel, WGLMakie, and Agents.jl + TenSnap;
- `schelling-ui-go-v2`: Go kernel and Go + TenSnap;
- `schelling-ui-js-v2`: JavaScript kernel and JavaScript + TenSnap.

Run the four binding-specific UI profiles directly from the repository root:

```bash
pnpm bench run --profile benchmarks/profiles/schelling-ui-mesa-v2.json \
  --out benchmark-results/schelling-ui-mesa-v2
pnpm bench run --profile benchmarks/profiles/schelling-ui-go-v2.json \
  --out benchmark-results/schelling-ui-go-v2
pnpm bench run --profile benchmarks/profiles/schelling-ui-js-v2.json \
  --out benchmark-results/schelling-ui-js-v2
pnpm bench run --profile benchmarks/profiles/schelling-ui-julia-v2.json \
  --out benchmark-results/schelling-ui-julia-v2
```

Each `--out` directory must be new. If a run is interrupted, repeat its exact
command with `--resume` instead of deleting or overwriting the journal.

Only conditions with the same declared `featureLevel`, dimensions, semantic
contract, and primary metric belong in a paired comparison. NetLogo remains a
descriptive kernel result because its statistics instrumentation differs.

`browserOptions.renderTriggerMode` records scheduling policy. The default
`requestAnimationFrame` mode represents presentable frame latency;
`setTimeout` measures maximum-throughput scheduling as
`actionToRunCompletionMs`, and `auto` uses production cadence selection. Only
rAF runs use `actionToRenderCompleteMs` and enter native-UI render-completion
comparisons; results from different modes are not the same metric.

## Process and CPU measurements

Node and harness-owned browser process measurements use deltas between
`process.resourceUsage()` snapshots; cumulative process totals are never
written as one replicate's CPU cost. External command subjects run under
`/usr/bin/time -p` on supported Unix hosts so CPU time describes the child
command. For external browser servers, a portable process-tree CPU value is
not available and the field is `null` rather than a misleading harness value.
Latency is the primary publication measurement.

Every external-browser replicate receives a fresh loopback port. On POSIX
hosts, the runner terminates the external server's whole process group when the
OS permits it, so wrappers such as `go run` cannot leave the compiled server
listening after the replicate completes. If group signaling returns `EPERM` or
`ESRCH`, cleanup falls back to the directly spawned Python/Julia/Node child.

## Statistical inference

Profiles use 15 randomized, process-isolated replicate blocks. Confidence
intervals resample one median per independent replicate, never correlated
individual actions. Declared comparisons use randomized-block paired ratios
and differences; ratios below one favour the treatment. Diagnostic runs with
fewer blocks must not be presented as submission confidence intervals.

## Adding a benchmark

Add a generally useful model/config/study API under `examples/`, a versioned
subject adapter and independent oracle under `benchmarks/`, then register the
workload in a profile. Declare its primary metric, feature level, dimensions,
environment locks, and—where exact cross-condition equality is valid—a state
equivalence group. Keep benchmark JSON, hidden DOM signals, profile environment
parsing and artifact probes out of user entry points.
