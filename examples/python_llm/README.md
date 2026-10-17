# Small rule / LLM models

Two independent examples use the same observation/action interface for scripted
and LLM decisions. Neither needs Mesa. They do not integrate with the evaluation
harness, and the examples do not claim to reproduce published findings.

| Example | World | One step | Offline baseline |
| --- | --- | --- | --- |
| [`naming_game`](naming_game/README.md) | Pairwise interaction graph | Two simultaneous name choices | Symmetric win-stay / lose-switch |
| [`mini_commons_harvest`](mini_commons_harvest/README.md) | Renewable-resource grid | One harvester activation | Greedy or leave-one-unit harvesting |

## Install and run

Run these commands **from the repository root** using Python 3.10 or newer:

```bash
python -m venv examples/python_llm/.venv
source examples/python_llm/.venv/bin/activate
python -m pip install -e packages/tensnap-python -r examples/python_llm/requirements.txt

python -m examples.python_llm.naming_game serve --policy rule --port 8765
# In a separate terminal, with the same environment:
python -m examples.python_llm.mini_commons_harvest serve --policy rule --port 8766
```

Connect the TenSnap GUI to the printed WebSocket URL. Both provide agent `data`,
a `selected_agent` index control, structured inspection monitors, charts, reset,
reseed, and model-owned checkpoint capture/restore. The `policy` and `seed` values
are informational; choose policy at launch and use **Reset with next seed** to
change the seed. Use one controlling GUI/CLI at a time.

`TENSNAP_USE_SOURCE=1` can select the checked-out binding instead of an installed
package, matching the other Python examples. Headless `run`/`batch` commands do
not import TenSnap and rule mode needs only the Python standard library.

## Bounded inference

The implementation uses `httpx` for one OpenAI-compatible Chat Completions call
per decision and `python-dotenv` for configuration. No agent orchestration or
workflow graph is needed. The model packages supply their own CLI options and
views to shared utilities; `common` never imports either model package.

Copy `.env.example` to an ignored local `.env`, or explicitly select another
dotenv file. Files are parsed as data, with interpolation disabled; they are
never sourced as shell scripts. Existing environment variables override file
entries. Key aliases, in priority order: `LLM_API_KEY`, `DEEPSEEK_API_KEY`,
`API_SECRET`, `OPENAI_API_KEY`.

```bash
python -m examples.python_llm.naming_game serve --policy llm \
  --env-file /path/to/private.env --max-calls 12 --max-tokens 128 \
  --record examples/python_llm/artifacts/naming-decisions.jsonl
```

- Default live request budget: **32**, shared across reset, restore and batch
  runs in the process. Failed requests count. There are **no automatic retries**
  and no silent rule fallback. Naming uses two requests per step; Commons one.
- `LLM_MAX_TOKENS` caps output per request. Prompts contain bounded local
  histories and have a 16,000-character limit. Usage is visible in the inference
  monitor and headless result. Token limits are not a currency-denominated budget.
- DeepSeek defaults: `https://api.deepseek.com`, `deepseek-flash`, thinking
  explicitly disabled. Set `LLM_BASE_URL` and `LLM_MODEL` for another compatible
  provider. Optional `LLM_EXTRA_BODY` accepts only `thinking` and
  `reasoning_effort`; ordinary request fields cannot be overridden by it.
- Invalid JSON, truncated output, illegal actions, timeouts and HTTP errors
  stop the operation. A rejected step leaves model state and clock unchanged;
  any already paid requests remain charged and counted.
- A recording contains model observations, JSON decisions, model name and token
  counts. It excludes credentials, headers, raw provider error bodies and
  reasoning content. New recording files are created exclusively with local-only
  permissions; avoid publishing other private observations in future adaptations.

Provider reference: [DeepSeek first API call](https://api-docs.deepseek.com/zh-cn/)
and [thinking configuration](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/).

## Offline replay and repeated runs

Replaying requires neither credentials nor network access. Use the same model,
seed, configuration and sequence of operations as the recording:

```bash
python -m examples.python_llm.naming_game run --policy llm \
  --env-file /path/to/private.env --agents 8 --steps 4 --max-calls 8 \
  --record examples/python_llm/artifacts/decisions.jsonl \
  --output examples/python_llm/artifacts/live.json

python -m examples.python_llm.naming_game run --policy replay \
  --agents 8 --steps 4 --replay examples/python_llm/artifacts/decisions.jsonl \
  --output examples/python_llm/artifacts/replayed.json

python -m examples.python_llm.naming_game batch --policy rule \
  --seeds 1,2,3,4,5 --steps 1000 \
  --output examples/python_llm/artifacts/naming-seeds.json

python -m examples.python_llm.mini_commons_harvest batch --policy rule \
  --rule conserve --seeds 1,2,3 --steps 1200 \
  --output examples/python_llm/artifacts/commons-seeds.json
```

Results contain configuration, time series, elapsed model execution time, final
metrics and a final checkpoint. These are example batch outputs, not a benchmark
or an evaluation-harness result. Independent seeds start fresh models; checkpoint
continuations answer a different question. To continue a single headless result:

```bash
python -m examples.python_llm.naming_game run --steps 20 \
  --checkpoint-in examples/python_llm/artifacts/naming-single-run.json
```

## Agent CLI workflow

Install workspace dependencies with `pnpm install`, then build the CLI once:

```bash
pnpm --filter @tensnap/agent build
node packages/tensnap-agent/dist/cli.js runtime up --context llm-demo \
  --simulator-url ws://127.0.0.1:8765 \
  --client-message-validation error --server-message-validation error
node packages/tensnap-agent/dist/cli.js scene inspect --context llm-demo
node packages/tensnap-agent/dist/cli.js param set selected_agent 3 --context llm-demo
node packages/tensnap-agent/dist/cli.js action run step --context llm-demo
node packages/tensnap-agent/dist/cli.js run start start --context llm-demo \
  --max-steps 4 --max-wall-time-ms 60000 --record
node packages/tensnap-agent/dist/cli.js run status --context llm-demo
node packages/tensnap-agent/dist/cli.js scene capture --context llm-demo \
  --output examples/python_llm/artifacts/checkpoint.json
node packages/tensnap-agent/dist/cli.js scene render saved-frame --context llm-demo \
  --output examples/python_llm/artifacts/frame.png
node packages/tensnap-agent/dist/cli.js action run step --context llm-demo
node packages/tensnap-agent/dist/cli.js scene restore --context llm-demo \
  --checkpoint examples/python_llm/artifacts/checkpoint.json
node packages/tensnap-agent/dist/cli.js action run step --context llm-demo
node packages/tensnap-agent/dist/cli.js runtime down --context llm-demo
```

`run start` is asynchronous; inspect `run status` and wait for completion before
capturing or restoring. Create the output folder before capture/render. Stop the
Python server separately with Ctrl-C. CLI captures use the protocol's checkpoint
encoding and are restored with `scene restore`; headless JSON checkpoints use
`--checkpoint-in`.

`action run` reports dispatch acceptance, not the eventual simulator result.
Inspect the run's stop reason and scene time when checking failure cases.
Currently `completedSteps` counts action results, including failed actions, and
a one-step limit can take precedence over the error stop reason. A bounded run
with a limit greater than one makes budget failures observable as `action-error`;
the model time and checkpoint remain unchanged.

A checkpoint saves agents, memories, resources/edges, configuration, both random
generators, model time, selection, and the decision cursor. Restoring does not
rewind paid usage. Already observed LLM responses are cached by logical decision
index and exact input fingerprint: a matching rerun reuses them, while altered
inputs create a new branch and may incur requests. For portable LLM replay keep
the complete decision tape as well as the checkpoint. A checkpoint alone cannot
make future remote generations deterministic. Charts retain renderer-managed
history; model checkpoints do not reconstruct chart histories.

## Tests

```bash
python -m pip install -e 'packages/tensnap-python[dev]'
python -m pytest examples/python_llm/tests -q -o addopts=''
```

Tests use an in-memory HTTP transport, never a paid API. They cover seeded
continuation, replay, immutable projections, local observations, resource
conservation, invalid operations, budget accounting and TenSnap clocks/monitors.
