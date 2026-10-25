# Historical execution

The last implementation containing the older protocol and historical collection/replay entry points is commit **`15ea092056534c33cd5843473f09d1e3e979dd32`** (`chore(examples): checkpoint historical LLM models and replay tools`). It snapshots the modified working tree based on `a3c777b3d531751c17d52ab7ee5922cdc288aa14`. The maintained working tree carries only the current model and checkpoint schema; it does not contain a second archived implementation.

Restore the historical commit in a separate worktree when needed:

```bash
git worktree add --detach /path/to/tensnap-history 15ea092056534c33cd5843473f09d1e3e979dd32
cd /path/to/tensnap-history
```

Follow `examples/python_llm/historical_replay/README.md` in that checkout. It documents the five original trajectories, offline servers, native recording commands and later factorial/repair verifiers. The original trajectories recorded base commit `ee261d0b`; all 19 recorded Python source hashes match `a3c777b3d531751c17d52ab7ee5922cdc288aa14`. The historical replay entry point verifies and imports those exact committed sources into a temporary directory.

The later factorial studies were collected from uncommitted changes, so their recorded base HEAD alone does not identify their code. The snapshot commit preserves the implementation and utilities; each retained experiment's `plan.json` source hashes and `source/` directory identify its exact collection version. This includes versions before and after full-note retention. Decision tapes, checkpoints and recordings remain in their original artifact directories and are not part of the source commit. Retain those data when transferring a historical execution to another machine, and update the documented input paths.

Current checkpoints use version 2. Execute old checkpoints and tapes using the historical checkout; view already saved recordings directly in TenSnap. Historical verification uses saved responses and does not require credentials or a live provider.

The current dynamics regression fixture is derived from this historical source commit. It normalizes the checkpoint schema/config shape and rounds only Naming Game display coordinates to 12 decimal places, because macOS and Linux libm can return different final bits for the same circle layout. Scientific state, metrics, and both RNG states remain exact in the digest. This test normalization does not modify model coordinates, checkpoint formats, or retained experiment artifacts.
