# NetLogo DQN Evacuation Comparison

`evac_dqn_netlogo.nlogox` is a NetLogo 7 counterpart to
`examples/python_dqn/evac_viz.py` and `examples/python_dqn/evac_viz_solara.py`.

NetLogo owns the visible simulation: patches, turtles, buttons, sliders,
monitors, and plots. The guide action can come from the Python DQN policy
through NetLogo's bundled `py` extension, or from the Python training adapter
via the `training-action` global.

## Run

```bash
pnpm dev:netlogo:evac-dqn
```

Or open the model directly in NetLogo 7.0.4:

```bash
open -a "/Applications/NetLogo 7.0.4/NetLogo 7.0.4.app" examples/python_dqn/netlogo/evac_dqn_netlogo.nlogox
```

Click `setup`, then `go`.

## Python Policy Bridge

The model follows the standard NetLogo Python-extension flow:

1. `py:setup` initializes one Python session.
2. The model imports `python_dqn.netlogo_policy`.
3. Each tick sends a 16-value state vector with `py:set`.
4. `py:runresult` returns the DQN action.

Inputs:

- `repo-root`: repository root. The default `auto` searches the current working
  directory and its parents; set an absolute path if import fails.
- `python-executable`: leave empty to use NetLogo's default Python, or set it to
  a Python with `mesa` and `torch` installed.
- `guide-model`: `untrained` or a checkpoint file name from
  `examples/python_dqn/checkpoints`.
- `checkpoint-dir`: optional override for the checkpoint directory.
- `use-python-policy?`: keep this on for the GUI comparison. The bundled
  BehaviorSpace `smoke` experiment turns it off because NetLogo's `py:setup`
  can stop silently in headless BehaviorSpace on this machine.

Changing `guide-model` does not reload immediately. Press `reset-guide-model` or
`setup` to apply it.

## Python Training Adapter

The DQN CLI can use NetLogo as the transition source:

```bash
cd examples
python -m python_dqn.main --mode train --env netlogo --episodes 300
```

The adapter uses pyNetLogo to load this model, turns `use-python-policy?` off,
sets `training-action` before every `go`, and reads `dqn-state-values`,
`last-reward`, `done?`, and count monitors after the step.

## Headless Smoke

```bash
"/Applications/NetLogo 7.0.4/netlogo-headless.sh" \
  --model examples/python_dqn/netlogo/evac_dqn_netlogo.nlogox \
  --experiment smoke \
  --table - \
  --threads 1
```

This verifies the NetLogo map, agents, fire spread, monitors, and plots. The
Python DQN bridge is smoke-tested separately through `python_dqn.netlogo_policy`.
