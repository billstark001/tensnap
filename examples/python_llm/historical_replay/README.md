# Historical replay checkpoint

This directory is retained in the Git snapshot before the current tutorial drops its older protocol. Restore that snapshot in a separate worktree when historical execution is needed; the maintained working tree does not carry these entry points.

The original five trajectories identify experiment base commit `ee261d0b`. Their 19 recorded Python source hashes all match commit `a3c777b3d531751c17d52ab7ee5922cdc288aa14`. `original_models.py` reads and verifies those exact files from Git into a temporary import directory. It does not copy the current tutorial models or modify the checkout. Recorded dependency and CLI information remains in `versions.json` and the original artifact directory.

Later factorial experiments were collected from a modified working tree based on `a3c777b3d531751c17d52ab7ee5922cdc288aa14`. This checkpoint commit records the previously uncommitted implementation, control scripts, note fix, and repair driver. The separate per-experiment `source/` directories and `plan.json` source hashes retain the exact collection versions, including the earlier note-length failure. Decision tapes and recordings remain local experiment data and are not committed here.

From the restored repository root:

```bash
python examples/python_llm/historical_replay/verify.py --input /path/to/python-llm-cli-replay-20261019
python examples/python_llm/historical_replay/serve_replay.py /path/to/case/spec.json --port 8765
python examples/python_llm/historical_replay/record_multiframe.py --output /path/to/new-output
python -m examples.python_llm.llm_experiments verify --input /path/to/factorial-llm-pilot-20261019
python -m examples.python_llm.llm_experiments verify --input /path/to/factorial-llm-pilot-20261019/naming-unstable-prefix
python -m examples.python_llm.repair_pilot verify --input /path/to/factorial-llm-repair-20261019
```

The verification and serving commands read saved decisions only. The multiframe input manifest retains original local data paths; adjust those paths when transferring the data to another machine. `llm_experiments`, `naming_pilot_continuation`, `repair_pilot` and `common/budget.py` are historical collection utilities rather than the maintained tutorial API.
