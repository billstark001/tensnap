# TenSnap reproducible benchmark

Generated: 2026-10-17T07:06:38.972Z

- Commit: f44651d75613e85d3865566ed4ee60610b1832d2
- Node: v26.8.1; V8: 14.6.202.34-node.28
- OS: darwin 27.0.0 (arm64)
- CPU: Apple M3
- Replicates: fresh process per replicate

| Suite | Category | Workload | Feature level | Dimensions | Primary metric | Encoding | Validation | Samples | Median ms | P95 ms | Independent-replicate median bootstrap 95% CI | Auxiliary metrics (median) | Wire bytes R→S / S→R |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | json | off | 1500 | 0.012 | 0.016 | 0.011–0.012 | - | 194115 / 2089320 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | json | error | 1500 | 0.049 | 0.064 | 0.048–0.050 | - | 194115 / 2089320 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | msgpack | off | 1500 | 0.021 | 0.030 | 0.020–0.021 | - | 154215 / 1537905 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | msgpack | error | 1500 | 0.054 | 0.069 | 0.053–0.054 | - | 154215 / 1537905 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | json | off | 1500 | 0.098 | 0.132 | 0.096–0.101 | - | 194115 / 2089320 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | json | error | 1500 | 0.134 | 0.173 | 0.132–0.136 | - | 194115 / 2089320 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | msgpack | off | 1500 | 0.101 | 0.136 | 0.098–0.106 | - | 154215 / 1537905 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | msgpack | error | 1500 | 0.134 | 0.175 | 0.131–0.136 | - | 154215 / 1537905 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | json | off | 1500 | 16.700 | 18.300 | 16.650–16.700 | actionToRenderCompleteMs: 16.700 | 227760 / 2123250 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | json | error | 1500 | 16.700 | 18.200 | 16.650–16.700 | actionToRenderCompleteMs: 16.700 | 227760 / 2123250 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | msgpack | off | 1500 | 16.700 | 18.400 | 16.600–16.700 | actionToRenderCompleteMs: 16.700 | 189435 / 1573425 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=0 | cycle | msgpack | error | 1500 | 16.700 | 18.300 | 16.600–16.700 | actionToRenderCompleteMs: 16.700 | 189435 / 1573425 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | json | off | 1500 | 0.023 | 0.033 | 0.022–0.023 | - | 194115 / 3443175 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | json | error | 1500 | 0.130 | 0.162 | 0.129–0.131 | - | 194115 / 3443175 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | msgpack | off | 1500 | 0.038 | 0.058 | 0.037–0.038 | - | 154215 / 2344605 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | msgpack | error | 1500 | 0.139 | 0.203 | 0.137–0.140 | - | 154215 / 2344605 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | json | off | 1500 | 0.119 | 0.152 | 0.114–0.123 | - | 194115 / 3443175 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | json | error | 1500 | 0.236 | 0.377 | 0.235–0.238 | - | 194115 / 3443175 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | msgpack | off | 1500 | 0.121 | 0.169 | 0.118–0.129 | - | 154215 / 2344605 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | msgpack | error | 1500 | 0.243 | 0.396 | 0.236–0.254 | - | 154215 / 2344605 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | json | off | 1500 | 16.700 | 18.400 | 16.600–16.700 | actionToRenderCompleteMs: 16.700 | 227760 / 3477105 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | json | error | 1500 | 16.700 | 18.200 | 16.600–16.700 | actionToRenderCompleteMs: 16.700 | 227760 / 3477105 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | msgpack | off | 1500 | 16.700 | 18.300 | 16.600–16.700 | actionToRenderCompleteMs: 16.700 | 189435 / 2380125 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=10 | cycle | msgpack | error | 1500 | 16.600 | 18.300 | 16.600–16.700 | actionToRenderCompleteMs: 16.600 | 189435 / 2380125 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | json | off | 1500 | 0.474 | 0.597 | 0.472–0.477 | - | 194115 / 122698125 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | json | error | 1500 | 3.481 | 3.659 | 3.468–3.492 | - | 194115 / 122698125 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | msgpack | off | 1500 | 0.581 | 0.693 | 0.577–0.582 | - | 154215 / 70826685 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | msgpack | error | 1500 | 3.576 | 3.706 | 3.565–3.588 | - | 154215 / 70826685 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | json | off | 1500 | 0.611 | 0.679 | 0.609–0.613 | - | 194115 / 122698125 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | json | error | 1500 | 3.599 | 3.830 | 3.580–3.616 | - | 194115 / 122698125 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | msgpack | off | 1500 | 0.701 | 0.780 | 0.696–0.701 | - | 154215 / 70826685 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | msgpack | error | 1500 | 3.666 | 3.900 | 3.656–3.679 | - | 154215 / 70826685 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | json | off | 1500 | 16.700 | 18.300 | 16.700–16.700 | actionToRenderCompleteMs: 16.700 | 227760 / 122732055 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | json | error | 1500 | 16.700 | 18.100 | 16.700–16.700 | actionToRenderCompleteMs: 16.700 | 227760 / 122732055 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | msgpack | off | 1500 | 16.700 | 18.300 | 16.700–16.700 | actionToRenderCompleteMs: 16.700 | 189435 / 70862205 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=1000, changedAgents=1000 | cycle | msgpack | error | 1500 | 16.700 | 18.300 | 16.650–16.700 | actionToRenderCompleteMs: 16.700 | 189435 / 70862205 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | json | off | 1500 | 0.071 | 0.090 | 0.069–0.072 | - | 194115 / 30538305 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | json | error | 1500 | 0.418 | 0.699 | 0.416–0.418 | - | 194115 / 30538305 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | msgpack | off | 1500 | 0.087 | 0.109 | 0.086–0.087 | - | 154215 / 20453355 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | msgpack | error | 1500 | 0.431 | 0.709 | 0.427–0.433 | - | 154215 / 20453355 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | json | off | 1500 | 0.166 | 0.206 | 0.161–0.169 | - | 194115 / 30538305 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | json | error | 1500 | 0.546 | 0.797 | 0.544–0.549 | - | 194115 / 30538305 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | msgpack | off | 1500 | 0.171 | 0.220 | 0.167–0.173 | - | 154215 / 20453355 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | msgpack | error | 1500 | 0.554 | 0.794 | 0.552–0.556 | - | 154215 / 20453355 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | json | off | 1500 | 16.700 | 19.100 | 16.600–16.700 | actionToRenderCompleteMs: 16.700 | 227760 / 30572235 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | json | error | 1500 | 16.700 | 28.100 | 16.600–16.700 | actionToRenderCompleteMs: 16.700 | 227760 / 30572235 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | msgpack | off | 1500 | 16.700 | 19.300 | 16.600–16.700 | actionToRenderCompleteMs: 16.700 | 189435 / 20488875 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=100 | cycle | msgpack | error | 1500 | 16.600 | 19.100 | 16.600–16.600 | actionToRenderCompleteMs: 16.600 | 189435 / 20488875 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | json | off | 1500 | 0.013 | 0.020 | 0.013–0.013 | - | 194115 / 18163020 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | json | error | 1500 | 0.049 | 0.064 | 0.047–0.050 | - | 194115 / 18163020 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | msgpack | off | 1500 | 0.016 | 0.025 | 0.015–0.017 | - | 154215 / 13241655 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | msgpack | error | 1500 | 0.053 | 0.067 | 0.051–0.053 | - | 154215 / 13241655 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | json | off | 1500 | 0.098 | 0.129 | 0.097–0.098 | - | 194115 / 18163020 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | json | error | 1500 | 0.132 | 0.174 | 0.130–0.136 | - | 194115 / 18163020 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | msgpack | off | 1500 | 0.096 | 0.127 | 0.095–0.098 | - | 154215 / 13241655 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | msgpack | error | 1500 | 0.134 | 0.180 | 0.133–0.136 | - | 154215 / 13241655 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | json | off | 1500 | 16.700 | 18.300 | 16.700–16.700 | actionToRenderCompleteMs: 16.700 | 227760 / 18196950 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | json | error | 1500 | 16.700 | 18.300 | 16.700–16.700 | actionToRenderCompleteMs: 16.700 | 227760 / 18196950 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | msgpack | off | 1500 | 16.700 | 18.300 | 16.600–16.700 | actionToRenderCompleteMs: 16.700 | 189435 / 13277175 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=0 | cycle | msgpack | error | 1500 | 16.700 | 18.300 | 16.600–16.700 | actionToRenderCompleteMs: 16.700 | 189435 / 13277175 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | json | off | 1500 | 4.970 | 5.611 | 4.911–4.990 | - | 194115 / 1241865960 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | json | error | 1500 | 37.060 | 44.511 | 36.844–37.258 | - | 194115 / 1241865960 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | msgpack | off | 1500 | 6.194 | 6.745 | 6.166–6.273 | - | 154215 / 723780435 |
| node | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | msgpack | error | 1500 | 38.197 | 45.192 | 37.928–38.493 | - | 154215 / 723780435 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | json | off | 1500 | 5.322 | 5.689 | 5.308–5.341 | - | 194115 / 1241865960 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | json | error | 1500 | 38.355 | 40.999 | 38.139–38.867 | - | 194115 / 1241865960 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | msgpack | off | 1500 | 6.375 | 6.848 | 6.353–6.388 | - | 154215 / 723780435 |
| ws | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | msgpack | error | 1500 | 38.771 | 41.893 | 38.579–38.871 | - | 154215 / 723780435 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | json | off | 1500 | 34.600 | 38.600 | 34.450–34.750 | actionToRenderCompleteMs: 34.600 | 227760 / 1241899890 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | json | error | 1500 | 51.500 | 57.500 | 51.400–51.650 | actionToRenderCompleteMs: 51.500 | 227760 / 1241899890 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | msgpack | off | 1500 | 34.800 | 39.400 | 34.300–35.300 | actionToRenderCompleteMs: 34.800 | 189435 / 723815955 |
| browser | publication | v0.3.random-walk.sparse | protocol+core+renderer | agentCount=10000, changedAgents=10000 | cycle | msgpack | error | 1500 | 51.400 | 56.300 | 51.400–51.600 | actionToRenderCompleteMs: 51.400 | 189435 / 723815955 |
| node | core | v0.3.core-trace.apply | core+chart+monitor | agentCount=10000, changedAgents=100, monitorArrayLength=64 | cycle | - | - | 1500 | 0.035 | 0.042 | 0.035–0.035 | changedItems: 100.000<br>monitorValues: 64.000 | 0 / 0 |
| node | core | v0.3.state-sync.replace | replace-state-sync | agentCount=10000, changedAgents=100 | cycle | - | - | 1500 | 27.636 | 29.569 | 27.549–27.773 | synchronizedItems: 10000.000<br>snapshotBytes: 1190096.000 | 0 / 0 |
| node | snapshot | v0.3.snapshot-restore.archive | archive+restore | agentCount=10000, changedAgents=100, segmentFrames=30 | cycle | - | - | 1500 | 108.408 | 162.832 | 107.205–108.748 | archiveBytes: 2815638.000<br>archiveSegments: 3.000 | 0 / 0 |
| browser | comparison | comparison.random-walk.canvas2d | agents-only | agentCount=1000, changedAgents=0 | browserMutationMs | - | - | 1500 | 0.000 | 0.000 | 0.000–0.000 | rendererMutationMs: 0.000<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.leafer | agents-only | agentCount=1000, changedAgents=0 | browserMutationMs | - | - | 1500 | 0.000 | 0.000 | 0.000–0.000 | rendererMutationMs: 0.000<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.tensnap-renderer | agents-only | agentCount=1000, changedAgents=0 | browserMutationMs | - | - | 1500 | 0.000 | 0.100 | 0.000–0.000 | rendererMutationMs: 0.000<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.canvas2d | agents-only | agentCount=1000, changedAgents=10 | browserMutationMs | - | - | 1500 | 0.700 | 1.300 | 0.700–0.800 | rendererMutationMs: 0.700<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.leafer | agents-only | agentCount=1000, changedAgents=10 | browserMutationMs | - | - | 1500 | 0.100 | 0.200 | 0.100–0.100 | rendererMutationMs: 0.100<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.tensnap-renderer | agents-only | agentCount=1000, changedAgents=10 | browserMutationMs | - | - | 1500 | 0.100 | 0.200 | 0.100–0.100 | rendererMutationMs: 0.100<br>actionToFrameMs: 16.600 | 0 / 0 |
| browser | comparison | comparison.random-walk.canvas2d | agents-only | agentCount=1000, changedAgents=1000 | browserMutationMs | - | - | 1500 | 0.800 | 1.400 | 0.700–0.900 | rendererMutationMs: 0.800<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.leafer | agents-only | agentCount=1000, changedAgents=1000 | browserMutationMs | - | - | 1500 | 1.500 | 1.700 | 1.400–1.450 | rendererMutationMs: 1.500<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.tensnap-renderer | agents-only | agentCount=1000, changedAgents=1000 | browserMutationMs | - | - | 1500 | 1.600 | 1.800 | 1.600–1.600 | rendererMutationMs: 1.600<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.canvas2d | agents-only | agentCount=10000, changedAgents=0 | browserMutationMs | - | - | 1500 | 0.000 | 0.000 | 0.000–0.000 | rendererMutationMs: 0.000<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.leafer | agents-only | agentCount=10000, changedAgents=0 | browserMutationMs | - | - | 1500 | 0.000 | 0.100 | 0.000–0.000 | rendererMutationMs: 0.000<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.tensnap-renderer | agents-only | agentCount=10000, changedAgents=0 | browserMutationMs | - | - | 1500 | 0.000 | 0.100 | 0.000–0.000 | rendererMutationMs: 0.000<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.canvas2d | agents-only | agentCount=10000, changedAgents=100 | browserMutationMs | - | - | 1500 | 2.300 | 2.500 | 2.300–2.300 | rendererMutationMs: 2.300<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.leafer | agents-only | agentCount=10000, changedAgents=100 | browserMutationMs | - | - | 1500 | 0.100 | 0.200 | 0.100–0.100 | rendererMutationMs: 0.100<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.tensnap-renderer | agents-only | agentCount=10000, changedAgents=100 | browserMutationMs | - | - | 1500 | 0.100 | 0.200 | 0.100–0.200 | rendererMutationMs: 0.100<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.canvas2d | agents-only | agentCount=10000, changedAgents=10000 | browserMutationMs | - | - | 1500 | 2.500 | 2.700 | 2.500–2.600 | rendererMutationMs: 2.500<br>actionToFrameMs: 16.700 | 0 / 0 |
| browser | comparison | comparison.random-walk.leafer | agents-only | agentCount=10000, changedAgents=10000 | browserMutationMs | - | - | 1500 | 5.900 | 6.100 | 5.800–6.000 | rendererMutationMs: 5.900<br>actionToFrameMs: 16.900 | 0 / 0 |
| browser | comparison | comparison.random-walk.tensnap-renderer | agents-only | agentCount=10000, changedAgents=10000 | browserMutationMs | - | - | 1500 | 8.400 | 8.900 | 8.300–8.400 | rendererMutationMs: 8.400<br>actionToFrameMs: 25.000 | 0 / 0 |

## Paired comparisons

Ratios are treatment / baseline; values below 1 favour the treatment. Confidence intervals resample paired independent replicates, never individual steps.

| Comparison | Metric | Suite | Baseline | Treatment | Pairs | Median ratio (95% CI) | Median difference ms (95% CI) |
|---|---|---|---|---|---:|---:|---:|
| renderer-1k-c10:browserMutationMs:browser:-:- | browserMutationMs | browser | canvas-1k-c10 | leafer-1k-c10 | 15 | 0.143 (0.125–0.143) | -0.600 (-0.700–-0.600) |
| renderer-1k-c10:browserMutationMs:browser:-:- | browserMutationMs | browser | canvas-1k-c10 | tensnap-renderer-1k-c10 | 15 | 0.143 (0.125–0.143) | -0.600 (-0.700–-0.600) |
| renderer-1k-c1000:browserMutationMs:browser:-:- | browserMutationMs | browser | canvas-1k-c1000 | leafer-1k-c1000 | 15 | 1.750 (1.556–2.000) | 0.600 (0.500–0.700) |
| renderer-1k-c1000:browserMutationMs:browser:-:- | browserMutationMs | browser | canvas-1k-c1000 | tensnap-renderer-1k-c1000 | 15 | 2.000 (1.778–2.286) | 0.800 (0.700–0.900) |
| renderer-10k-c100:browserMutationMs:browser:-:- | browserMutationMs | browser | canvas-10k-c100 | leafer-10k-c100 | 15 | 0.043 (0.043–0.043) | -2.200 (-2.200–-2.200) |
| renderer-10k-c100:browserMutationMs:browser:-:- | browserMutationMs | browser | canvas-10k-c100 | tensnap-renderer-10k-c100 | 15 | 0.043 (0.043–0.083) | -2.200 (-2.200–-2.150) |
| renderer-10k-c10000:browserMutationMs:browser:-:- | browserMutationMs | browser | canvas-10k-c10000 | leafer-10k-c10000 | 15 | 2.320 (2.288–2.360) | 3.350 (3.300–3.400) |
| renderer-10k-c10000:browserMutationMs:browser:-:- | browserMutationMs | browser | canvas-10k-c10000 | tensnap-renderer-10k-c10000 | 15 | 3.320 (3.231–3.320) | 5.800 (5.800–6.000) |

Raw measurements are in `samples.jsonl`; derived publication data and the SVG figure are in `analysis/`; `manifest.json` is the machine-readable experiment record.
