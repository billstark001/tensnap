// Package abm provides the ABM integration layer for TenSnap protocol v0.3.
//
// # Zero-overhead detached operation
//
// All protocol emission goes through the Emitter interface.
// When no server is attached, use NewSink() — a no-op implementation that
// compiles to inlined nil-checks with zero allocations and no goroutines.
// Your model code is identical in both modes.
//
// # Minimum binding template (4 lines in main.go)
//
//	model := &MyModel{e: abm.NewSink()}           // default: no-op
//	server.Run(ctx, server.Options{Addr:":8765"},  // pass model; server
//	    server.ModelFactory(func() abm.Model {     // injects live emitter
//	        return &MyModel{e: abm.NewSink()}      // per session
//	    }))
package abm

import "github.com/billstark001/tensnap/packages/tensnap-go/protocol"

// Emitter is the single interface your model uses to communicate with
// the renderer. Sink makes every call a no-op; SessionEmitter forwards
// to the WebSocket session.
type Emitter interface {
	SimulatorInfo(p *protocol.SimulatorInfoPayload) error
	MetadataUpdate(p *protocol.MetadataUpdatePayload) error
	StateSyncBegin(p *protocol.StateSyncBeginPayload) error
	StateSyncEnd(p *protocol.StateSyncEndPayload) error
	ActionResult(p *protocol.ActionResultPayload) error

	EnvCreate(id, envType string) error
	EnvDelete(id string) error
	EnvLayerCreate(p *protocol.EnvLayerCreatePayload) error
	EnvLayerUpdate(p *protocol.EnvLayerUpdatePayload) error
	EnvLayerDelete(envID, layerID string) error

	ItemCreate(envID, layerID string, items []map[string]any) error
	ItemUpdate(envID, layerID string, items []map[string]any) error
	ItemDelete(envID, layerID string, items []any) error

	ParamCreate(p any) error
	ParamUpdate(p any) error
	ParamDelete(id string) error
	ParamSync(id string, value any) error

	ActionCreate(a *protocol.Action) error
	ActionUpdate(a *protocol.Action) error
	ActionDelete(id string) error

	ChartCreate(meta *protocol.ChartGroupMetadata) error
	ChartUpdate(p *protocol.ChartUpdatePayload) error
	ChartDelete(kind, id string) error
	MonitorCreate(p *protocol.MonitorMetadata) error
	MonitorUpdate(p *protocol.MonitorUpdatePayload) error
	MonitorDelete(id string) error
	SceneRestoreBegin(p *protocol.SceneRestoreBeginPayload) error
	SceneRestoreEnd(p *protocol.SceneRestoreEndPayload) error
	SceneCaptureResult(p *protocol.SceneCaptureResultPayload) error

	AssetMeta(assets []protocol.AssetDescriptor) error
	AssetData(p *protocol.AssetDataPayload) error
	AssetDelete(ids []string) error

	ScreenshotRequest(p *protocol.ScreenshotRequestPayload) error

	Log(p *protocol.LogPayload) error
	Error(p *protocol.ErrorPayload) error
}

// Sink is the no-op Emitter for standalone / detached operation.
// Every method returns nil immediately with no allocations.
type Sink struct{}

func NewSink() Emitter { return Sink{} }

func (Sink) SimulatorInfo(_ *protocol.SimulatorInfoPayload) error         { return nil }
func (Sink) MetadataUpdate(_ *protocol.MetadataUpdatePayload) error       { return nil }
func (Sink) StateSyncBegin(_ *protocol.StateSyncBeginPayload) error       { return nil }
func (Sink) StateSyncEnd(_ *protocol.StateSyncEndPayload) error           { return nil }
func (Sink) ActionResult(_ *protocol.ActionResultPayload) error           { return nil }
func (Sink) EnvCreate(_, _ string) error                                  { return nil }
func (Sink) EnvDelete(_ string) error                                     { return nil }
func (Sink) EnvLayerCreate(_ *protocol.EnvLayerCreatePayload) error       { return nil }
func (Sink) EnvLayerUpdate(_ *protocol.EnvLayerUpdatePayload) error       { return nil }
func (Sink) EnvLayerDelete(_, _ string) error                             { return nil }
func (Sink) ItemCreate(_, _ string, _ []map[string]any) error             { return nil }
func (Sink) ItemUpdate(_, _ string, _ []map[string]any) error             { return nil }
func (Sink) ItemDelete(_, _ string, _ []any) error                        { return nil }
func (Sink) ParamCreate(_ any) error                                      { return nil }
func (Sink) ParamUpdate(_ any) error                                      { return nil }
func (Sink) ParamDelete(_ string) error                                   { return nil }
func (Sink) ParamSync(_ string, _ any) error                              { return nil }
func (Sink) ActionCreate(_ *protocol.Action) error                        { return nil }
func (Sink) ActionUpdate(_ *protocol.Action) error                        { return nil }
func (Sink) ActionDelete(_ string) error                                  { return nil }
func (Sink) ChartCreate(_ *protocol.ChartGroupMetadata) error             { return nil }
func (Sink) ChartUpdate(_ *protocol.ChartUpdatePayload) error             { return nil }
func (Sink) ChartDelete(_, _ string) error                                { return nil }
func (Sink) MonitorCreate(_ *protocol.MonitorMetadata) error              { return nil }
func (Sink) MonitorUpdate(_ *protocol.MonitorUpdatePayload) error         { return nil }
func (Sink) MonitorDelete(_ string) error                                 { return nil }
func (Sink) SceneRestoreBegin(_ *protocol.SceneRestoreBeginPayload) error { return nil }
func (Sink) SceneRestoreEnd(_ *protocol.SceneRestoreEndPayload) error     { return nil }
func (Sink) SceneCaptureResult(_ *protocol.SceneCaptureResultPayload) error {
	return nil
}
func (Sink) AssetMeta(_ []protocol.AssetDescriptor) error                 { return nil }
func (Sink) AssetData(_ *protocol.AssetDataPayload) error                 { return nil }
func (Sink) AssetDelete(_ []string) error                                 { return nil }
func (Sink) ScreenshotRequest(_ *protocol.ScreenshotRequestPayload) error { return nil }
func (Sink) Log(_ *protocol.LogPayload) error                             { return nil }
func (Sink) Error(_ *protocol.ErrorPayload) error                         { return nil }
