# TenSnap reproducible benchmark

Generated: 2026-10-17T07:12:11.054Z

- Commit: f44651d75613e85d3865566ed4ee60610b1832d2
- Node: v26.8.1; V8: 14.6.202.34-node.28
- OS: darwin 27.0.0 (arm64)
- CPU: Apple M3
- Replicates: fresh process per replicate

| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| node | system | Go headless (kernel baseline) | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8 | cycle | - | - | 15 | 22.330 | 23.570 | 22.232–22.599 | elapsedMs: 22.330<br>msPerTick: 0.045<br>totalTicks: 500.000 | 0 / 0 |
| browser | system | Go + TenSnap binding + Web host (rAF frame latency) | agents+three-statistics | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=requestAnimationFrame | actionToRenderCompleteMs | - | - | 7425 | 16.700 | 18.300 | 16.700–16.700 | - | 0 / 0 |
| browser | system | Go + TenSnap binding + Web host (timeout throughput) | agents+three-statistics | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=setTimeout | actionToRunCompletionMs | - | - | 7425 | 8.900 | 11.700 | 8.800–9.000 | - | 0 / 0 |

Raw measurements are in `samples.jsonl`; derived publication data and the SVG figure are in `analysis/`; `manifest.json` is the machine-readable experiment record.
