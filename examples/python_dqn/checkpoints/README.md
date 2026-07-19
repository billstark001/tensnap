# Guide Policy Checkpoints

Place trained DQN guide checkpoints (`.pt` or `.pth`) in this directory.

`evac_viz.py` scans this directory at startup and exposes the file names through
the TenSnap `Guide Model` parameter. The built-in reset action and the
`Reset Guide Model` action reload the currently selected checkpoint.

`dqn_latest.pt` is the bundled reference policy trained for 500 episodes with
training seed 7 and checkpoint schema `fire-evacuation-v2`. It is intended for
the runnable demo, not as a general pretrained evacuation policy.

Checkpoint compatibility, state semantics, and the evaluation standard are
documented in [../MODEL.md](../MODEL.md#reinforcement-learning-formulation).
Retrain checkpoints made for the earlier environment before using them with this
version:

```bash
cd examples
python -m python_dqn.main --mode train --episodes 500 --seed 7
python -m python_dqn.main --mode compare --episodes 100 \
  --checkpoint python_dqn/checkpoints/dqn_latest.pt --seed 4000
```
