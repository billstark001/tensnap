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

# Cross-system Schelling case studies (run only from a clean commit)
# First activate the Python environment pinned in benchmarks/environments/.
pnpm bench run --profile benchmarks/profiles/schelling-kernel-v1.json --out benchmark-results/schelling-kernel-v1
pnpm bench run --profile benchmarks/profiles/schelling-ui-mesa-v1.json --out benchmark-results/schelling-ui-mesa-v1
pnpm bench run --profile benchmarks/profiles/schelling-ui-julia-v1.json --out benchmark-results/schelling-ui-julia-v1
pnpm bench run --profile benchmarks/profiles/schelling-ui-go-v1.json --out benchmark-results/schelling-ui-go-v1
pnpm bench run --profile benchmarks/profiles/schelling-ui-js-v1.json --out benchmark-results/schelling-ui-js-v1
```

Each run writes `manifest.json`, `samples.jsonl`, and `report.md`. The manifest
records implementation and harness SHA, dirty state, lockfile hash, machine
fingerprint, Chromium version, exact configuration, raw samples, wire bytes,
auxiliary measurements, stage boundaries, runtime versions, and state hashes.
`samples.jsonl` has a SHA-256 in the manifest; verification also regenerates
every expected row from the manifest, so an incomplete matrix or modified raw
file cannot pass. Do not use an artifact whose `verify` command fails.

Submission profiles require a clean worktree, randomize system order within
each replicate block, and use a fresh process for Node/WS conditions. Browser
conditions create a fresh Chromium process, Vite preview server, and simulator
session per replicate. This separates process startup/JIT resource data from
the measured steady-state series.

## Reproduce a submission benchmark

Use a fresh checkout at the commit that you intend to report. The three
Schelling profiles reject a dirty worktree, because an artifact without a
unique implementation SHA is not submission evidence.

```bash
# JavaScript harness and the exact browser used by browser conditions.
pnpm install --frozen-lockfile
pnpm bench:browser:install

# Mesa, Solara, PyNetLogo, and the direct dependencies of the checkout's
# TenSnap Python binding. Keep this environment activated for every command
# below; `python3` must resolve to this interpreter in child processes too.
python3 -m venv .benchmark-venv
.benchmark-venv/bin/pip install -r benchmarks/environments/python-mesa.requirements.lock
export PATH="$PWD/.benchmark-venv/bin:$PATH"
PYTHONPATH="$PWD/packages/tensnap-python" python -c 'import mesa, solara, tensnap; print(mesa.__version__, solara.__version__)'

# The Julia condition is locked by the committed Manifest, rather than the
# user's global package depot. NetLogo 7.0.4 must be installed so PyNetLogo
# can launch its headless workspace.
julia --project=examples/julia -e 'using Agents, Bonito, TenSnap, WGLMakie; println(VERSION)'
python -c 'import pyNetLogo; print("PyNetLogo ready")'

# Inspect this before executing a submission profile. It must print nothing.
git status --short
```

If PyNetLogo cannot locate NetLogo, configure its installation according to
your local PyNetLogo setup, then repeat the preflight command above. Do not
silently replace the NetLogo condition with a different launcher or version;
record and lock that change first.

Run each profile into a new output directory, then verify before examining or
sharing the report:

```bash
pnpm bench run --profile benchmarks/profiles/schelling-kernel-v1.json --out benchmark-results/schelling-kernel-v1
pnpm bench verify --input benchmark-results/schelling-kernel-v1
pnpm bench report --input benchmark-results/schelling-kernel-v1

pnpm bench run --profile benchmarks/profiles/schelling-ui-mesa-v1.json --out benchmark-results/schelling-ui-mesa-v1
pnpm bench verify --input benchmark-results/schelling-ui-mesa-v1
pnpm bench report --input benchmark-results/schelling-ui-mesa-v1

pnpm bench run --profile benchmarks/profiles/schelling-ui-julia-v1.json --out benchmark-results/schelling-ui-julia-v1
pnpm bench verify --input benchmark-results/schelling-ui-julia-v1
pnpm bench report --input benchmark-results/schelling-ui-julia-v1

pnpm bench run --profile benchmarks/profiles/schelling-ui-go-v1.json --out benchmark-results/schelling-ui-go-v1
pnpm bench verify --input benchmark-results/schelling-ui-go-v1
pnpm bench report --input benchmark-results/schelling-ui-go-v1

pnpm bench run --profile benchmarks/profiles/schelling-ui-js-v1.json --out benchmark-results/schelling-ui-js-v1
pnpm bench verify --input benchmark-results/schelling-ui-js-v1
pnpm bench report --input benchmark-results/schelling-ui-js-v1
```

The profiles use 15 randomized, process-isolated replicate blocks. A trial
with fewer repetitions is useful only to diagnose setup; it must not be used
to report confidence intervals or comparative ratios. Preserve the complete
output directory, including `samples.jsonl`, `manifest.json`, `report.md`, and
any `screenshots/` files. If verification fails, discard that directory, fix
the environment or implementation, commit the fix, and run a new profile.

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
implementations. They consume one pre-generated seeded delta trace; trace
generation is outside the timed interval. Leafer and TenSnap receive precisely
the same sparse changed-agent set, while Canvas redraws its required complete
immediate-mode scene. They verify the final canonical state hash. Browser
reports therefore contain explicitly named timing boundaries: renderer mutation,
action-to-frame for component controls, and action-to-run-completion for the
protocol host. Do not interpret a 60 Hz frame-bound `cycle` value as model or
renderer time.

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

## Schelling system profiles

`schelling-kernel-v1` uses the distributional contract in
[`schelling/specification-v1.json`](schelling/specification-v1.json): Mesa,
Go, Agents.jl, and NetLogo use native RNGs, so equality of a numeric seed is
not misrepresented as trajectory equality. Their adapters emit a final JSONL
record containing bounded domain invariants, actual step count, elapsed model
time, and interpreter/framework version. The profile separately warms dispatch
on an independent model before the timed steady-state model.

The four UI profiles deliberately keep comparison layers separate:

- `schelling-ui-mesa-v1`: Mesa headless, Mesa + Solara, and Mesa + TenSnap
  binding/Web host.
- `schelling-ui-julia-v1`: Agents.jl headless, Agents.jl + WGLMakie, and
  Agents.jl + TenSnap binding/Web host.
- `schelling-ui-go-v1`: Go headless and Go + TenSnap binding/Web host.
- `schelling-ui-js-v1`: JavaScript headless and JavaScript + TenSnap
  binding/Web host.

Go and JavaScript do not currently have an independently hosted UI with the
same functionality as Solara or WGLMakie, so their profiles intentionally do
not manufacture a third system comparison. Their Web measurements use the same
production TenSnap host, 50×50 agents/grid state, charts, deterministic seed,
and action-completion boundary as the other TenSnap conditions.

### Browser scheduling mode

Every profile workload may set `browserOptions`. The default is deliberately
frame-bound so historical `actionToRunCompletionMs` runs remain comparable:

```json
"browserOptions": { "renderTriggerMode": "requestAnimationFrame" }
```

For maximum-throughput measurements, use
`"renderTriggerMode": "setTimeout"` (and leave `maxTps` and
`maxRenderFps` at their default `0`). This bypasses the display-frame wait, so
it measures action throughput rather than presentable frame latency. `auto` is
also available for the production scheduler's cadence-based choice. The
resolved settings are recorded in each browser run's manifest
`execution.browser.runOptions`; do not compare results obtained with different
scheduling modes as the same latency metric.

Solara/WGLMakie values are click-to-first-changed-frame and write PNG screenshot
checkpoints plus hashes; TenSnap values use the production Web host against the
actual external simulator WebSocket. Only equal functionality levels belong in
one comparison table.

Recreate the Python environment before executing a profile:

```bash
python3 -m venv .benchmark-venv
.benchmark-venv/bin/pip install -r benchmarks/environments/python-mesa.requirements.lock
```

The Mesa + TenSnap condition explicitly imports the checkout's
`packages/tensnap-python` binding; the lock therefore also pins its direct
runtime dependencies (`msgpack` and `typing_extensions`). Activate this venv
before invoking `pnpm bench` so the browser server and headless adapters use
the same interpreter.

The Julia profile must use its resolved `examples/julia/Manifest.toml`, and the
NetLogo profile records the local NetLogo/PyNetLogo runtime in each raw sample.

## Statistical inference

The raw action timings remain available for distribution and tail summaries,
but every median confidence interval resamples one median per independent
replicate—not correlated individual steps. A profile can declare a baseline
and treatments; the report then gives randomized-block paired median ratios
and differences with paired bootstrap 95% intervals. Ratios below one favour
the treatment. Never infer a framework result from an unpaired ordering or
from flattened per-step samples.

## Extending the baseline

Add a versioned workload under `v0.3/` (or a future protocol directory) and
register it in `registry.ts`. Choose `protocol`, `node`, or `browser` according
to the path being measured. A protocol workload requires a semantic validator
and independent expected state; every local/browser workload requires a
deterministic state snapshot and expected state. Profiles, not harness code,
select the cases to publish.
