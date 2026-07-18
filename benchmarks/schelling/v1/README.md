# Schelling benchmark v1 subjects

This directory is the publication adapter layer for the versioned Schelling
profiles. It is deliberately separate from `examples/`: a reader can copy an
example without inheriting harness protocol, timing, hidden DOM, or artifact
requirements.

The extra example files in the table are an intentional reuse boundary, not a
claim that a basic TenSnap example needs this many files. User launchers such
as `schelling_viz.py` and `schelling_viz.jl` delegate to binding/scenario
factories so benchmark servers exercise the same reset and projection logic.
Standalone launchers delegate to study helpers so benchmark kernels exercise
the same trial loop. Only the profile translation, benchmark JSON and hidden UI
probes remain in this directory.

| System | Benchmark subject | Reused user-facing code | Benchmark-only responsibility |
|---|---|---|---|
| Mesa | `subjects/mesa/` | model, study and TenSnap server helpers in `examples/python_mesa` | profile environment, instrumentation choice, JSON, canonical projector and Solara probes |
| Go | `subjects/go/kernel/`, `subjects/go/tensnap/` | model, study and fresh-session server in `examples/go/internal/schelling` | version assertion, profile flags and JSON result |
| JavaScript | `subjects/js/kernel.ts`, `subjects/js/tensnap.ts` | model, study, declarative session and WebSocket host in `examples/js` | version assertion, profile environment and JSON result |
| Julia | `subjects/julia/` | model/config, study, TenSnap scenario and WGLMakie app factories in `examples/julia` | version assertion, profile environment, JSON and hidden WGLMakie probes |
| NetLogo | `subjects/netlogo/kernel.py` | model and PyNetLogo study helper in `examples/python_mesa` | benchmark JSON/runtime record |

The locked Julia publication environment lives in `environments/julia/`.
Python dependencies are shared from
`benchmarks/environments/python-mesa.requirements.lock`; Go subjects have their
own `go.mod` and `go.sum`.

UI subjects must expose a non-negative integer revision and canonical agent
state, and advance the revision exactly once per action. The common oracle in
`../oracle.ts` converts native and TenSnap renderer states to sorted
`{id,x,y,color,size}` agents, validates invariants, and enables exact
cross-renderer hashing within a profile equivalence group.

Changes to scientific dynamics belong in the user-facing model and require a
dynamics-version review. Generally useful parameters, data collection,
standalone studies and reset-safe servers also belong with the examples.
Changes needed only for measurement, profile translation or validation belong
in a subject adapter here. Adapters should project canonical state rather than
adding benchmark-shaped fields to a teaching model.
