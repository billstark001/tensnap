# Fire/DQN exact continuation experiment

See [RESULTS.md](RESULTS.md) for the completed 100-seed experiment and validation.

This directory is publication tooling, **not part of the runnable example**. `run.py` controls a real local WebSocket host, reads host-private state independently, writes evidence, and verifies it. `projected.py` installs the intentionally non-exact inverse only on this experiment host. `ExplicitAction` is an experiment-only action that applies recorded guide signals through the binding's ordinary step publication; it is not added to `evac_viz.py`. `test_evidence.py` tests the harness and artifact verifier. The reusable model checkpoint in `examples/python_dqn/checkpoint.py` _is_ example functionality.

Run from the repository root with Python, Mesa, PyTorch, NumPy, MessagePack, and websockets installed:

```bash
python experiments/fire_dqn_replay/run.py run
python experiments/fire_dqn_replay/run.py verify
# Equivalent shortcuts:
pnpm evidence:fire:replay
pnpm evidence:fire:replay:verify
# Small run, retaining the same scientific procedure:
python experiments/fire_dqn_replay/run.py run --seeds 2 --output benchmark-results/fire-dqn-replay-small
```

The default plan uses the bundled seed-7 policy, 100 episode seeds 5000–5099, and both JSON and MessagePack. Training used seeds 8–507, so these episode seeds are held out from training. The two encodings reuse the same seeds and are reported separately, never pooled into 200 independent observations. CPU inference uses one Torch thread and deterministic algorithms.

For each seed/encoding, the client syncs, advances two no-guide steps and captures a checkpoint before the DQN's first signal. It then:

1. Runs the greedy DQN for up to 20 steps, stopping at episode termination.
2. Restores the checkpoint alone and replays the recorded guide actions.
3. Restores again and lets the greedy policy recompute its own actions.
4. Restores the complete visible projection without the checkpoint, verifies identical visible state immediately, and replays the recorded actions.
5. Restores the exact checkpoint separately for DQN and no-guide branches, running each to termination (resolution or the 50-step time limit).

Exact equality covers every retained outcome-bearing host field, every observation, action, reward, termination flag and outcome, not just final counts. Derived route caches and cell-list order are rebuilt; their values do not affect this model's decisions. Policy weights are hashed once per audited state and embedded in every checkpoint. The inference boundary excludes optimizer/target-network/replay-buffer training state and external resources. The baseline retains advanced RNGs, inference policy and private collector history; it reconstructs reward flags from visible status. First divergence is measured on visible projection **or transition output**, relative to the capture point; a missing divergence is right-censored at the observed horizon. It is a controlled demonstration of an incomplete inverse, not a claim about all possible projected restoration implementations.

The exact success rate has a two-sided 95% Wilson score interval. Paired DQN-minus-no-guide differences count evacuated people at termination; their 95% percentile bootstrap interval resamples the 100 seed pairs 10,000 times with seed 20261007. Paired branches share the checkpoint RNG state; different policies can consume different random draws later, so this is not a coupled random stream for every individual event. This study does not measure model realism, general policy quality, usability, or cross-runtime parity.

Evidence defaults to ignored `benchmark-results/fire-dqn-replay/`:

- `manifest.json`: base commit, branch, dirty flag, exact source hashes, software versions, device/settings, plan, policy hash and artifact checksums.
- `source/`: a runnable snapshot of all Python binding/model/experiment source, tests, package metadata and protocol specification used by the experiment.
- `policy/`: the retained input policy; the host reads this immutable copy.
- `checkpoints/`: one compressed MessagePack model checkpoint per seed/encoding.
- `trajectories.jsonl.gz`: full host/visible states at capture, restoration and every step of all six trajectories, including private RNGs and collectors.
- `trials.json` and `summary.json`: per-trial comparisons and derived statistics.

A dirty tree is allowed because this workflow explicitly supports uncommitted research work. `source/` plus hashes identifies the implementation, while the base commit alone does not. Output is staged, verified, then renamed; existing artifacts are never overwritten. Verification checks the complete seed/phase matrix, source/policy/file hashes, checkpoint-to-host equality, restoration snapshots, contiguous trajectories, per-state hashes, population conservation, exact state comparisons, first divergence, terminal paired outcomes, and full statistical reconstruction. It verifies retained evidence without rerunning the simulation; rerunning `source/experiments/fire_dqn_replay/run.py` with `--policy` pointing to the retained policy reproduces it in the recorded software environment.

The experiment host explicitly declares `action.kwargs` before the handshake for its recorded-action probe. The normal example needs no such probe.

No GUI is needed. The only private binding access is the scenario clock and ordinary step helper, because there is no public checkpoint clock setter or explicit-guide-action step API. Normal example checkpoints restore the clock internally even when the client sends only the checkpoint. There is no wire schema change.
