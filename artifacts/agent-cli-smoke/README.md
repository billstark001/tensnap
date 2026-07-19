# Agent CLI smoke artifact

This artifact exercises the built `tensnap-agent` executable against the
repository's JavaScript Schelling model. It is intentionally small: the
retained evidence is one normalized JSON summary and one rendered scene. The
temporary daemon context, checkpoint payload, raw snapshots, and process logs
are deleted after verification.

The recorded run uses a 20x16 grid with seed 7 and bidirectional protocol
validation set to `error`. It verifies that the CLI can:

1. connect and inspect a simulator;
2. change a runtime parameter;
3. execute a bounded run stopped by `time >= 5`;
4. capture an exact, versioned model checkpoint;
5. advance once, restore the checkpoint, and recover the same canonical model
   state hash; and
6. render the scene offscreen as a 640x480 PNG.

## Reproduce

From the repository root, with workspace dependencies already installed:

```bash
node artifacts/agent-cli-smoke/run.mjs
```

The runner builds the agent CLI, launches the example simulator and a temporary
agent daemon, checks every assertion, replaces `results/summary.json` and
`results/scene.png`, and then tears down both processes. A successful run prints
the summary and exits with status 0.

The implementation under test is commit `8328a0a`, which includes the bounded
run/build fix (`8641349`) and the targeted-render isolation fix. The artifact
itself is committed separately so that its summary can identify the exact
implementation it exercised.
