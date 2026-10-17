# TenSnap reproducible benchmark

Generated: 2026-10-17T07:08:44.453Z

- Commit: f44651d75613e85d3865566ed4ee60610b1832d2
- Node: v26.8.1; V8: 14.6.202.34-node.28
- OS: darwin 27.0.0 (arm64)
- CPU: Apple M3
- Replicates: fresh process per replicate

| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| node | system | Mesa (Python) | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8, instrumentation=none | cycle | - | - | 15 | 1083.856 | 1109.596 | 1078.728–1098.367 | elapsedMs: 1083.856<br>msPerTick: 2.168<br>totalTicks: 500.000 | 0 / 0 |
| node | system | Go reference implementation | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8, instrumentation=none | cycle | - | - | 15 | 22.465 | 35.292 | 22.247–22.670 | elapsedMs: 22.465<br>msPerTick: 0.045<br>totalTicks: 500.000 | 0 / 0 |
| node | system | Agents.jl | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8, instrumentation=none | cycle | - | - | 15 | 119.086 | 121.264 | 116.750–120.543 | totalTicks: 500.000<br>elapsedMs: 119.086<br>msPerTick: 0.238 | 0 / 0 |
| node | system | NetLogo headless | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8, instrumentation=scientific | cycle | - | - | 15 | 895.819 | 908.532 | 880.671–903.779 | elapsedMs: 895.819<br>msPerTick: 1.792<br>totalTicks: 500.000 | 0 / 0 |

## Paired comparisons

Ratios are treatment / baseline; values below 1 favour the treatment. Confidence intervals resample paired independent replicates, never individual steps.

| Comparison | Metric | Suite | Baseline | Treatment | Pairs | Median ratio (95% CI) | Median difference ms (95% CI) |
|---|---|---|---|---|---:|---:|---:|
| schelling-kernel:cycle:node:-:- | cycle | node | mesa | go | 15 | 0.021 (0.020–0.021) | -1061.609 (-1072.591–-1057.152) |
| schelling-kernel:cycle:node:-:- | cycle | node | mesa | julia | 15 | 0.110 (0.105–0.111) | -972.132 (-981.346–-963.908) |

Raw measurements are in `samples.jsonl`; derived publication data and the SVG figure are in `analysis/`; `manifest.json` is the machine-readable experiment record.
