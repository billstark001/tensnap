# tensnap-go

Go bindings for the simulator side of the TenSnap protocol v0.3.

This module is intentionally small. It gives Go simulators four pieces:

- `protocol`: wire-level message types, constants, and a default JSON codec.
- `abm`: a small model interface, `Base`, `TickCounter`, declarative `Scenario`, `ActionRouter`, `ParamMetadata`, and the `Emitter`/`Sink` abstraction.
- `binding`: optional declarative builders that translate Go model state into `abm`/`protocol` registrations and runtime diffs.
- `server`: a WebSocket server that binds a model to a TenSnap renderer session.

It does not include a renderer, a browser-side Scenario runtime, or persistence.

## Importing the Module

```bash
go get github.com/billstark001/tensnap/packages/tensnap-go@latest
```

For local development against this monorepo, use a `replace` directive in your own `go.mod`:

```go
replace github.com/billstark001/tensnap/packages/tensnap-go => ../tensnap/packages/tensnap-go
```

This repository uses a nested Go module. To publish a version that `go get` can resolve as a tagged release, the Git tag must use the submodule prefix:

```bash
git tag packages/tensnap-go/v0.3.0
```

## Minimal Usage

The lowest-level API is imperative: implement `abm.Model`, emit protocol updates yourself, and optionally let `abm.Base` replay an `abm.Scenario`.

```go
type MyModel struct {
    abm.Base
    abm.TickCounter
}

func (m *MyModel) Step(e abm.Emitter) error {
    tick := float64(m.NextTick())
    return e.MetadataUpdate(&protocol.MetadataUpdatePayload{Time: &tick})
}

func main() {
    model := &MyModel{}
    _ = model.SetScenario(
        abm.NewScenario().
            WithParams(&abm.ParamMetadata{
                Definition: protocol.NumberParameter{
                    ID:    "speed",
                    Type:  "number",
                    Label: "Speed",
                    Value: 1,
                    Min:   0,
                    Max:   5,
                    Step:  0.1,
                },
                Normalize: func(value any) (any, error) {
                    f, ok := abm.AsFloat64(value)
                    if !ok {
                        return nil, fmt.Errorf("expected numeric speed")
                    }
                    return abm.ClampFloat(f, 0, 5), nil
                },
            }).
            WithActions(&protocol.Action{ID: protocol.ActionIDStep, Label: "Step"}),
    )

    ctx := context.Background()
    _ = server.RunFactory(ctx, server.Options{Addr: ":8765"}, func() abm.Model {
        return model
    })
}
```

`Base.Setup` and `Base.OnStateSync` replay the registered `Scenario` automatically. If you need custom reset or start behavior, install an `ActionRouter`; if you need runtime state replay, attach `Scenario.WithStateReplay(...)`.

## Declarative Binding

The `binding` package is a higher-level translation layer. It depends on `abm`, but `abm` does not depend on it. You can use it for an entire model or only for selected pieces, such as declarative layers with imperative actions.

```go
model := binding.NewModel(
    raw,
    binding.WithInit(func(m *MyModel) error {
        m.Initialize()
        return nil
    }),
    binding.WithStep(func(m *MyModel) (bool, error) {
        return m.Step() > 0, nil
    }),
    binding.WithParams(
        binding.NumberParam("speed", "Speed",
            func(m *MyModel) float64 { return m.Speed },
            func(m *MyModel, value float64) error {
                m.Speed = value
                return nil
            },
        ).Range(0, 5).Step(0.1).Runtime(true).Build(),
    ),
    binding.WithEnvs(binding.NewEnv("main",
        binding.NewAgentLayer[*MyModel, Agent]("agents").
            Items(func(m *MyModel) []Agent { return m.Agents }).
            Project(func(_ *MyModel, a Agent) map[string]any {
                return map[string]any{"id": a.ID, "x": a.X, "y": a.Y}
            }),
    )),
)
```

`binding.NewModel` supplies continuous `start` plus one-shot `step` and `reset`
actions, handles setup/state-sync replay, computes item diffs, updates charts,
and emits metadata time. Reset preserves stable definitions, clears chart
history, and deletes the old agent snapshot before creating the reset state. If
you need more control, use the smaller registries directly; for example, keep
your own `OnAction` method and call `bound.PushEnvDiffs(e)` after an imperative
step. The reserved `init` lifecycle invocation stays dispatchable but is not
declared as a renderer action, so it does not create a button.

Boundary rule: `binding` translates declarative Go configuration into `abm` and `protocol` objects. It should not redefine wire payloads, and `abm` should remain usable without importing `binding`.

### Tag-Based Binding

`binding` can also compile projectors from scoped struct tags. Untagged fields are ignored by default; there is no name-based auto-binding fallback.

```go
type Config struct {
    Width   int     `tensnap:"id=width,scope=param,label=Width,min=10,max=200,step=1; width,scope=space"`
    Height  int     `tensnap:"id=height,scope=param,label=Height,min=10,max=200,step=1; height,scope=space"`
    Density float64 `tensnap:"id=density,scope=param,label=Density,min=0.1,max=0.95,step=0.05"`
}

type Agent struct {
    ID string  `tensnap:"id"`
    X  float64 `tensnap:"x"`
    Y  float64 `tensnap:"y"`
}

binding.WithParams(binding.MustParamsFromTags(
    func(m *MyModel) *Config { return &m.Config },
    binding.TagScope("param"),
)...)

binding.NewAgentLayer[*MyModel, Agent]("agents").
    Items(func(m *MyModel) []Agent { return m.Agents }).
    ProjectTagsRequired("id", "x", "y")
```

Tags accept `scope=...` as a normal keyword. If omitted, the compiler's default scope is used: params default to `param`, and agent item projectors default to `agent`. A single field can provide multiple scoped entries by separating them with `;`.

For a fuller example, see [../../examples/go/internal/schelling/model.go](../../examples/go/internal/schelling/model.go) and the [Go API reference](../../docs/api-reference/go-api.md).

For detached or headless runs, keep the same model and swap in `abm.NewSink()`:

```go
model := &MyModel{}
emitter := abm.NewSink()
_ = model.Setup(emitter)
_ = model.Step(emitter)
```

## Protocol Coverage

The server currently decodes these renderer-to-simulator messages:

- `state_sync` -> `Model.OnStateSync`
- `param_change` -> `Model.OnParamChange`
- `action_invoke` -> `Model.OnAction`
- `asset_sync` -> optional `abm.AssetSyncHandler`
- `screenshot_response` -> optional `abm.ScreenshotResponseHandler`
- `scene_restore` / `scene_capture` -> optional restore and checkpoint handlers
- `error` -> converted into `log(level=error)` on the emitter

The `Emitter` exposes the simulator-to-renderer families used by protocol v0.3, including:

- `metadata_update`
- `state_sync_begin` and `state_sync_end`
- `action_*`
- `env_*`
- `item_*`
- `param_*`
- `chart_*`
- `monitor_*`
- `scene_restore_*` and `scene_capture_result`
- `asset_*`
- `screenshot_request`
- `log` and `error`

## Important Behavior Notes

- `abm.Base.Setup` and `abm.Base.OnStateSync` replay the registered `Scenario`. Models that need extra reset logic can still override either method and call back into `Base` helpers.
- Create-only `Base.OnStateSync` uses `replace` mode; it never relies on create-as-upsert behavior.
- `ParamMetadata.Normalize` is the default place to clamp or coerce renderer-provided values; `ParamMetadata.OnSet` is where you attach runtime side effects.
- `ActionRouter` is consulted before the built-in `init` / `step` fallback in `Base.OnAction`.
- `ItemDiffTracker` and `NaiveItemDiffTracker` cover the two incremental diff modes also exposed by the Python bindings.
- The bundled codec is JSON only. If you need MessagePack, implement `protocol.Codec` and pass it through `server.Options.Codec`.
- `server.Run` shares one model instance across connections. `server.RunFactory` is the safer default because it creates one model per renderer session.

Trajectory builders expose typed lifecycle methods for agent deletion,
state-sync, and reset. Checkpoint hooks exchange model data only; the binding
infers and owns the `{encoding,data}` wire envelope, replays a chart-free final
state on restore, caches request IDs, and rolls back when paired hooks are
available. The first frame is always `simulator_info`; configure stable model
identity and schema compatibility with `WithSimulatorInfo`.

## Runnable Examples

The repository keeps runnable examples in [examples/go](../../examples/go):

```bash
cd examples/go
make run-schelling
make run-standalone
```

`run-schelling` starts a WebSocket simulator on `:8765`.

`run-standalone` runs the Schelling model headlessly as a heavy threshold-sweep
scientific task and prints CSV metrics comparable with the Python, NetLogo, and
Julia standalone examples. The final performance row reports `total_ticks`,
`elapsed_ms`, `tpms`, and `mspt`; timing wraps each trial's step loop only, so
there is no per-tick timing work in the model hot path.

## Validation

Library validation:

```bash
cd packages/tensnap-go
go test ./...
```

Example validation:

```bash
cd examples/go
make check
```
