package abm

import (
	"fmt"
	"sync/atomic"

	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

// #region Model interface and Base implementation

// Model is the interface your ABM implements.
// Embed Base to get safe no-op defaults for all methods.
type Model interface {
	// Setup is called once per renderer connection (or standalone run).
	// Declare params, actions, environments, layers, charts here.
	Setup(e Emitter) error

	// Step advances the model one tick and emits diffs via e.
	Step(e Emitter) error

	// OnAction is called for every action_start.
	// Base routes ActionIDInit → Setup, ActionIDStep → Step.
	OnAction(e Emitter, actionID string, tickID *string, continuous bool) error

	// OnParamChange is called when the renderer edits a parameter.
	// Base caches the value via SetParam.
	OnParamChange(e Emitter, id string, value any) error

	// OnStateSync is called on renderer connect/reconnect.
	// Base sends state_sync_begin + state_sync_end (empty replay).
	// Override to replay *_create messages for a full reconnect.
	OnStateSync(e Emitter, payload *protocol.StateSyncPayload) error
}

// AssetSyncHandler is an optional hook for renderer-driven asset cache updates.
type AssetSyncHandler interface {
	OnAssetSync(e Emitter, payload *protocol.AssetSyncPayload) error
}

// ScreenshotResponseHandler is an optional hook for renderer screenshot replies.
type ScreenshotResponseHandler interface {
	OnScreenshotResponse(e Emitter, payload *protocol.ScreenshotResponsePayload) error
}

// Base provides no-op defaults for all Model methods.
// Embed it in your model struct and only override what you need.
type Base struct {
	params map[string]any
}

func (b *Base) Setup(_ Emitter) error { return nil }
func (b *Base) Step(_ Emitter) error  { return nil }

func (b *Base) OnAction(e Emitter, actionID string, _ *string, _ bool) error {
	switch actionID {
	case protocol.ActionIDInit:
		return b.Setup(e)
	case protocol.ActionIDStep:
		return b.Step(e)
	default:
		return fmt.Errorf("tensnap: unhandled action %q", actionID)
	}
}

func (b *Base) OnParamChange(_ Emitter, id string, value any) error {
	b.SetParam(id, value)
	return nil
}

func (b *Base) OnStateSync(e Emitter, p *protocol.StateSyncPayload) error {
	if err := e.StateSyncBegin(p.RequestID); err != nil {
		return err
	}
	return e.StateSyncEnd(p.RequestID)
}

func (b *Base) OnAssetSync(_ Emitter, _ *protocol.AssetSyncPayload) error { return nil }

func (b *Base) OnScreenshotResponse(_ Emitter, _ *protocol.ScreenshotResponsePayload) error {
	return nil
}

// SetParam stores a parameter value. Called automatically by OnParamChange.
func (b *Base) SetParam(id string, value any) {
	if b.params == nil {
		b.params = make(map[string]any)
	}
	b.params[id] = value
}

func (b *Base) ParamFloat(id string) float64 {
	switch f := b.params[id].(type) {
	case float64:
		return f
	case float32:
		return float64(f)
	case int:
		return float64(f)
	case int64:
		return float64(f)
	}
	return 0
}

func (b *Base) ParamBool(id string) bool {
	v, _ := b.params[id].(bool)
	return v
}

func (b *Base) ParamString(id string) string {
	v, _ := b.params[id].(string)
	return v
}

// #endregion

// #region TickCounter

// TickCounter is a thread-safe monotonic counter. Embed in your model.
type TickCounter struct{ n int64 }

func (tc *TickCounter) Tick() int64     { return atomic.LoadInt64(&tc.n) }
func (tc *TickCounter) NextTick() int64 { return atomic.AddInt64(&tc.n, 1) }
func (tc *TickCounter) ResetTick()      { atomic.StoreInt64(&tc.n, 0) }

// #endregion

// #region Pointer helpers

func BoolPtr(v bool) *bool          { return &v }
func Float64Ptr(v float64) *float64 { return &v }
func StringPtr(v string) *string    { return &v }

// #endregion
