# Agent CLI diagnostic smoke runner

This small diagnostic drives the built agent CLI against the JavaScript Schelling example with a 20×16 grid, seed 7 and strict protocol validation. It checks connection/inspection, a parameter update, a run bounded by `time >= 5`, checkpoint capture, one advance/restore comparison and offscreen PNG rendering. It does not supply the paper's four-host restoration or three-step rerun evidence.

From the repository root with dependencies installed:

```sh
node artifacts/agent-cli-smoke/run.mjs
```

The runner builds the CLI, launches a simulator and daemon, and replaces its own `artifacts/agent-cli-smoke/results/summary.json` and `scene.png`. The summary records the actual checkout revision; there is no fixed implementation commit in this guide. Temporary contexts, checkpoint payloads, snapshots and process logs are removed after verification, while the two diagnostic results remain until explicitly deleted. Do not run it concurrently with another instance using its fixed context/output paths.

For the current paper evidence use [the full evaluation guide](../../benchmarks/evaluation/README.md) and `benchmark-results/evaluation-full-2026-10-09`. That batch retains the four-host reports and original checkpoint bytes in `data.tar.gz` and images in `figures.tar.gz`.

After inspecting a diagnostic run, remove its generated `results/` directory. For example, from the repository root:

```sh
rm -rf artifacts/agent-cli-smoke/results
```

These disposable smoke outputs are not publication results.
