# TenSnap reproducible benchmark

Generated: 2026-10-17T07:56:51.632Z

- Commit: f44651d75613e85d3865566ed4ee60610b1832d2
- Node: v26.8.1; V8: 14.6.202.34-node.28
- OS: darwin 27.0.0 (arm64)
- CPU: Apple M3
- Replicates: fresh process per replicate

| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| node | system | NetLogo 7.0.4 headless in-memory view | native-view-in-memory-raster | grid=50x50, density=0.8, balance=0.5, threshold=0.8, finalTick=500, rendering=HeadlessWorkspace.exportView() to BufferedImage after every action; final PNG encoding outside timing; no file I/O | actionToInMemoryViewMs | - | - | 7425 | 3.493 | 9.967 | 3.326–3.449 | patches: 2500.000<br>pngBytes: 4008.000<br>satisfiedPct: 0.281<br>segregationIndex: 0.604<br>modelTransitionMs: 2.502<br>patchRecolorMs: 0.826<br>viewRasterizationMs: 0.119 | 0 / 0 |

Raw measurements are in `samples.jsonl`; derived publication data and the SVG figure are in `analysis/`; `manifest.json` is the machine-readable experiment record.
