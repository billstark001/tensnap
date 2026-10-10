# TenSnap reproducible benchmark

Generated: 2026-10-10T01:10:26.541Z

- Commit: c80c882396beb4b4da0703616b8af7c10de0534b
- Node: v26.8.1; V8: 14.6.202.34-node.28
- OS: darwin 25.6.0 (arm64)
- CPU: Apple M3
- Replicates: fresh process per replicate

| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| node | system | Go headless (kernel baseline) | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8 | cycle | - | - | 15 | 22.768 | 23.225 | 22.630–22.927 | elapsedMs: 22.768<br>msPerTick: 0.046<br>totalTicks: 500.000 | 0 / 0 |
| browser | system | Go + TenSnap binding + Web host (rAF frame latency) | agents+three-statistics | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=requestAnimationFrame | actionToRenderCompleteMs | - | - | 7425 | 16.700 | 18.400 | 16.600–16.700 | - | 0 / 0 |
| browser | system | Go + TenSnap binding + Web host (timeout throughput) | agents+three-statistics | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=setTimeout | actionToRunCompletionMs | - | - | 7425 | 9.100 | 11.900 | 9.100–9.100 | - | 0 / 0 |

Raw measurements are in `samples.jsonl`; derived publication data and the SVG figure are in `analysis/`; `manifest.json` is the machine-readable experiment record.
