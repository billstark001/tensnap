# Go Examples

## Schelling TenSnap Server

```bash
cd examples/go
make run-schelling

# Or from the repository root
pnpm dev:go:schelling
```

The server listens on `ws://localhost:8765`.

The user-facing server exposes the complete model configuration and gives each
renderer connection a fresh, identically seeded model:

```bash
go run ./schelling -width 50 -height 50 -density 0.8 -balance 0.5 \
  -threshold 0.7 -seed 7 -port 8765
```

Model defaults, study execution and fresh-session server construction live in
`internal/schelling`. The publication subjects reuse those functions and own
only their version check and JSON result.

This partial split is for example/harness reuse, not a requirement of the Go
binding. `schelling/main.go` is a thin user-facing TenSnap launcher over the
shared server, and `standalone/main.go` is a thin user-facing CLI over the
shared study. Keeping model construction, reset semantics and trial loops in
`internal/schelling` lets the publication adapters call exactly the same code
without putting benchmark JSON or profile environment handling in the example
commands. A one-off Go example may keep them together.

## Schelling Standalone Scientific Task

The standalone script runs the same heavy threshold-sweep task as the Python,
NetLogo, and Julia standalone scripts. For each similarity threshold it runs
several seeds and prints CSV columns for final satisfaction, segregation,
last-step movement, steps used, and convergence count. After all scientific rows
are computed, it prints a separate performance row with `total_ticks`,
`elapsed_ms`, `tpms`, and `mspt`; timing is wrapped around each trial's step loop
only, with no per-tick instrumentation in the model hot path.

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
