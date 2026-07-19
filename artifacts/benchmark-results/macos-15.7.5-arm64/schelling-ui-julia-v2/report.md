# TenSnap reproducible benchmark

Generated: 2026-07-19T21:21:30.123Z

- Commit: 771a9601206e629b2a09fbe8049df4d5667dc3ad
- Node: v24.14.1; V8: 13.6.233.17-node.44
- OS: darwin 24.6.0 (arm64)
- CPU: Apple M3
- Replicates: fresh process per replicate

| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| node | system | Agents.jl headless (kernel baseline) | kernel-only | grid=50x50, steps=500, similarityThreshold=0.8 | cycle | - | - | 15 | 97.302 | 219.392 | 96.798–100.317 | totalTicks: 500.000<br>elapsedMs: 97.302<br>msPerTick: 0.195 | 0 / 0 |
| browser | system | Agents.jl + WGLMakie (agents-only) | agents-only | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=requestAnimationFrame | actionToRenderCompleteMs | - | - | 7425 | 16.300 | 19.500 | 15.600–17.000 | - | 0 / 0 |
| browser | system | Agents.jl + TenSnap binding + Web host (rAF frame latency) | agents-only | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=requestAnimationFrame | actionToRenderCompleteMs | - | - | 7425 | 16.700 | 30.700 | 16.700–16.700 | - | 0 / 0 |
| browser | system | Agents.jl + TenSnap binding + Web host (timeout throughput) | agents-only | grid=50x50, finalTick=500, similarityThreshold=0.8, warmupActions=5, measuredActions=495, renderTrigger=setTimeout | actionToRunCompletionMs | - | - | 7425 | 16.600 | 21.000 | 16.500–16.600 | - | 0 / 0 |

## Paired comparisons

Ratios are treatment / baseline; values below 1 favour the treatment. Confidence intervals resample paired independent replicates, never individual steps.

| Comparison | Metric | Suite | Baseline | Treatment | Pairs | Median ratio (95% CI) | Median difference ms (95% CI) |
|---|---|---|---|---|---:|---:|---:|
| julia-ui-render-complete:actionToRenderCompleteMs:browser:-:- | actionToRenderCompleteMs | browser | agents-wglmakie | agents-tensnap-web-raf | 15 | 0.988 (0.982–1.099) | -0.200 (-0.300–1.500) |

Raw measurements are in `samples.jsonl`; derived publication data and the SVG figure are in `analysis/`; `manifest.json` is the machine-readable experiment record.
