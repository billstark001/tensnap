# TenSnap reproducible benchmark

Generated: 2026-10-10T01:06:58.344Z

- Commit: c80c882396beb4b4da0703616b8af7c10de0534b
- Node: v26.8.1; V8: 14.6.202.34-node.28
- OS: darwin 25.6.0 (arm64)
- CPU: Apple M3
- Replicates: fresh process per replicate

| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| node | system | Mesa (Python) | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8, instrumentation=none | cycle | - | - | 15 | 1066.359 | 1110.563 | 1059.953–1083.090 | elapsedMs: 1066.359<br>msPerTick: 2.133<br>totalTicks: 500.000 | 0 / 0 |
| node | system | Go reference implementation | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8, instrumentation=none | cycle | - | - | 15 | 22.916 | 37.521 | 22.683–23.096 | elapsedMs: 22.916<br>msPerTick: 0.046<br>totalTicks: 500.000 | 0 / 0 |
| node | system | Agents.jl | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8, instrumentation=none | cycle | - | - | 15 | 97.827 | 224.230 | 97.467–102.882 | totalTicks: 500.000<br>elapsedMs: 97.827<br>msPerTick: 0.196 | 0 / 0 |
| node | system | NetLogo headless | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8, instrumentation=scientific | cycle | - | - | 15 | 910.686 | 1002.796 | 893.507–923.115 | elapsedMs: 910.686<br>msPerTick: 1.821<br>totalTicks: 500.000 | 0 / 0 |

## Paired comparisons

Ratios are treatment / baseline; values below 1 favour the treatment. Confidence intervals resample paired independent replicates, never individual steps.

| Comparison | Metric | Suite | Baseline | Treatment | Pairs | Median ratio (95% CI) | Median difference ms (95% CI) |
|---|---|---|---|---|---:|---:|---:|
| schelling-kernel:cycle:node:-:- | cycle | node | mesa | go | 15 | 0.021 (0.021–0.022) | -1043.263 (-1060.049–-1037.299) |
| schelling-kernel:cycle:node:-:- | cycle | node | mesa | julia | 15 | 0.093 (0.092–0.094) | -965.851 (-978.425–-947.436) |

Raw measurements are in `samples.jsonl`; derived publication data and the SVG figure are in `analysis/`; `manifest.json` is the machine-readable experiment record.
