# Go Examples

## Schelling TenSnap Server

```bash
cd examples/go
make run-schelling

# Or from the repository root
pnpm dev:go:schelling
```

The server listens on `ws://localhost:8765`.

## Schelling Standalone Scientific Task

The standalone script runs the same threshold-sweep task as the Python and Julia
standalone scripts. For each similarity threshold it runs several seeds and
prints CSV columns for final satisfaction, segregation, last-step movement,
steps used, and convergence count.

```bash
cd examples/go
make run-standalone

# Or from the repository root
pnpm standalone:go:schelling
```

Useful flags:

```bash
go run ./standalone -steps=200 -seeds=5 -thresholds=0.30,0.50,0.70,0.90
```
