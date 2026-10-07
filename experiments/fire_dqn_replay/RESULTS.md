# Fire/DQN exact replay results — 2026-10-07

Completed on local branch `codex/fire-dqn-exact-replay`, without a commit or GUI. The base commit is `5e18713a1e7f34d19232026032341b4e4980530a`. The dirty-tree source snapshot and per-file SHA-256 values in the manifest identify the implementation; the base commit alone does not. Every retained source file matches the final working tree at completion.

## Method and result

The bundled seed-7 policy runs on 100 held-out episode seeds, 5000–5099. Each checkpoint is captured after two no-guide steps, before the DQN's first signal. The replay horizon is at most 20 steps, ending earlier on termination; the observed horizons range from 13 to 20 steps (1,921 reference steps per encoding). Recorded-action replay and a fresh greedy-policy replay compare every retained outcome-bearing host field, action, observation, reward, done flag and outcome.

| Measure | JSON | MessagePack |
| --- | --- | --- |
| Exact capture restoration | 100/100 | 100/100 |
| Exact recorded-action replay | 100/100 | 100/100 |
| Exact greedy-policy replay | 100/100 | 100/100 |
| Seed success rate, 95% Wilson interval | 100%; [96.30%, 100%] | 100%; [96.30%, 100%] |
| Projected baseline: identical visible state on restore | 100/100 | 100/100 |
| Projected baseline: future divergence | 100/100 | 100/100 |
| First divergence at future step 1 / 2 | 98 / 2 | 98 / 2 |
| Paired mean DQN-minus-no-guide evacuated people | +13.18 | +13.18 |
| Paired 95% percentile bootstrap interval | [12.84, 13.52] | [12.84, 13.52] |

Paired branches run separately from the same exact checkpoint to termination, with mean evacuations of 27.42 for DQN and 14.24 for no guide. The bootstrap uses 10,000 resamples of seed pairs and seed 20261007. The two encodings reuse one seed cohort and are not pooled as independent observations.

The non-exact inverse deliberately retains the advanced RNG, policy and collector history while restoring visible positions, fire, statuses, target exits, parameters and time. Divergence is measured on the visible projection or transition output. This establishes the distinction between visible and outcome-bearing state for this model; it does not imply that every projected inverse must diverge or that evacuation requires DQN.

## Verification and implementation boundary

- 26 example/harness tests pass, covering terminal checkpoints, frozen snapshots, policy replacement, missing policy files, pending structural parameters, non-contiguous agent IDs, source import ordering, rejection/rollback and artifact corruption. The Python binding suite passes 165 tests.
- The real agent CLI, with protocol validation set to `error` in both directions, captures at time 4, advances to time 7 and restores time 4 using only the checkpoint. The before/after checkpoint data is identical. Both the simulator and the CLI daemon were stopped afterward.
- Additional trace checks confirm 7,684 identical host/projection comparisons across both exact replay variants and encodings; all 1,921 reference steps also match between JSON and MessagePack.
- Evidence verification reconstructs the seed/phase matrix, checkpoints, exact matches, projected divergences, paired terminal outcomes and statistics from retained state, and checks all source/policy/artifact hashes.
- CPU inference continuation after initial synchronization is supported. Training state, CUDA, NetLogo, arbitrary Mesa events and future resets that reread external resources are outside this guarantee. Renderer chart-history policy is local to the client; model collector history is restored exactly.

The normal example uses `@checkpoint` and advertises checkpoint restoration only. The explicit guide-action probe declares `action.kwargs` before the experiment handshake. `run.py`, `projected.py` and `test_evidence.py` in this directory are publication tooling, not example code. The model-owned `examples/python_dqn/checkpoint.py` is part of the example. Existing training and ranking artifacts remain tied to their historical source version; their numbers are not reused as results for this experiment.

The recorded environment is Python 3.13.15, Mesa 3.5.1, PyTorch 2.13.0, NumPy 2.3.5, MessagePack 1.2.1 and websockets 16.1.1 on macOS arm64, using one CPU Torch thread and deterministic algorithms.

## Evidence and commands

The full evidence is retained locally in the ignored [benchmark-results/fire-dqn-replay](../../benchmark-results/fire-dqn-replay/summary.json) directory, including compressed trajectories, 200 checkpoints, the input policy and the exact source snapshot. Strict CLI evidence is in [benchmark-results/fire-dqn-cli/summary.json](../../benchmark-results/fire-dqn-cli/summary.json).

```bash
python experiments/fire_dqn_replay/run.py verify
# To reproduce without overwriting the completed artifact:
python experiments/fire_dqn_replay/run.py run --output benchmark-results/fire-dqn-replay-reproduction
# Relevant tests:
PYTHONPATH=packages/tensnap-python:examples:. python -m pytest examples/python_dqn/tests experiments/fire_dqn_replay/test_evidence.py -q -o addopts=''
PYTHONPATH=packages/tensnap-python python -m pytest packages/tensnap-python/tests -q -o addopts=''
```

See [README.md](README.md) for the procedure, retained fields, statistics and private API boundary. No manual GUI work remains.
