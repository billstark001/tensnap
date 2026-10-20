# Randomness, initialization and reproducibility

TenSnap connects models to controls, projections and recordings. Random-number generators belong to the model or its modeling framework. A seed is an ordinary initialization parameter. The protocol has no reserved seed field, RNG implementation, global seeding operation or automatic RNG discovery.

Supplying a seed is optional, according to the model's constructor and defaults. For example, `RandomWalkConfig()` and `SchellingModel()` use the teaching examples' default of 7; pass `seed=42` when you want to select another repeatable experiment. Omitting the argument in these examples does not draw a fresh seed. A model may instead support `seed=None` for nondeterministic initialization, but that is a model-level choice rather than a TenSnap requirement.

## Ownership and lifecycle

- Use an instance generator in ordinary models, Mesa's `model.random` / `model.rng`, or Agents.jl's `abmrng(model)`. Pass that generator to libraries such as NetworkX. Each live model owns its streams.
- Bind the seed like any other initialization setting. Editing it stages the next initialization; it must not reseed the current trajectory. Fixed-seed reset reconstructs the same initial state under the same configuration and implementation. A new random experiment is an explicit action or a new seed followed by reset.
- Models supporting an unspecified seed should either expose the resolved effective seed or retain an initial checkpoint. Recording an unresolved `None` does not identify the initial random state. The runnable stochastic examples default to seed 7 where their interfaces expose a seed.
- Projection, inspection, chart reads, sync and connection management must not draw from a scientific RNG. Rendering/layout randomness uses separate state. Adding a viewer must not change an experiment.
- A model may own several justified streams, for example environmental transitions and policy exploration. Seed derivation and stream names belong to that model's documented experiment design.

Python's `await scenario.register_model(model, ...)` assembles declarations and constructor-driven lifecycle in one operation. `BoundModelReinitializer` supplies construction choices and cleanup, with no scenario ownership. It discovers constructor-only parameters as initialization settings (`allow_runtime_change=False` by default); explicit metadata may override this. Existing model-owned runtime parameters retain their own declarations. Construction arguments captured by `@bind_kwargs` belong to each instance; keeping choices as model attributes also lets model checkpoint callbacks restore them. Retain excluded, non-UI options through `BoundModelReinitializer(model, init_kwargs={...})`. Checkpoints contain only model-declared data. Save staged UI parameters with the scene snapshot and restore them using the existing `parameters` overlay when the application supports projected restore. If checkpoint-only recovery must retain pending initialization choices, the model must save those choices itself, independently of its active RNG state. Python refreshes constructor controls from restored model attributes before applying any explicit parameter overlay. Other bindings use their normal parameter metadata (`runtime: false`, `runtime=false`, or `allow_runtime_change=false`). No parameter name receives special treatment.

Python model adapters may await `scenario.reset()` for the complete reset lifecycle, and call `scenario.set_time_step(tick)` from lifecycle/checkpoint callbacks to synchronize the protocol clock. The latter publishes nothing itself and never advances a model or scheduler. Framework models still advance through their native stepping API; an Agents.jl callback registered as `model_step!` is invoked through `Agents.step!`.

## Checkpoint continuation and recorded playback

Reinitializing with a seed starts a new trajectory. Continuing from tick K requires the current RNG states together with all state needed for future transitions: population, scheduler/event queue, counters, histories used by decisions and configuration. Use the existing paired checkpoint capture/restore hooks. Checkpoint contents are model-owned; bindings own their wire encoding and atomic restoration.

Validate a detached candidate before installing state. Restoring one model must leave other models and process-global generators unchanged. Preserve external resources such as an LLM provider and its paid usage; restore only the explicitly owned logical cursors and model fields.

Chart and collector history can be observational output rather than scientific state. Declare the choice. The Mesa Schelling checkpoint restores scientific state and both RNGs, then begins a new DataCollector segment; it never assigns private collector fields. Flock retains its velocities and local RNG. Julia serialization checkpoints require matching model/package/runtime versions. Go Schelling retains the standard-library RNG seed and draw count, so restoring costs O(prior source draws).

A renderer recording can be played without running the model. Matching recorded frames does not by itself prove exact model continuation. DQN policy files retain weights, optimizer state and training counters; they are warm starts, not complete training checkpoints containing replay memory and RNG state.

Same seed does not promise the same trajectory across languages, RNG algorithms, library versions, iteration orders or parallel schedules. Cross-implementation comparison must define its own equivalence criteria. Retain source revision and environment versions with scientific evidence.

## Reproducibility checks

Each stochastic example should exercise the applicable checks:

1. Two fresh models with the same configuration and seed have the same initial state and trajectory.
2. Interleaving another instance, including one with a different seed, does not affect either trajectory.
3. Additional projections, syncs and metric reads change neither scientific state nor RNG positions.
4. Reset repeats the initial state, including non-default construction settings. Staging a different seed changes only the next initialization.
5. Capture, advance N steps, restore and advance N steps repeats the future when checkpoint support is advertised. Invalid checkpoint data leaves the current model intact.
6. Framework time, protocol time and the model's documented tick agree after step, reset and restore. Python registration accepts a `model_time` callback for this synchronization; step-count clocks must return a nonnegative integer.
7. Change a staged seed, capture, overwrite that setting, restore, then reset. The current RNG trajectory must remain unchanged until reset, while the restored seed must control the new initialization. Audit must record both the next-reset seed and the active RNG state. Compare every continuation point's audited active state, excluding only the pending seed; observe the overwritten seed from the live model before restoring rather than relying on a client-side parameter list. The four-language driver enforces these checks at runtime and retains raw observations only in temporary diagnostic traces; publication reports and offline verification keep their existing contract.

Run Python checks with the package development environment, including `packages/tensnap-python/tests/test_example_reproducibility.py`. The JS workspace tests real sessions. Go has native model and adapter tests. `pnpm --dir examples/julia run test` checks examples and the binding package. Full host/CLI continuation is covered by the repository's [headless workflow](https://github.com/billstark001/tensnap/blob/main/benchmarks/schelling/headless/README.md), which requires a source checkout; use a fresh output directory for diagnostics.

## Examples and measurement adapters

Examples own scientific transitions, state, native-framework use, bindings and reusable scientific studies. Benchmark subjects own warmup, timers, performance CSV/JSON, publication environment parsing, independent audit sidecars and validation probes. Adapters import examples; ordinary examples never read the publication audit environment variable or write audit files.

Historical reports, checkpoints, tables, traces and images remain evidence for their recorded source revisions. New code does not reinterpret or regenerate those artifacts. Current Schelling study CSV distinguishes `satisfied_runs`, `jammed_runs` and `limit_runs`; historical `converged_runs` used a no-movement criterion and must be read with its original implementation. Current Schelling host checkpoint schema is 3. Older checkpoints require the matching historical source.
