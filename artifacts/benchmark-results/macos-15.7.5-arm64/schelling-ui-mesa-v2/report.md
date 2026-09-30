# TenSnap reproducible benchmark

Generated: 2026-07-19T21:50:43.518Z

- Commit: 771a9601206e629b2a09fbe8049df4d5667dc3ad
- Node: v24.14.1; V8: 13.6.233.17-node.44
- OS: darwin 24.6.0 (arm64)
- CPU: Apple M3
- Replicates: fresh process per replicate

| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| node | system | Mesa headless (kernel baseline) | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8, instrumentation=none | cycle | - | - | 15 | 1217.593 | 1470.748 | 1213.674–1224.154 | elapsedMs: 1217.593<br>msPerTick: 2.435<br>totalTicks: 500.000 | 0 / 0 |
| browser | system | Mesa + Solara (agents + summary) | agents+two-statistics | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=requestAnimationFrame | actionToRenderCompleteMs | - | - | 7425 | 147.300 | 228.500 | 147.200–147.300 | - | 0 / 0 |
| browser | system | Mesa + TenSnap binding + Web host (rAF frame latency) | agents+two-statistics | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=requestAnimationFrame | actionToRenderCompleteMs | - | - | 7425 | 33.300 | 33.700 | 33.300–33.300 | - | 0 / 0 |
| browser | system | Mesa + TenSnap binding + Web host (timeout throughput) | agents+two-statistics | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=setTimeout | actionToRunCompletionMs | - | - | 7425 | 18.000 | 22.900 | 17.700–18.100 | - | 0 / 0 |

## Paired comparisons

Ratios are treatment / baseline; values below 1 favour the treatment. Confidence intervals resample paired independent replicates, never individual steps.

| Comparison | Metric | Suite | Baseline | Treatment | Pairs | Median ratio (95% CI) | Median difference ms (95% CI) |
|---|---|---|---|---|---:|---:|---:|
| mesa-ui-render-complete:actionToRenderCompleteMs:browser:-:- | actionToRenderCompleteMs | browser | mesa-solara | mesa-tensnap-web-raf | 15 | 0.226 (0.226–0.226) | -113.900 (-114.000–-113.900) |

Raw measurements are in `samples.jsonl`; derived publication data and the SVG figure are in `analysis/`; `manifest.json` is the machine-readable experiment record.
