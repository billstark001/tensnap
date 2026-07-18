# Go Examples

## Schelling TenSnap Server

```bash
cd examples/go
make run-schelling

# Or from the repository root
pnpm dev:go:schelling
```

The server listens on `ws://localhost:8765`.

The visualization accepts the same fixed model settings used by the UI
benchmark. Each incoming renderer session receives a fresh seeded model:

```bash
go run ./schelling --width 50 --height 50 --density 0.8 --balance 0.5 --threshold 0.70 --seed 20260718 --port 8765
```

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
go run ./standalone -steps=1000 -seeds=8 -thresholds=0.30,0.50,0.70,0.90
```
