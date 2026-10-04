# Schelling headless audit

This is a publication experiment, **not part of the teaching examples**. It drives the four existing TenSnap Schelling hosts through the built agent CLI. Audit writers are injected by `TENSNAP_SCHELLING_AUDIT_STATE`; ordinary example launchers do no state scan, serialization, or audit file I/O.

The exact checkpoint hooks are also optional for a teaching integration. Projected scene restore can be much shorter: restore the grid, agents, parameters, and time. It may not retain RNG state or private update order, so the same later steps are not guaranteed. This experiment deliberately includes those private fields to test exact continuation.

From the repository root:

```sh
node artifacts/schelling-headless/run.mjs
```

Pass `python`, `go`, `julia`, or `js` to run only selected hosts. The script builds the CLI, starts each host on a free local port, enables strict protocol validation, and uses one connection per host. It runs five bounded steps, captures an exact model-owned checkpoint, advances three steps, restores it, and checks both the complete live model state and the three subsequent steps. It then restores the same checkpoint twice, applies thresholds 0.55 and 0.8, runs six steps per branch, and renders a PNG. The two branches must have different spatial trajectories.

Each host writes `results/<host>/report.json`, `checkpoint.json`, and `scene.png`; the script writes `results/summary.json`. Reports include source file hashes so an uncommitted run is identifiable. Temporary daemon contexts and sidecar state files are removed after each run. A failed host leaves a `failure.log` in its results directory; a successful rerun removes that log.

Hashes and trajectories are compared **within each host**. Different hosts use different random-number generators and update orders, so this experiment does not claim equal microscopic trajectories across languages.
