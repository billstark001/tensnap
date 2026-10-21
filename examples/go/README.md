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

The standalone study shares the scientific transitions with the other language examples. CSV includes satisfaction, segregation, last movement, steps and separate `satisfied_runs`, `jammed_runs`, and `limit_runs`. In convergence mode, no movement stops the run; it can indicate satisfaction or a blocked full grid. Performance timing and warmup are supplied only by benchmark subjects.

```bash
cd examples/go
make run-standalone

# Or from the repository root
pnpm standalone:go:schelling
```

Useful flags:

```bash
go run ./standalone -steps=1000 -seeds=8 \
  -thresholds=0.30,0.50,0.70,0.90 -mode=convergence
```

Use `-mode=steady` to run exactly the requested step count.

## Reproducibility

Seeds are ordinary initialization parameters. Editing a seed affects the next reset, and each instance owns its RNG. See the [example guide](../README.md) and [reproducibility contract](../../docs/maintainer-guide/reproducibility.md). Scientific code and normal launchers perform no publication audit file I/O; independent audit adapters live beside benchmark subjects.

All three models expose initialization seed metadata. Schelling reset reseeds its own stream. Its schema-3 checkpoint retains the active stream separately from a pending next-reset seed. Restoring standard-library `math/rand` uses seed plus draw count and costs O(prior draws); use matching implementations for exact continuation. SIRS and Forest Fire retain their own generator states directly. Run `go test ./...` from this directory; benchmark adapter tests run from `../../benchmarks/schelling/v1/subjects/go`.
