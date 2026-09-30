# TenSnap reproducible benchmark

Generated: 2026-07-19T21:00:59.540Z

- Commit: 771a9601206e629b2a09fbe8049df4d5667dc3ad
- Node: v24.14.1; V8: 13.6.233.17-node.44
- OS: darwin 24.6.0 (arm64)
- CPU: Apple M3
- Replicates: fresh process per replicate

| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| node | system | JavaScript headless (kernel baseline) | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8 | cycle | - | - | 15 | 303.340 | 323.536 | 301.087–307.070 | totalTicks: 500.000<br>elapsedMs: 303.340<br>msPerTick: 0.607 | 0 / 0 |
| browser | system | JavaScript + TenSnap binding + Web host (rAF frame latency) | agents+charts+monitor | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=requestAnimationFrame | actionToRenderCompleteMs | - | - | 7425 | 16.700 | 17.200 | 16.700–16.700 | - | 0 / 0 |
| browser | system | JavaScript + TenSnap binding + Web host (timeout throughput) | agents+charts+monitor | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=setTimeout | actionToRunCompletionMs | - | - | 7425 | 6.300 | 11.800 | 6.100–6.500 | - | 0 / 0 |

Raw measurements are in `samples.jsonl`; derived publication data and the SVG figure are in `analysis/`; `manifest.json` is the machine-readable experiment record.
