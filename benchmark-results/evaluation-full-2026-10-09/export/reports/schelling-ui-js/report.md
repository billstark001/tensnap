# TenSnap reproducible benchmark

Generated: 2026-10-10T01:13:52.041Z

- Commit: c80c882396beb4b4da0703616b8af7c10de0534b
- Node: v26.8.1; V8: 14.6.202.34-node.28
- OS: darwin 25.6.0 (arm64)
- CPU: Apple M3
- Replicates: fresh process per replicate

| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| node | system | JavaScript headless (kernel baseline) | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8 | cycle | - | - | 15 | 300.562 | 311.027 | 298.815–304.573 | totalTicks: 500.000<br>elapsedMs: 300.562<br>msPerTick: 0.601 | 0 / 0 |
| browser | system | JavaScript + TenSnap binding + Web host (rAF frame latency) | agents+charts+monitor | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=requestAnimationFrame | actionToRenderCompleteMs | - | - | 7425 | 16.600 | 18.300 | 16.600–16.700 | - | 0 / 0 |
| browser | system | JavaScript + TenSnap binding + Web host (timeout throughput) | agents+charts+monitor | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=setTimeout | actionToRunCompletionMs | - | - | 7425 | 5.400 | 11.100 | 5.300–5.400 | - | 0 / 0 |

Raw measurements are in `samples.jsonl`; derived publication data and the SVG figure are in `analysis/`; `manifest.json` is the machine-readable experiment record.
