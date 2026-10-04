# Go Examples

## SIRS restoration example

`go run ./sirs -seed 7 -port 8765` runs the same grid structure and parameter names as `examples/python/sirs.py`: `beta`, `gamma`, `xi`, `initial_infected`, `rows`, and `cols`. `model.go` owns the dynamics and `tensnap` field tags; `viz.go` declares the grid, agents, parameters, and grouped chart. The state inverses live in `state_restore.go`. The complete projected population is restored through `Restore.Replace`; `WithTypedCheckpoint` also retains the random generator state for exact continuation.

## Forest-fire restoration example

`go run ./forest_fire -seed 7 -port 8765` runs a forest-fire cellular automaton with tree growth, lightning, and four-neighbor spread. This model is unique among the repository's language examples. Its projected restore replaces the complete cell grid; its checkpoint captures the random generator state. `viz.go` binds the flat cell array with `NewMatrixAgentLayer.Flat`; matrix items use `cell:row:col` IDs and row zero maps to the top of the renderer. The state inverse in `state_restore.go` validates cell values and rebuilds the flat array. The rules are based on the [Drossel–Schwabl forest-fire model](https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.69.1629).

## Schelling TenSnap Server

```bash
cd examples/go
make run-schelling

# Or from the repository root
pnpm dev:go:schelling
```

The server listens on `ws://localhost:8765`.

The user-facing server exposes the complete model configuration and gives each renderer connection a fresh, identically seeded model:

```bash
go run ./schelling -width 50 -height 50 -density 0.8 -balance 0.5 \
  -threshold 0.7 -seed 7 -port 8765
```

Model defaults, study execution and fresh-session server construction live in `internal/schelling`. The publication subjects reuse those functions and own only their version check and JSON result.

This partial split is for example/harness reuse, not a requirement of the Go binding. `schelling/main.go` is a thin user-facing TenSnap launcher over the shared server, and `standalone/main.go` is a thin user-facing CLI over the shared study. Keeping model construction, reset semantics and trial loops in `internal/schelling` lets the publication adapters call exactly the same code without putting benchmark JSON or profile environment handling in the example commands. A one-off Go example may keep them together.

## Schelling Standalone Scientific Task

The standalone script runs the same heavy threshold-sweep task as the Python, NetLogo, and Julia standalone scripts. For each similarity threshold it runs several seeds and prints CSV columns for final satisfaction, segregation, last-step movement, steps used, and convergence count. After all scientific rows are computed, it prints a separate performance row with `total_ticks`, `elapsed_ms`, `tpms`, and `mspt`; timing is wrapped around each trial's step loop only, with no per-tick instrumentation in the model hot path.

```bash
cd examples/go
make run-standalone

# Or from the repository root
pnpm standalone:go:schelling
```

Useful flags:

```bash
go run ./standalone -steps=1000 -warmup-steps=25 -seeds=8 \
  -thresholds=0.30,0.50,0.70,0.90 -mode=convergence
```

Use `-mode=steady` to run exactly the requested step count.
