# TenSnap reproducible benchmark

Generated: 2026-10-10T01:04:44.512Z

- Commit: c80c882396beb4b4da0703616b8af7c10de0534b
- Node: v26.8.1; V8: 14.6.202.34-node.28
- OS: darwin 25.6.0 (arm64)
- CPU: Apple M3
- Replicates: fresh process per replicate

| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | json | off | 1500 | 0.013 | 0.021 | 0.012–0.014 | - | 194115 / 2089320 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | json | error | 1500 | 0.050 | 0.067 | 0.049–0.051 | - | 194115 / 2089320 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | msgpack | off | 1500 | 0.024 | 0.034 | 0.023–0.024 | - | 154215 / 1537905 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | msgpack | error | 1500 | 0.057 | 0.075 | 0.055–0.057 | - | 154215 / 1537905 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | json | off | 1500 | 0.091 | 0.125 | 0.089–0.094 | - | 194115 / 2089320 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | json | error | 1500 | 0.125 | 0.161 | 0.123–0.126 | - | 194115 / 2089320 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | msgpack | off | 1500 | 0.094 | 0.121 | 0.091–0.096 | - | 154215 / 1537905 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | msgpack | error | 1500 | 0.128 | 0.163 | 0.126–0.130 | - | 154215 / 1537905 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | json | off | 1500 | 16.700 | 18.300 | 16.600–16.700 | actionToRenderCompleteMs: 16.700 | 227760 / 2123250 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | json | error | 1500 | 16.700 | 18.400 | 16.650–16.700 | actionToRenderCompleteMs: 16.700 | 227760 / 2123250 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | msgpack | off | 1500 | 16.700 | 18.300 | 16.700–16.700 | actionToRenderCompleteMs: 16.700 | 189435 / 1573425 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | msgpack | error | 1500 | 16.700 | 18.400 | 16.600–16.700 | actionToRenderCompleteMs: 16.700 | 189435 / 1573425 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | json | off | 1500 | 0.027 | 0.039 | 0.026–0.027 | - | 194115 / 3443175 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | json | error | 1500 | 0.133 | 0.187 | 0.131–0.134 | - | 194115 / 3443175 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | msgpack | off | 1500 | 0.044 | 0.068 | 0.043–0.044 | - | 154215 / 2344605 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | msgpack | error | 1500 | 0.146 | 0.192 | 0.144–0.147 | - | 154215 / 2344605 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | json | off | 1500 | 0.109 | 0.139 | 0.108–0.110 | - | 194115 / 3443175 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | json | error | 1500 | 0.231 | 0.359 | 0.226–0.234 | - | 194115 / 3443175 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | msgpack | off | 1500 | 0.115 | 0.177 | 0.113–0.116 | - | 154215 / 2344605 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | msgpack | error | 1500 | 0.235 | 0.363 | 0.231–0.236 | - | 154215 / 2344605 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | json | off | 1500 | 16.600 | 18.400 | 16.600–16.700 | actionToRenderCompleteMs: 16.600 | 227760 / 3477105 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | json | error | 1500 | 16.600 | 18.400 | 16.600–16.700 | actionToRenderCompleteMs: 16.600 | 227760 / 3477105 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | msgpack | off | 1500 | 16.700 | 18.400 | 16.650–16.700 | actionToRenderCompleteMs: 16.700 | 189435 / 2380125 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | msgpack | error | 1500 | 16.600 | 18.300 | 16.600–16.700 | actionToRenderCompleteMs: 16.600 | 189435 / 2380125 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | json | off | 1500 | 0.530 | 0.643 | 0.526–0.533 | - | 194115 / 122698125 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | json | error | 1500 | 3.531 | 3.718 | 3.514–3.553 | - | 194115 / 122698125 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | msgpack | off | 1500 | 0.675 | 0.798 | 0.671–0.675 | - | 154215 / 70826685 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | msgpack | error | 1500 | 3.616 | 3.822 | 3.600–3.630 | - | 154215 / 70826685 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | json | off | 1500 | 0.647 | 0.727 | 0.644–0.650 | - | 194115 / 122698125 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | json | error | 1500 | 3.657 | 4.168 | 3.628–3.667 | - | 194115 / 122698125 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | msgpack | off | 1500 | 0.776 | 0.874 | 0.768–0.779 | - | 154215 / 70826685 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | msgpack | error | 1500 | 3.726 | 4.266 | 3.710–3.778 | - | 154215 / 70826685 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | json | off | 1500 | 16.700 | 18.400 | 16.650–16.700 | actionToRenderCompleteMs: 16.700 | 227760 / 122732055 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | json | error | 1500 | 16.700 | 18.400 | 16.650–16.700 | actionToRenderCompleteMs: 16.700 | 227760 / 122732055 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | msgpack | off | 1500 | 16.700 | 18.400 | 16.650–16.700 | actionToRenderCompleteMs: 16.700 | 189435 / 70862205 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | msgpack | error | 1500 | 16.700 | 18.400 | 16.600–16.700 | actionToRenderCompleteMs: 16.700 | 189435 / 70862205 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | json | off | 1500 | 0.076 | 0.099 | 0.075–0.077 | - | 194115 / 30538305 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | json | error | 1500 | 0.422 | 0.703 | 0.420–0.426 | - | 194115 / 30538305 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | msgpack | off | 1500 | 0.104 | 0.127 | 0.100–0.105 | - | 154215 / 20453355 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | msgpack | error | 1500 | 0.439 | 0.731 | 0.435–0.445 | - | 154215 / 20453355 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | json | off | 1500 | 0.160 | 0.205 | 0.157–0.162 | - | 194115 / 30538305 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | json | error | 1500 | 0.533 | 0.805 | 0.528–0.536 | - | 194115 / 30538305 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | msgpack | off | 1500 | 0.187 | 0.247 | 0.185–0.190 | - | 154215 / 20453355 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | msgpack | error | 1500 | 0.542 | 0.816 | 0.537–0.545 | - | 154215 / 20453355 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | json | off | 1500 | 16.750 | 27.700 | 16.700–16.800 | actionToRenderCompleteMs: 16.750 | 227760 / 30572235 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | json | error | 1500 | 16.800 | 29.300 | 16.700–16.800 | actionToRenderCompleteMs: 16.800 | 227760 / 30572235 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | msgpack | off | 1500 | 16.700 | 30.600 | 16.700–16.750 | actionToRenderCompleteMs: 16.700 | 189435 / 20488875 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | msgpack | error | 1500 | 16.700 | 31.400 | 16.700–16.800 | actionToRenderCompleteMs: 16.700 | 189435 / 20488875 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | json | off | 1500 | 0.013 | 0.021 | 0.012–0.014 | - | 194115 / 18163020 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | json | error | 1500 | 0.050 | 0.067 | 0.048–0.050 | - | 194115 / 18163020 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | msgpack | off | 1500 | 0.018 | 0.024 | 0.017–0.018 | - | 154215 / 13241655 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | msgpack | error | 1500 | 0.056 | 0.071 | 0.054–0.057 | - | 154215 / 13241655 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | json | off | 1500 | 0.090 | 0.112 | 0.089–0.091 | - | 194115 / 18163020 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | json | error | 1500 | 0.122 | 0.164 | 0.121–0.124 | - | 194115 / 18163020 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | msgpack | off | 1500 | 0.091 | 0.116 | 0.090–0.092 | - | 154215 / 13241655 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | msgpack | error | 1500 | 0.125 | 0.160 | 0.124–0.128 | - | 154215 / 13241655 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | json | off | 1500 | 16.700 | 18.400 | 16.700–16.700 | actionToRenderCompleteMs: 16.700 | 227760 / 18196950 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | json | error | 1500 | 16.700 | 18.400 | 16.700–16.700 | actionToRenderCompleteMs: 16.700 | 227760 / 18196950 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | msgpack | off | 1500 | 16.700 | 18.400 | 16.600–16.700 | actionToRenderCompleteMs: 16.700 | 189435 / 13277175 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | msgpack | error | 1500 | 16.700 | 18.400 | 16.600–16.700 | actionToRenderCompleteMs: 16.700 | 189435 / 13277175 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | json | off | 1500 | 5.516 | 6.112 | 5.501–5.531 | - | 194115 / 1241865960 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | json | error | 1500 | 37.895 | 45.779 | 37.762–38.085 | - | 194115 / 1241865960 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | msgpack | off | 1500 | 7.317 | 8.235 | 7.282–7.350 | - | 154215 / 723780435 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | msgpack | error | 1500 | 38.762 | 46.449 | 38.536–38.989 | - | 154215 / 723780435 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | json | off | 1500 | 5.904 | 6.525 | 5.860–5.928 | - | 194115 / 1241865960 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | json | error | 1500 | 38.841 | 49.191 | 38.650–39.065 | - | 194115 / 1241865960 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | msgpack | off | 1500 | 7.372 | 8.374 | 7.338–7.402 | - | 154215 / 723780435 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | msgpack | error | 1500 | 39.391 | 50.154 | 39.083–39.709 | - | 154215 / 723780435 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | json | off | 1500 | 35.700 | 41.800 | 35.400–36.000 | actionToRenderCompleteMs: 35.700 | 227760 / 1241899890 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | json | error | 1500 | 53.100 | 60.100 | 52.800–53.500 | actionToRenderCompleteMs: 53.100 | 227760 / 1241899890 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | msgpack | off | 1500 | 35.100 | 40.400 | 35.100–35.250 | actionToRenderCompleteMs: 35.100 | 189435 / 723815955 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | msgpack | error | 1500 | 51.700 | 58.600 | 51.350–51.900 | actionToRenderCompleteMs: 51.700 | 189435 / 723815955 |
| node | core | v0.3.core-trace.apply | core+chart+monitor | agentCount=10000, changedAgents=100, monitorArrayLength=64 | cycle | - | - | 1500 | 0.035 | 0.043 | 0.035–0.036 | changedItems: 100.000<br>monitorValues: 64.000 | 0 / 0 |
| node | core | v0.3.state-sync.replace | replace-state-sync | agentCount=10000, changedAgents=100 | cycle | - | - | 1500 | 28.034 | 30.613 | 27.776–28.248 | synchronizedItems: 10000.000<br>snapshotBytes: 1190096.000 | 0 / 0 |
| node | snapshot | v0.3.snapshot-restore.archive | archive+restore | agentCount=10000, changedAgents=100, segmentFrames=30 | cycle | - | - | 1500 | 110.066 | 166.537 | 108.891–111.274 | archiveBytes: 2815634.000<br>archiveSegments: 3.000 | 0 / 0 |
| browser | comparison | comparison.random-walk.canvas2d | agents-only | agentCount=1000, changedAgents=0 | browserMutationMs | - | - | 1500 | 0.000 | 0.000 | 0.000–0.000 | rendererMutationMs: 0.000<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.leafer | agents-only | agentCount=1000, changedAgents=0 | browserMutationMs | - | - | 1500 | 0.000 | 0.000 | 0.000–0.000 | rendererMutationMs: 0.000<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.tensnap-renderer | agents-only | agentCount=1000, changedAgents=0 | browserMutationMs | - | - | 1500 | 0.000 | 0.100 | 0.000–0.000 | rendererMutationMs: 0.000<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.canvas2d | agents-only | agentCount=1000, changedAgents=10 | browserMutationMs | - | - | 1500 | 0.700 | 1.300 | 0.700–0.800 | rendererMutationMs: 0.700<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.leafer | agents-only | agentCount=1000, changedAgents=10 | browserMutationMs | - | - | 1500 | 0.100 | 0.200 | 0.100–0.100 | rendererMutationMs: 0.100<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.tensnap-renderer | agents-only | agentCount=1000, changedAgents=10 | browserMutationMs | - | - | 1500 | 0.100 | 0.200 | 0.100–0.100 | rendererMutationMs: 0.100<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.canvas2d | agents-only | agentCount=1000, changedAgents=1000 | browserMutationMs | - | - | 1500 | 0.700 | 1.300 | 0.700–0.700 | rendererMutationMs: 0.700<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.leafer | agents-only | agentCount=1000, changedAgents=1000 | browserMutationMs | - | - | 1500 | 1.400 | 1.700 | 1.400–1.400 | rendererMutationMs: 1.400<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.tensnap-renderer | agents-only | agentCount=1000, changedAgents=1000 | browserMutationMs | - | - | 1500 | 1.500 | 1.800 | 1.500–1.600 | rendererMutationMs: 1.500<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.canvas2d | agents-only | agentCount=10000, changedAgents=0 | browserMutationMs | - | - | 1500 | 0.000 | 0.000 | 0.000–0.000 | rendererMutationMs: 0.000<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.leafer | agents-only | agentCount=10000, changedAgents=0 | browserMutationMs | - | - | 1500 | 0.000 | 0.000 | 0.000–0.000 | rendererMutationMs: 0.000<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.tensnap-renderer | agents-only | agentCount=10000, changedAgents=0 | browserMutationMs | - | - | 1500 | 0.000 | 0.100 | 0.000–0.000 | rendererMutationMs: 0.000<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.canvas2d | agents-only | agentCount=10000, changedAgents=100 | browserMutationMs | - | - | 1500 | 2.200 | 2.400 | 2.200–2.300 | rendererMutationMs: 2.200<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.leafer | agents-only | agentCount=10000, changedAgents=100 | browserMutationMs | - | - | 1500 | 0.100 | 0.200 | 0.100–0.100 | rendererMutationMs: 0.100<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.tensnap-renderer | agents-only | agentCount=10000, changedAgents=100 | browserMutationMs | - | - | 1500 | 0.200 | 0.200 | 0.200–0.200 | rendererMutationMs: 0.200<br>actionToFrameMs: 16.600 | 0 / 0 |
| browser | comparison | comparison.random-walk.canvas2d | agents-only | agentCount=10000, changedAgents=10000 | browserMutationMs | - | - | 1500 | 2.500 | 2.700 | 2.500–2.500 | rendererMutationMs: 2.500<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.leafer | agents-only | agentCount=10000, changedAgents=10000 | browserMutationMs | - | - | 1500 | 5.900 | 6.200 | 5.900–5.900 | rendererMutationMs: 5.900<br>actionToFrameMs: 17.000 | 0 / 0 |
| browser | comparison | comparison.random-walk.tensnap-renderer | agents-only | agentCount=10000, changedAgents=10000 | browserMutationMs | - | - | 1500 | 8.500 | 9.300 | 8.350–8.600 | rendererMutationMs: 8.500<br>actionToFrameMs: 25.300 | 0 / 0 |

## Paired comparisons

Ratios are treatment / baseline; values below 1 favour the treatment. Confidence intervals resample paired independent replicates, never individual steps.

| Comparison | Metric | Suite | Baseline | Treatment | Pairs | Median ratio (95% CI) | Median difference ms (95% CI) |
|---|---|---|---|---|---:|---:|---:|
| renderer-1k-c10:browserMutationMs:browser:-:- | browserMutationMs | browser | canvas-1k-c10 | leafer-1k-c10 | 15 | 0.143 (0.125–0.143) | -0.600 (-0.700–-0.600) |
| renderer-1k-c10:browserMutationMs:browser:-:- | browserMutationMs | browser | canvas-1k-c10 | tensnap-renderer-1k-c10 | 15 | 0.143 (0.125–0.143) | -0.600 (-0.700–-0.600) |
| renderer-1k-c1000:browserMutationMs:browser:-:- | browserMutationMs | browser | canvas-1k-c1000 | leafer-1k-c1000 | 15 | 2.000 (1.857–2.000) | 0.700 (0.600–0.700) |
| renderer-1k-c1000:browserMutationMs:browser:-:- | browserMutationMs | browser | canvas-1k-c1000 | tensnap-renderer-1k-c1000 | 15 | 2.143 (2.000–2.286) | 0.800 (0.800–0.850) |
| renderer-10k-c100:browserMutationMs:browser:-:- | browserMutationMs | browser | canvas-10k-c100 | leafer-10k-c100 | 15 | 0.045 (0.043–0.045) | -2.100 (-2.200–-2.100) |
| renderer-10k-c100:browserMutationMs:browser:-:- | browserMutationMs | browser | canvas-10k-c100 | tensnap-renderer-10k-c100 | 15 | 0.091 (0.087–0.091) | -2.000 (-2.100–-2.000) |
| renderer-10k-c10000:browserMutationMs:browser:-:- | browserMutationMs | browser | canvas-10k-c10000 | leafer-10k-c10000 | 15 | 2.360 (2.340–2.400) | 3.400 (3.350–3.500) |
| renderer-10k-c10000:browserMutationMs:browser:-:- | browserMutationMs | browser | canvas-10k-c10000 | tensnap-renderer-10k-c10000 | 15 | 3.400 (3.320–3.520) | 6.000 (5.800–6.200) |

Raw measurements are in `samples.jsonl`; derived publication data and the SVG figure are in `analysis/`; `manifest.json` is the machine-readable experiment record.
