# TenSnap reproducible benchmark

Generated: 2026-07-19T20:53:59.447Z

- Commit: 771a9601206e629b2a09fbe8049df4d5667dc3ad
- Node: v24.14.1; V8: 13.6.233.17-node.44
- OS: darwin 24.6.0 (arm64)
- CPU: Apple M3
- Replicates: fresh process per replicate

| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| node | system | Mesa (Python) | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8, instrumentation=none | cycle | - | - | 15 | 1199.591 | 1242.975 | 1190.004–1211.207 | elapsedMs: 1199.591<br>msPerTick: 2.399<br>totalTicks: 500.000 | 0 / 0 |
| node | system | Go reference implementation | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8, instrumentation=none | cycle | - | - | 15 | 22.071 | 22.743 | 21.819–22.401 | elapsedMs: 22.071<br>msPerTick: 0.044<br>totalTicks: 500.000 | 0 / 0 |
| node | system | Agents.jl | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8, instrumentation=none | cycle | - | - | 15 | 97.275 | 221.437 | 96.579–97.781 | totalTicks: 500.000<br>elapsedMs: 97.275<br>msPerTick: 0.195 | 0 / 0 |
| node | system | NetLogo headless | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8, instrumentation=scientific | cycle | - | - | 15 | 996.282 | 1121.744 | 981.040–1012.539 | elapsedMs: 996.282<br>msPerTick: 1.993<br>totalTicks: 500.000 | 0 / 0 |

## Paired comparisons

Ratios are treatment / baseline; values below 1 favour the treatment. Confidence intervals resample paired independent replicates, never individual steps.

| Comparison | Metric | Suite | Baseline | Treatment | Pairs | Median ratio (95% CI) | Median difference ms (95% CI) |
|---|---|---|---|---|---:|---:|---:|
| schelling-kernel:cycle:node:-:- | cycle | node | mesa | go | 15 | 0.018 (0.018–0.019) | -1177.934 (-1189.136–-1167.655) |
| schelling-kernel:cycle:node:-:- | cycle | node | mesa | julia | 15 | 0.081 (0.080–0.082) | -1102.698 (-1120.228–-1091.633) |

Raw measurements are in `samples.jsonl`; derived publication data and the SVG figure are in `analysis/`; `manifest.json` is the machine-readable experiment record.
