# TenSnap reproducible benchmark

Generated: 2026-10-10T01:31:54.674Z

- Commit: c80c882396beb4b4da0703616b8af7c10de0534b
- Node: v26.8.1; V8: 14.6.202.34-node.28
- OS: darwin 25.6.0 (arm64)
- CPU: Apple M3
- Replicates: fresh process per replicate

| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| node | system | Agents.jl headless (kernel baseline) | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8 | cycle | - | - | 15 | 99.184 | 224.697 | 97.976–113.481 | totalTicks: 500.000<br>elapsedMs: 99.184<br>msPerTick: 0.198 | 0 / 0 |
| browser | system | Agents.jl + WGLMakie (agents-only) | agents-only | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=requestAnimationFrame | actionToRenderCompleteMs | - | - | 7425 | 12.700 | 16.400 | 12.600–12.900 | - | 0 / 0 |
| browser | system | Agents.jl + TenSnap binding + Web host (rAF frame latency) | agents-only | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=requestAnimationFrame | actionToRenderCompleteMs | - | - | 7425 | 16.700 | 31.600 | 16.700–16.800 | - | 0 / 0 |
| browser | system | Agents.jl + TenSnap binding + Web host (timeout throughput) | agents-only | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=setTimeout | actionToRunCompletionMs | - | - | 7425 | 16.400 | 18.900 | 16.400–16.500 | - | 0 / 0 |

## Paired comparisons

Ratios are treatment / baseline; values below 1 favour the treatment. Confidence intervals resample paired independent replicates, never individual steps.

| Comparison | Metric | Suite | Baseline | Treatment | Pairs | Median ratio (95% CI) | Median difference ms (95% CI) |
|---|---|---|---|---|---:|---:|---:|
| julia-ui-render-complete:actionToRenderCompleteMs:browser:-:- | actionToRenderCompleteMs | browser | agents-wglmakie | agents-tensnap-web-raf | 15 | 1.305 (1.285–1.355) | 3.900 (3.700–4.400) |

Raw measurements are in `samples.jsonl`; derived publication data and the SVG figure are in `analysis/`; `manifest.json` is the machine-readable experiment record.
