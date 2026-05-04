# Go API Reference

This reference describes the current TenSnap Go surface for protocol v0.2.

The recommended workflow is:

1. Describe the stable renderer-visible surface with `abm.Scenario`.
2. Attach parameter coercion with `abm.ParamMetadata`.
3. Attach custom action behavior with `abm.ActionRouter`.
4. Let `abm.Base` replay the scenario during `Setup` and `state_sync`.

## Quick Start

```go
package main

import (
    "context"
    "fmt"

    "github.com/billstark001/tensnap/packages/tensnap-go/abm"
    "github.com/billstark001/tensnap/packages/tensnap-go/protocol"
    "github.com/billstark001/tensnap/packages/tensnap-go/server"
)

type CounterModel struct {
    abm.Base
    abm.TickCounter
    value float64
}

func NewCounterModel() *CounterModel {
    model := &CounterModel{}

    _ = model.SetScenario(
        abm.NewScenario().
            WithParams(&abm.ParamMetadata{
                Definition: protocol.NumberParameter{
                    ID:    "stepSize",
                    Type:  "number",
                    Label: "Step Size",
                    Value: 1,
                    Min:   0,
                    Max:   10,
                    Step:  0.5,
                },
                Normalize: func(value any) (any, error) {
                    f, ok := abm.AsFloat64(value)
                    if !ok {
                        return nil, fmt.Errorf("expected numeric stepSize")
                    }
                    return abm.ClampFloat(f, 0, 10), nil
                },
            }).
            WithActions(
                &protocol.Action{ID: "start", Label: "Start", Continuous: abm.BoolPtr(true)},
                &protocol.Action{ID: protocol.ActionIDStep, Label: "Step"},
            ),
    )

    model.SetActionRouter(
        abm.NewActionRouter().Handle("start", func(e abm.Emitter, tickID *string, _ bool) error {
            return model.step(e, "start", tickID)
        }),
    )

    return model
}

func (m *CounterModel) Step(e abm.Emitter) error {
    return m.step(e, protocol.ActionIDStep, nil)
}

func (m *CounterModel) step(e abm.Emitter, actionID string, tickID *string) error {
    m.value += m.ParamFloat("stepSize")
    tick := float64(m.NextTick())
    if err := e.MetadataUpdate(&protocol.MetadataUpdatePayload{Time: &tick}); err != nil {
        return err
    }
    return e.ActionEnd(&protocol.ActionEndPayload{ID: actionID, TickID: tickID, Continue: abm.BoolPtr(true)})
}

func main() {
    ctx := context.Background()
    _ = server.RunFactory(ctx, server.Options{Addr: ":8765"}, func() abm.Model {
        return NewCounterModel()
    })
}
```

## Packages

### `protocol`

Wire-level message types, constants, and codecs.

Important types:

- `protocol.Message`
- `protocol.NumberParameter`, `protocol.EnumParameter`, `protocol.BooleanParameter`, `protocol.StringParameter`
- `protocol.Action`
- `protocol.EnvLayerCreatePayload`
- `protocol.ChartGroupMetadata`
- `protocol.ActionEndPayload`

### `abm`

The model-facing integration layer.

Important types:

- `Model`: the interface implemented by your simulator model.
- `Base`: default implementations for `Setup`, `OnAction`, `OnParamChange`, and `OnStateSync`.
- `Emitter`: the protocol emission interface used by your model.
- `Sink`: no-op `Emitter` for detached or headless execution.
- `TickCounter`: monotonic tick counter for renderer-visible time.

### `server`

WebSocket server that binds a Go model to a TenSnap renderer session.

- `server.Run`: reuse one shared model instance.
- `server.RunFactory`: create one model per renderer connection.

## `abm.Scenario`

`Scenario` is the declarative description of the stable renderer-visible surface.

```go
scenario := abm.NewScenario().
    WithParams(...).
    WithActions(...).
    WithEnvs(...).
    WithCharts(...).
    WithStateReplay(func(e abm.Emitter) error { ... })
```

Fields covered by replay:

- parameters via `param_create`
- actions via `action_create`
- environments and layers via `env_create` and `env_layer_create`
- charts via `chart_create`
- current runtime state via the optional `ReplayState` callback

Attach a scenario with `model.SetScenario(scenario)`.

Default behavior:

- `Base.Setup` replays the registered `Scenario`.
- `Base.OnStateSync` sends `state_sync_begin`, replays the registered `Scenario`, then sends `state_sync_end`.

If you need to do work before replay, override `Setup` or `OnStateSync`, then call `ReplayScenario` or `Base.OnStateSync`.

## `abm.ParamMetadata`

`ParamMetadata` describes one renderer-visible parameter and its runtime coercion.

```go
meta := &abm.ParamMetadata{
    Definition: protocol.NumberParameter{...},
    Aliases:    []string{"threshold"},
    Normalize: func(value any) (any, error) { ... },
    OnSet: func(value any) error { ... },
}
```

Rules:

- `Definition` must be one of the protocol parameter types.
- `Normalize` receives the raw `param_change` value and returns the stored value.
- `OnSet` runs after the normalized value is stored in `Base`.
- `Aliases` let one metadata entry accept legacy IDs while storing to one canonical parameter ID.

When a `Scenario` is registered, `Base.OnParamChange` uses its `ParamMetadata` entries before falling back to raw `SetParam`.

## `abm.ActionRouter`

`ActionRouter` is the lightweight action dispatch table.

```go
router := abm.NewActionRouter().
    Handle("start", func(e abm.Emitter, tickID *string, continuous bool) error {
        return model.step(e, "start", tickID)
    }).
    Handle("reset", func(e abm.Emitter, tickID *string, continuous bool) error {
        return model.reset(e, "reset", tickID)
    })

model.SetActionRouter(router)
```

`Base.OnAction` checks the router first. If no handler matches, it falls back to built-in handling for `protocol.ActionIDInit` and `protocol.ActionIDStep`.

## Incremental Item Diffing

The Go bindings provide two diff helpers that mirror the two Python-side incremental modes.

### `ItemDiffTracker[T]`

Use this when your model can cheaply answer:

- item identity
- whether an item changed this step

It only projects new or changed items.

### `NaiveItemDiffTracker`

Use this when your model already builds full item snapshots each step and you want field-level deltas without custom dirty tracking.

It projects every item each step, then emits:

- full creates for new items
- field-only updates for changed items
- deletes for removed items

Call `Seed(...)` after an initial `ItemCreate(...)` replay so the next `Compute(...)` call produces incremental output.

## Detached Execution

Use `abm.NewSink()` to run the same model without a live renderer:

```go
model := NewCounterModel()
emitter := abm.NewSink()
_ = model.Setup(emitter)
_ = model.Step(emitter)
```

## Behavior Notes

- The current frontend uses `start`, `step`, and `reset` as its reserved toolbar actions.
- `server.RunFactory` is usually the safer entry point because it isolates model state per renderer session.
- The bundled codec is JSON only. Use a custom `protocol.Codec` if you need a different wire format.
- A declarative `Scenario` only covers stable protocol surface plus replay callbacks. It is not the same object as the browser-side Scenario runtime in `packages/core`.

## References

- `packages/tensnap-go/README.md`
- `examples/go/internal/schelling/model.go`
- `examples/go/`
- `docs/maintainer-guide/protocol-v0.2.md`
