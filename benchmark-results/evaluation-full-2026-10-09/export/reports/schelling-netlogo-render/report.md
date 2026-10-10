# TenSnap reproducible benchmark

Generated: 2026-10-10T01:58:29.175Z

- Commit: c80c882396beb4b4da0703616b8af7c10de0534b
- Node: v26.8.1; V8: 14.6.202.34-node.28
- OS: darwin 25.6.0 (arm64)
- CPU: Apple M3
- Replicates: fresh process per replicate

| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| node | system | NetLogo 7.0.4 headless in-memory view | native-view-in-memory-raster | grid=50x50, density=0.8, balance=0.5, threshold=0.8, finalTick=500, rendering=HeadlessWorkspace.exportView() to BufferedImage after every action; final PNG encoding outside timing; no file I/O | actionToInMemoryViewMs | - | - | 7425 | 3.492 | 10.450 | 3.413–3.463 | patches: 2500.000<br>pngBytes: 4008.000<br>satisfiedPct: 0.281<br>segregationIndex: 0.604<br>modelTransitionMs: 2.523<br>patchRecolorMs: 0.830<br>viewRasterizationMs: 0.121 | 0 / 0 |

Raw measurements are in `samples.jsonl`; derived publication data and the SVG figure are in `analysis/`; `manifest.json` is the machine-readable experiment record.
