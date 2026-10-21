# Rule / LLM agent-based models

These examples explore how bounded local decisions produce population-level outcomes: coordination in a pairwise game, and resource use in a spatial commons. Each model owns its environment, observations, legal actions, transitions and measurements; a rule policy or LLM supplies decisions. TenSnap exposes the resulting state for inspection, recording and checkpoint restoration. Neither model needs Mesa.

| Example | Scientific question | One step | Rule baseline |
| --- | --- | --- | --- |
| [Naming Game](naming_game/README.md) | How does contact structure mediate a fixed minority's challenge to an established convention? | Two simultaneous name choices | Win-stay / lose-switch or partner-frequency |
| [Mini Commons Harvest](mini_commons_harvest/README.md) | Does local message delivery change resilience to a temporary drought? | One harvester activation | Greedy, leave-one-unit or message-aware harvesting |

These are exploratory models, separate from the evaluation harness. They do not reproduce published benchmarks. The model pages define their mechanisms, assumptions, observations and metrics.

The [paired factorial protocol](EXPERIMENTS.md) supplies reusable rule-only control experiments, sustained-convention criteria, message-delivery negative controls, common environmental random fields, extinction/recovery measurements and checkpoint verification. No paid inference is needed to run the controls.

The maintained models use one mechanism definition and checkpoint schema version 2. Older implementations and collection/replay entry points are retained in a Git snapshot; see [historical execution](HISTORY.md) for the commit and restoration commands.

## Choose a Python environment

Run commands **from the repository root**, with **Python 3.10 or newer**. Check the interpreter first; `python` and `python3` can resolve to different installations:

```bash
python -c 'import sys; print(sys.executable); print(sys.version); assert sys.version_info >= (3, 10)'
```

If necessary, replace `python` with your Python 3.10+ executable throughout the chosen route. Use the same interpreter for `-m pip` and model commands.

### Route A: create a new virtual environment

For an isolated installation, in a directory that does not already contain an environment you want to keep:

```bash
python -m venv examples/python_llm/.venv
source examples/python_llm/.venv/bin/activate
python -m pip install -e packages/tensnap-python -r examples/python_llm/requirements.txt
```

### Route B: use your current environment

Keep your active Conda, venv or other Python environment:

```bash
python -m pip install -e packages/tensnap-python -r examples/python_llm/requirements.txt
```

This updates dependencies in the selected environment. The editable install selects this checkout's binding; no new environment is created.

An existing environment can also contain an unrelated installed package named `examples`, which shadows this checkout's namespace. Check the model import:

```bash
python -c 'import examples.python_llm; print(examples.python_llm.__file__)'
```

If that import fails or points elsewhere, use the same current environment with the example directory on the import path:

```bash
PYTHONPATH=examples python -m python_llm.naming_game serve --policy rule --port 8765
PYTHONPATH=examples python -m python_llm.mini_commons_harvest serve --policy rule --port 8766
```

For subsequent model commands, likewise replace `python -m examples.python_llm.<model>` with `PYTHONPATH=examples python -m python_llm.<model>`. This uses the same model files and stable model IDs without uninstalling another package. It also works with `run`, `batch`, `replay` and live LLM options.

### Route C: reuse an existing example environment

If route A was completed previously, activate it in each new model terminal:

```bash
source examples/python_llm/.venv/bin/activate
```

Alternatively, use `examples/python_llm/.venv/bin/python` directly wherever these instructions use `python`.

After routes A–C, check the binding and server dependency:

```bash
python -c 'import tensnap, websockets; print(tensnap.__file__); print(websockets.__version__); from websockets.asyncio.server import serve'
```

The server requires `websockets>=13`. For development, prefix a `serve` command with `TENSNAP_USE_SOURCE=1` to select the checked-out binding explicitly. This does not install dependencies.

### Route D: headless rules without the TenSnap binding

Rule-mode `run` and `batch` do not need the binding or an inference client. Naming uses NetworkX for its contact network:

```bash
python -m pip install 'networkx>=3.4,<4'
python -m examples.python_llm.naming_game run --policy rule --steps 20
python -m examples.python_llm.mini_commons_harvest run --policy rule --steps 24
```

If an installed `examples` package interferes, the `PYTHONPATH=examples` route above applies here too. Commons alone can still run with only the standard library, including `python -S -m examples.python_llm.mini_commons_harvest run --policy rule ...`; Naming needs NetworkX available on its import path. Headless tape replay needs no provider client. Serving any policy requires the binding and its dependencies from routes A–C. Live LLM decisions additionally use `requirements.txt`.

## Start the model backend

After routes A–C, start a backend in its own terminal:

```bash
python -m examples.python_llm.naming_game serve --policy rule --port 8765
# Or, in another terminal with the selected Python environment:
python -m examples.python_llm.mini_commons_harvest serve --policy rule --port 8766
```

Keep the terminal running. The printed `ws://127.0.0.1:<port>` is the model's WebSocket endpoint; serving alone does not advance the model. Connect the TenSnap GUI to that URL, or use the agent CLI below. Stop the Python backend with Ctrl-C.

Both models provide agent data, a `selected_agent` index control, structured inspection monitors, charts, reset, reseed and model-owned checkpoints. Choose `policy` and initial `seed` at launch; those displayed parameters are informational. **Reset with next seed** changes the seed. Use one controlling GUI/CLI at a time.

## Connect the agent CLI: minimal path

The CLI requires Node.js 22+ and `@tensnap/agent`. Check an existing installation with `tensnap-agent --version`; the recording/frame workflow below targets **0.3.5**. If needed, install it with `npm install -g @tensnap/agent --allow-scripts=canvas`. A project-local installation can use `npx --no-install tensnap-agent`.

With the Naming backend still running, use a separate terminal:

```bash
tensnap-agent runtime up --context naming-demo --simulator-url ws://127.0.0.1:8765
tensnap-agent scene inspect --context naming-demo
tensnap-agent action run step --wait --context naming-demo
tensnap-agent runtime down --context naming-demo
```

For Commons use port 8766 and another context name. `runtime down` stops the CLI daemon; stop Python separately. The Python environment and Node installation are independent.

To use the source CLI, install workspace dependencies with `pnpm install`, then:

```bash
pnpm --filter @tensnap/agent build
node packages/tensnap-agent/dist/cli.js --version
```

Replace `tensnap-agent` in examples with `node packages/tensnap-agent/dist/cli.js`. If startup reports missing `canvas.node`, repair that CLI installation's native canvas dependency using the reported error/log; changing Python environments will not fix it.

## Bounded live inference

The shared client uses `httpx` for OpenAI-compatible Chat Completions and `python-dotenv` for configuration. Model packages supply their own CLI options and views; `common` never imports either model package.

Copy `examples/python_llm/.env.example` to an ignored local `.env` and pass its path with `--env-file`, or supply environment variables directly. Dotenv files are loaded only when explicitly selected, parsed as data with interpolation disabled, and never sourced as shell scripts. Existing environment variables override file entries. Key aliases, in priority order: `LLM_API_KEY`, `DEEPSEEK_API_KEY`, `API_SECRET`, `OPENAI_API_KEY`.

```bash
# Live mode: actions can make paid requests.
python -m examples.python_llm.naming_game serve --policy llm \
  --env-file /path/to/private.env --agents 8 --max-calls 12 --max-tokens 128 \
  --record examples/python_llm/artifacts/naming-decisions.jsonl
```

- The default live request cap is **32**, shared across reset, restore and batch runs in the process. Failed requests count. No automatic retry or rule fallback occurs. Naming uses two decisions per interaction; Commons uses one per activation.
- `LLM_MAX_TOKENS` caps output per request; prompts have bounded local histories and a 16,000-character limit. Inference monitors/results expose usage. Token limits are not currency budgets.
- The implementation defaults to `https://api.deepseek.com`, `deepseek-flash`, with thinking disabled. Set `LLM_BASE_URL` and `LLM_MODEL` for another compatible provider. `LLM_EXTRA_BODY` accepts only `thinking` and `reasoning_effort`.
- Invalid JSON, truncation, illegal actions, timeouts and HTTP errors stop the operation. A rejected step leaves model state and clock unchanged; paid requests remain counted.
- A decision tape stores observations, JSON decisions, model ID and reported usage. It excludes credentials, headers, raw provider error bodies and reasoning content. New tapes are created exclusively with local-only permissions.

Provider references: [API configuration](https://api-docs.deepseek.com/zh-cn/) and [thinking mode](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/).

## Decision-tape replay and repeated runs

`--record` on the **Python model** writes a JSONL decision tape. It differs from the **agent CLI** recording of projected state and protocol updates. Tape replay needs no credentials or provider access. Use the original model, seed, configuration, prompt and operation sequence:

```bash
python -m examples.python_llm.naming_game run --policy replay \
  --agents 8 --seed 7 --memory 5 --topology complete --steps 4 \
  --replay /path/to/naming-decisions.jsonl \
  --output examples/python_llm/artifacts/replayed.json

python -m examples.python_llm.naming_game batch --policy rule \
  --seeds 1,2,3,4,5 --steps 1000 \
  --output examples/python_llm/artifacts/naming-seeds.json

python -m examples.python_llm.mini_commons_harvest batch --policy rule \
  --rule conserve --seeds 1,2,3 --steps 1200 \
  --output examples/python_llm/artifacts/commons-seeds.json
```

To serve a tape, replace `run` with `serve`, omit `--steps`/`--output`, and connect to the printed URL. Replay fails on a missing or different input without live fallback. Historical prompt branches need their original prompt-switch schedule; the stock model CLI does not automatically load experiment manifests or modify prompts to fit a tape.

Headless results contain configuration, time series, execution time, final metrics and a checkpoint. Independent seeds start fresh models; continuations share a prefix and answer a different question. To continue a single rule-mode result:

```bash
python -m examples.python_llm.naming_game run --policy rule --steps 20 \
  --checkpoint-in examples/python_llm/artifacts/naming-single-run.json
```

For LLM continuations, use `--policy replay --replay <complete-tape>` and a matching provider-backed checkpoint. Replaying a trajectory adds no independent sample and does not test a changed condition.

## Standard recording, historical frames and restoration

Use a fresh rule-mode or replay-mode backend for this workflow. It needs no new LLM calls. Output paths must be new; frame evidence directories are never overwritten.

```bash
mkdir -p examples/python_llm/artifacts
tensnap-agent runtime up --context llm-demo \
  --simulator-url ws://127.0.0.1:8765 \
  --client-message-validation error --server-message-validation error
tensnap-agent scene inspect --context llm-demo
tensnap-agent run start start --max-actions 4 --max-wall-time-ms 60000 \
  --record --wait --until persisted --context llm-demo
tensnap-agent recording list --context llm-demo
```

Replace `RECORDING_ID` with the returned recording ID:

```bash
tensnap-agent recording export RECORDING_ID \
  --output examples/python_llm/artifacts/run.tensnap-recording.json --context llm-demo
tensnap-agent recording info examples/python_llm/artifacts/run.tensnap-recording.json
tensnap-agent recording seek examples/python_llm/artifacts/run.tensnap-recording.json \
  --time 2 --match last
tensnap-agent recording export-frame examples/python_llm/artifacts/run.tensnap-recording.json \
  --time 2 --match last --env main --output examples/python_llm/artifacts/history-t2

tensnap-agent frame save --checkpoint required --env main \
  --output examples/python_llm/artifacts/saved-t4 --context llm-demo
tensnap-agent action run step --wait --context llm-demo
tensnap-agent frame restore examples/python_llm/artifacts/saved-t4 \
  --mode checkpoint --history replace --context llm-demo
tensnap-agent action run step --wait --context llm-demo
tensnap-agent runtime down --context llm-demo
```

This assumes a fresh backend at tick 0 and a tape containing at least five steps. Offline recording commands work after the daemon and simulator stop, and take no context flags. Frame index, action count and model time differ; use the location returned by `seek`.

`action run` and `run start` return acceptance unless asked to wait. `--wait` covers settlement; `--until persisted` also waits for saved recording evidence. A wait timeout does not cancel the accepted operation: continue waiting with its request/run ID rather than dispatching again. Inspect `succeededActions`, `failedActions`, `primaryFailure` and `stateKnown`; `completedActions` includes failed results. Action failure takes precedence over the action quota in the primary failure report.

`frame save --checkpoint required` captures aligned model state and a fixed renderer frame. The checkpoint saves agents, memories, resources/edges, configuration, both RNG states, time, selection and decision cursor. `frame restore --mode checkpoint --history replace` also restores the saved chart prefix. The model checkpoint alone does not reconstruct renderer history. Headless JSON uses `--checkpoint-in`; protocol captures use `scene restore --checkpoint`; frame evidence uses `frame restore`.

### Complete history with restorable historical boundaries

Ordinary `--record` does not checkpoint every historical frame. For exact historical restoration, save this configuration as a new `collection.json`:

```json
{
  "version": 1,
  "mode": "full-history",
  "maxStoredBytes": 134217728,
  "liveHistory": { "chartPoints": 200, "logs": 200 },
  "window": { "before": 0, "after": 0 },
  "maxTriggers": 1,
  "checkpoints": {
    "policy": "required",
    "every": 1,
    "onTrigger": false,
    "maxCount": 200,
    "maxBytes": 16777216,
    "overflow": "fail"
  }
}
```

While a backend/runtime is connected and idle, use this instead of `--record`:

```bash
tensnap-agent run start start --max-actions 20 \
  --collection collection.json --store examples/python_llm/artifacts/run.store \
  --wait --until persisted --context llm-demo
```

Size budgets for the intended run. Check retained ranges, truncation, resource completeness and checkpoint availability. A historical frame without an associated checkpoint can be viewed but cannot restore the exact model. The [runtime guide](../../docs/user-guide/agent-runtime.md#incremental-collection-stores) covers event windows, checkpoint budgets and offline range export.

Restoration does not rewind paid usage or replay diagnostics. Cached answers are keyed by logical decision index and exact input fingerprint. Keep the complete tape for portable replay; a checkpoint alone cannot reproduce future remote generations. Changing prompts or observations can require a new decision branch. Replay mode fails on a missing entry with zero live requests.

Use `frame diff` to compare continuations, with an explicit policy if ignoring nonrewinding diagnostics such as `inference.replayed_calls`. Checkpoint and selected scene equality are separate results; `frame compare` retains strict behavior. These models support checkpoint restoration, not projected-scene restoration. See the [comparison contract](../../docs/user-guide/agent-runtime.md#bounded-queries-and-explicit-comparison).

## Tests

```bash
python -m pip install -e 'packages/tensnap-python[dev]'
python -m pytest examples/python_llm/tests -q -o addopts=''
```

Tests use an in-memory HTTP transport, never a paid API. They cover seeded continuation, replay, immutable projections, local observations, resource conservation, invalid operations, budgets and TenSnap clocks/monitors.

Lint this model and check formatting across all Python examples. The shared [examples configuration](../ruff.toml) targets Python 3.10:

```bash
python -m ruff check examples/python_llm
python -m ruff format --check examples
```
