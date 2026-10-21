# Schelling benchmark v1 subjects

This directory is the publication adapter layer for the versioned Schelling profiles. It is deliberately separate from `examples/`: a reader can copy an example without inheriting harness protocol, timing, hidden DOM, or artifact requirements.

The extra example files in the table are an intentional reuse boundary, not a claim that a basic TenSnap example needs this many files. User launchers such as `schelling_viz.py` and `schelling_viz.jl` delegate to binding/scenario factories so benchmark servers exercise the same reset and projection logic. Standalone launchers delegate to study helpers so benchmark kernels exercise the same trial loop. Profile translation, warmup, timers, performance output, independent audit sidecars and hidden UI probes live in this directory. Ordinary examples neither import an audit writer nor read its environment variable.

| System | Benchmark subject | Reused user-facing code | Benchmark-only responsibility |
| --- | --- | --- | --- |
| Mesa | `subjects/mesa/` | model, study and TenSnap server helpers in `examples/python_mesa` | profile environment, instrumentation choice, JSON, canonical projector and Solara probes |
| Go | `subjects/go/kernel/`, `subjects/go/tensnap/` | model, study and fresh-session server in `examples/go/internal/schelling` | version assertion, profile flags and JSON result |
| JavaScript | `subjects/js/kernel.ts`, `subjects/js/tensnap.ts` | model, study, declarative session and WebSocket host in `examples/js` | version assertion, profile environment and JSON result |
| Julia | `subjects/julia/` | model/config, study, TenSnap scenario and WGLMakie app factories in `examples/julia` | version assertion, profile environment, JSON and hidden WGLMakie probes |
| NetLogo | `subjects/netlogo/kernel.py`, `subjects/netlogo/render_memory.py` | model and PyNetLogo study helper in `examples/python_mesa` | benchmark JSON/runtime record and audited in-memory native-view raster |

The current `evaluation-2026-*` profiles use `benchmarks/evaluation/environments/julia/`, `benchmarks/environments/python-evaluation.requirements.lock`, and the evaluation Go `-modfile`. The older profiles retain `environments/julia/`, the Mesa Python lock, and subject-local Go modules for their original environments. The adapter directory name `v1` describes the subject layer; it does not identify which profile/environment is being executed. See the [evaluation guide](../../evaluation/README.md) for current setup.

UI subjects must expose a non-negative integer revision and canonical agent state, and advance the revision exactly once per action. The common oracle in `../oracle.ts` converts native and TenSnap renderer states to sorted `{id,x,y,color,size}` agents, validates invariants, and enables exact cross-renderer hashing within a profile equivalence group.

Changes to scientific dynamics belong in the user-facing model and require a dynamics-version review. Generally useful parameters, data collection, standalone studies and reset-safe servers also belong with the examples. Changes needed only for measurement, profile translation or validation belong in a subject adapter here. Adapters should project canonical state rather than adding benchmark-shaped fields to a teaching model.

## Current study and checkpoint contracts

Measurement wrappers time the shared transition loop after model construction and before summary calculation. Scientific CSV now reports `satisfied_runs`, `jammed_runs` and `limit_runs`; only adapters append performance rows and publication JSON. A generic per-model observer injects independent audit output without process-global hooks. Each language's `audit` module lives with its subject.

Current Schelling checkpoint schemas are 3. Historical reports/checkpoints/figures remain unchanged and retain their original source inventory, schema and no-movement convergence definition. To reproduce old measured values, use the source revision and locked environment recorded by that artifact; a current run is new evidence. See the [reproducibility contract](../../../docs/maintainer-guide/reproducibility.md).
