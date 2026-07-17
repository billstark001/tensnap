package abm

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"reflect"
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

	// OnAction is called for every canonical action_invoke.
	OnAction(e Emitter, payload *protocol.ActionInvokePayload) error

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

// SceneRestoreHandler is an opt-in inverse hook. Bindings must expose it only
// when the model explicitly provides a restorer; projected state is not
// assumed to be automatically reversible.
type SceneRestoreHandler interface {
	OnSceneRestore(e Emitter, payload *protocol.SceneRestorePayload) error
}

// SceneCaptureHandler is the paired opt-in checkpoint capture hook.
type SceneCaptureHandler interface {
	OnSceneCapture(e Emitter, payload *protocol.SceneCapturePayload) error
}

// ActionRouter provides a lightweight action dispatch table.
// Base.OnAction consults it first, then falls back to built-in init/step routing.
type ActionRouter interface {
	Dispatch(e Emitter, payload *protocol.ActionInvokePayload) (handled bool, err error)
}

// Base provides no-op defaults for all Model methods.
// Embed it in your model struct and only override what you need.
type Base struct {
	params        map[string]any
	scenario      *Scenario
	actionRouter  ActionRouter
	info          *protocol.SimulatorInfoPayload
	stateRevision uint64
}

func (b *Base) Setup(e Emitter) error {
	return b.ReplayScenario(e)
}
func (b *Base) Step(_ Emitter) error {
	return nil
}

func (b *Base) OnAction(e Emitter, payload *protocol.ActionInvokePayload) error {
	if payload == nil {
		return fmt.Errorf("tensnap: nil action invocation")
	}
	if b.actionRouter != nil {
		handled, err := b.actionRouter.Dispatch(e, payload)
		if handled || err != nil {
			return err
		}
	}
	var err error
	switch payload.ID {
	case protocol.ActionIDInit:
		err = b.Setup(e)
	case protocol.ActionIDStep:
		err = b.Step(e)
	default:
		err = fmt.Errorf("tensnap: unhandled action %q", payload.ID)
	}
	f := false
	result := &protocol.ActionResultPayload{ID: payload.ID, RequestID: payload.RequestID, ShouldContinue: &f}
	if err != nil {
		result.Error = &protocol.ActionExecutionError{Code: "handler_error", Message: err.Error()}
	}
	if sendErr := e.ActionResult(result); sendErr != nil {
		return sendErr
	}
	// The correlated action_result above is the protocol-visible error channel.
	// Do not return it to the transport as a second uncorrelated error frame.
	return nil
}

func (b *Base) OnParamChange(e Emitter, id string, value any) error {
	if b.scenario != nil {
		handled, err := b.scenario.ApplyParam(b, id, value)
		if handled {
			current, _, valueErr := b.scenario.ParamValue(id)
			if valueErr != nil {
				return valueErr
			}
			if err != nil || !reflect.DeepEqual(current, value) {
				if syncErr := e.ParamSync(id, current); syncErr != nil {
					return syncErr
				}
			}
			return err
		}
		if err != nil {
			return err
		}
	}
	b.SetParam(id, value)
	return nil
}

func (b *Base) OnStateSync(e Emitter, p *protocol.StateSyncPayload) error {
	if p == nil {
		return fmt.Errorf("tensnap: nil state_sync payload")
	}
	info := b.SimulatorInfo()
	if p.ModelID != info.Model.ID {
		return fmt.Errorf("tensnap: state_sync model_id mismatch")
	}
	mode := "replace"
	if p.InstanceID != nil && *p.InstanceID == info.InstanceID {
		mode = "reconcile"
	}
	if err := e.StateSyncBegin(&protocol.StateSyncBeginPayload{
		RequestID: p.RequestID, ModelID: info.Model.ID, InstanceID: info.InstanceID, Mode: mode,
	}); err != nil {
		return err
	}
	if err := b.ReplayScenario(e); err != nil {
		return err
	}
	b.stateRevision++
	return e.StateSyncEnd(&protocol.StateSyncEndPayload{RequestID: p.RequestID, StateRevision: fmt.Sprint(b.stateRevision)})
}

// SimulatorInfo returns the immutable v0.3 session handshake. Models should
// call SetSimulatorInfo to provide their stable model identity before hosting.
func (b *Base) SimulatorInfo() *protocol.SimulatorInfoPayload {
	if b.info == nil {
		language := "go"
		b.info = &protocol.SimulatorInfoPayload{
			ProtocolVersion: "0.3",
			Binding:         protocol.BindingInfo{Name: "tensnap-go", Version: "0.3.0", Language: &language},
			Model:           protocol.ModelInfo{ID: "tensnap.go.model"},
			InstanceID:      randomInstanceID(),
			Capabilities:    []string{},
		}
	}
	copy := *b.info
	copy.Capabilities = append([]string(nil), b.info.Capabilities...)
	return &copy
}

func (b *Base) SetSimulatorInfo(info protocol.SimulatorInfoPayload) {
	if info.ProtocolVersion == "" {
		info.ProtocolVersion = "0.3"
	}
	if info.Binding.Name == "" {
		info.Binding.Name = "tensnap-go"
	}
	if info.Binding.Version == "" {
		info.Binding.Version = "0.3.0"
	}
	if info.Binding.Language == nil {
		language := "go"
		info.Binding.Language = &language
	}
	if info.Model.ID == "" {
		info.Model.ID = "tensnap.go.model"
	}
	if info.InstanceID == "" {
		info.InstanceID = randomInstanceID()
	}
	if info.Capabilities == nil {
		info.Capabilities = []string{}
	}
	b.info = &info
}

func randomInstanceID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err == nil {
		return hex.EncodeToString(bytes)
	}
	return "instance"
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

// SetScenario registers the declarative scenario used by Base defaults.
// It also seeds Base parameter storage from the scenario's parameter metadata.
func (b *Base) SetScenario(s *Scenario) error {
	b.scenario = s
	if s == nil {
		return nil
	}
	return s.SeedParams(b)
}

// ReplayScenario replays the registered scenario, if any.
func (b *Base) ReplayScenario(e Emitter) error {
	if b.scenario == nil {
		return nil
	}
	return b.scenario.Replay(e)
}

// SetActionRouter installs the action router used by Base.OnAction.
func (b *Base) SetActionRouter(router ActionRouter) {
	b.actionRouter = router
}

// #endregion

// #region TickCounter

// TickCounter is a thread-safe monotonic counter. Embed in your model.
type TickCounter struct{ n int64 }

func (tc *TickCounter) Tick() int64     { return atomic.LoadInt64(&tc.n) }
func (tc *TickCounter) NextTick() int64 { return atomic.AddInt64(&tc.n, 1) }
func (tc *TickCounter) ResetTick()      { atomic.StoreInt64(&tc.n, 0) }
func (tc *TickCounter) SetTick(n int64) { atomic.StoreInt64(&tc.n, n) }

// #endregion

// #region Pointer helpers

func BoolPtr(v bool) *bool          { return &v }
func Float64Ptr(v float64) *float64 { return &v }
func StringPtr(v string) *string    { return &v }

// #endregion
