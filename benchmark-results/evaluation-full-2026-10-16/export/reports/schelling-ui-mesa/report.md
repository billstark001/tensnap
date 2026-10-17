# TenSnap reproducible benchmark

Generated: 2026-10-17T07:55:48.901Z

- Commit: f44651d75613e85d3865566ed4ee60610b1832d2
- Node: v26.8.1; V8: 14.6.202.34-node.28
- OS: darwin 27.0.0 (arm64)
- CPU: Apple M3
- Replicates: fresh process per replicate

| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| node | system | Mesa headless (kernel baseline) | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8, instrumentation=none | cycle | - | - | 15 | 1077.088 | 1109.439 | 1068.932–1088.768 | elapsedMs: 1077.088<br>msPerTick: 2.154<br>totalTicks: 500.000 | 0 / 0 |
| browser | system | Mesa + Solara (agents + summary) | agents+two-statistics | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=requestAnimationFrame | actionToRenderCompleteMs | - | - | 7425 | 130.900 | 196.700 | 130.600–131.300 | - | 0 / 0 |
| browser | system | Mesa + TenSnap binding + Web host (rAF frame latency) | agents+two-statistics | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=requestAnimationFrame | actionToRenderCompleteMs | - | - | 7425 | 20.300 | 33.400 | 19.100–29.900 | - | 0 / 0 |
| browser | system | Mesa + TenSnap binding + Web host (timeout throughput) | agents+two-statistics | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=setTimeout | actionToRunCompletionMs | - | - | 7425 | 16.600 | 18.400 | 16.600–16.600 | - | 0 / 0 |

## Paired comparisons

Ratios are treatment / baseline; values below 1 favour the treatment. Confidence intervals resample paired independent replicates, never individual steps.

| Comparison | Metric | Suite | Baseline | Treatment | Pairs | Median ratio (95% CI) | Median difference ms (95% CI) |
|---|---|---|---|---|---:|---:|---:|
| mesa-ui-render-complete:actionToRenderCompleteMs:browser:-:- | actionToRenderCompleteMs | browser | mesa-solara | mesa-tensnap-web-raf | 15 | 0.156 (0.146–0.228) | -110.200 (-111.600–-101.200) |

Raw measurements are in `samples.jsonl`; derived publication data and the SVG figure are in `analysis/`; `manifest.json` is the machine-readable experiment record.
