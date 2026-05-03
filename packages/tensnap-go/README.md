# tensnap-go

Go bindings for the simulator side of the TenSnap protocol v0.2.

This module is intentionally small. It gives Go simulators three pieces:

- `protocol`: wire-level message types, constants, and a default JSON codec.
- `abm`: a small model interface, `Base`, `TickCounter`, and the `Emitter`/`Sink` abstraction.
- `server`: a WebSocket server that binds a model to a TenSnap renderer session.

It does not include a renderer, a Scenario implementation, persistence, or automatic reconnect replay for your model state.

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
git tag packages/tensnap-go/v0.2.0
```

## Minimal Usage

```go
type MyModel struct {
    abm.Base
    abm.TickCounter
}

func (m *MyModel) Setup(e abm.Emitter) error {
    return e.ActionCreate(&protocol.Action{
        ID:         protocol.ActionIDStep,
        Label:      "Step",
        Continuous: abm.BoolPtr(true),
    })
}

func (m *MyModel) Step(e abm.Emitter) error {
    tick := float64(m.NextTick())
    if err := e.MetadataUpdate(&protocol.MetadataUpdatePayload{Time: &tick}); err != nil {
        return err
    }
    return e.ActionEnd(&protocol.ActionEndPayload{
        ID:       protocol.ActionIDStep,
        Continue: abm.BoolPtr(true),
    })
}

func main() {
    ctx := context.Background()
    _ = server.RunFactory(ctx, server.Options{Addr: ":8080"}, func() abm.Model {
        return &MyModel{}
    })
}
```

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
- `action_start` -> `Model.OnAction`
- `asset_sync` -> optional `abm.AssetSyncHandler`
- `screenshot_response` -> optional `abm.ScreenshotResponseHandler`
- `error` -> converted into `log(level=error)` on the emitter

The `Emitter` exposes the simulator-to-renderer families used by protocol v0.2, including:

- `metadata_update`
- `state_sync_begin` and `state_sync_end`
- `action_*`
- `env_*`
- `item_*`
- `param_*`
- `chart_*`
- `asset_*`
- `screenshot_request`
- `log` and `error`

## Important Behavior Notes

- `abm.Base.OnStateSync` only brackets the sync with `state_sync_begin` and `state_sync_end`. Real models should override it and replay current definitions and items if reconnects must restore state.
- The bundled codec is JSON only. If you need MessagePack, implement `protocol.Codec` and pass it through `server.Options.Codec`.
- `server.Run` shares one model instance across connections. `server.RunFactory` is the safer default because it creates one model per renderer session.

## Runnable Examples

The repository keeps runnable examples in [examples/go](../../examples/go):

```bash
cd examples/go
make run-schelling
make run-standalone
```

`run-schelling` starts a WebSocket simulator on `:8080`.

`run-standalone` runs the same model headlessly with `abm.NewSink()`.

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
