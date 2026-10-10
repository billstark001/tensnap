# TenSnap reproducible benchmark

Generated: 2026-10-10T01:57:24.749Z

- Commit: c80c882396beb4b4da0703616b8af7c10de0534b
- Node: v26.8.1; V8: 14.6.202.34-node.28
- OS: darwin 25.6.0 (arm64)
- CPU: Apple M3
- Replicates: fresh process per replicate

| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| node | system | Mesa headless (kernel baseline) | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8, instrumentation=none | cycle | - | - | 15 | 1064.858 | 1149.162 | 1058.241–1097.021 | elapsedMs: 1064.858<br>msPerTick: 2.130<br>totalTicks: 500.000 | 0 / 0 |
| browser | system | Mesa + Solara (agents + summary) | agents+two-statistics | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=requestAnimationFrame | actionToRenderCompleteMs | - | - | 7425 | 132.700 | 198.600 | 132.300–133.000 | - | 0 / 0 |
| browser | system | Mesa + TenSnap binding + Web host (rAF frame latency) | agents+two-statistics | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=requestAnimationFrame | actionToRenderCompleteMs | - | - | 7425 | 18.900 | 33.300 | 18.900–19.000 | - | 0 / 0 |
| browser | system | Mesa + TenSnap binding + Web host (timeout throughput) | agents+two-statistics | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=setTimeout | actionToRunCompletionMs | - | - | 7425 | 16.600 | 18.700 | 16.600–16.600 | - | 0 / 0 |

## Paired comparisons

Ratios are treatment / baseline; values below 1 favour the treatment. Confidence intervals resample paired independent replicates, never individual steps.

| Comparison | Metric | Suite | Baseline | Treatment | Pairs | Median ratio (95% CI) | Median difference ms (95% CI) |
|---|---|---|---|---|---:|---:|---:|
| mesa-ui-render-complete:actionToRenderCompleteMs:browser:-:- | actionToRenderCompleteMs | browser | mesa-solara | mesa-tensnap-web-raf | 15 | 0.142 (0.136–0.143) | -114.100 (-114.600–-113.500) |

Raw measurements are in `samples.jsonl`; derived publication data and the SVG figure are in `analysis/`; `manifest.json` is the machine-readable experiment record.
