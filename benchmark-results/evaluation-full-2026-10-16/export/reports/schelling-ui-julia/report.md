# TenSnap reproducible benchmark

Generated: 2026-10-17T07:30:29.486Z

- Commit: f44651d75613e85d3865566ed4ee60610b1832d2
- Node: v26.8.1; V8: 14.6.202.34-node.28
- OS: darwin 27.0.0 (arm64)
- CPU: Apple M3
- Replicates: fresh process per replicate

| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| node | system | Agents.jl headless (kernel baseline) | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8 | cycle | - | - | 15 | 118.576 | 125.472 | 117.131–120.470 | totalTicks: 500.000<br>elapsedMs: 118.576<br>msPerTick: 0.237 | 0 / 0 |
| browser | system | Agents.jl + WGLMakie (agents-only) | agents-only | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=requestAnimationFrame | actionToRenderCompleteMs | - | - | 7425 | 12.700 | 15.800 | 12.600–13.000 | - | 0 / 0 |
| browser | system | Agents.jl + TenSnap binding + Web host (rAF frame latency) | agents-only | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=requestAnimationFrame | actionToRenderCompleteMs | - | - | 7425 | 16.700 | 17.800 | 16.700–16.700 | - | 0 / 0 |
| browser | system | Agents.jl + TenSnap binding + Web host (timeout throughput) | agents-only | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=setTimeout | actionToRunCompletionMs | - | - | 7425 | 8.400 | 13.200 | 8.400–8.500 | - | 0 / 0 |

## Paired comparisons

Ratios are treatment / baseline; values below 1 favour the treatment. Confidence intervals resample paired independent replicates, never individual steps.

| Comparison | Metric | Suite | Baseline | Treatment | Pairs | Median ratio (95% CI) | Median difference ms (95% CI) |
|---|---|---|---|---|---:|---:|---:|
| julia-ui-render-complete:actionToRenderCompleteMs:browser:-:- | actionToRenderCompleteMs | browser | agents-wglmakie | agents-tensnap-web-raf | 15 | 1.315 (1.285–1.336) | 4.000 (3.700–4.200) |

Raw measurements are in `samples.jsonl`; derived publication data and the SVG figure are in `analysis/`; `manifest.json` is the machine-readable experiment record.
