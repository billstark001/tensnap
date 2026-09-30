# TenSnap reproducible benchmark

Generated: 2026-07-19T21:51:50.963Z

- Commit: 771a9601206e629b2a09fbe8049df4d5667dc3ad
- Node: v24.14.1; V8: 13.6.233.17-node.44
- OS: darwin 24.6.0 (arm64)
- CPU: Apple M3
- Replicates: fresh process per replicate

| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| node | system | NetLogo 7.0.4 headless in-memory view | native-view-in-memory-raster | grid=50x50, density=0.8, balance=0.5, threshold=0.8, finalTick=500, rendering=HeadlessWorkspace.exportView() to BufferedImage after every action; final PNG encoding outside timing; no file I/O | actionToInMemoryViewMs | - | - | 7425 | 3.809 | 10.975 | 3.665–3.915 | patches: 2500.000<br>pngBytes: 4008.000<br>satisfiedPct: 0.281<br>segregationIndex: 0.604<br>modelTransitionMs: 2.734<br>patchRecolorMs: 0.933<br>viewRasterizationMs: 0.123 | 0 / 0 |

Raw measurements are in `samples.jsonl`; derived publication data and the SVG figure are in `analysis/`; `manifest.json` is the machine-readable experiment record.
