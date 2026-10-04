# Protocol conformance

The [cross-binding matrix](MATRIX.md) reports protocol v0.3 results for Python/Mesa, Go, JavaScript/TypeScript, Julia, and the renderer client. Each invariant links to retained JSON evidence in [`evidence/`](evidence/). The deterministic hosts and their private state sidecars live in [`fixtures/`](fixtures/).

From the repository root, after installing the Python, Node, Go, and Julia dependencies:

```bash
python conformance/run_matrix.py --check
pnpm exec tsc --noEmit -p conformance/tsconfig.json
```

`--check` reruns every supported binding and encoding, drives the renderer through each live connection, validates the protocol traces and canaries, and checks the retained matrix and source digests. To refresh the evidence after a binding, protocol, or harness change:

```bash
python conformance/run_matrix.py --write
```

The [CI workflow](../.github/workflows/conformance-matrix.yml) runs `--check` on pull requests and `main`. The transport-neutral protocol trajectories live in [`traces/`](traces/) and are validated by [`validate_traces.ts`](validate_traces.ts).
