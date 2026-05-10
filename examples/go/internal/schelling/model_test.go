package schelling

import (
	"testing"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

type itemCreateCall struct {
	envID   string
	layerID string
	items   []map[string]any
}

type recordingEmitter struct {
	abm.Sink
	actionCreates   []*protocol.Action
	actionEnds      []*protocol.ActionEndPayload
	itemCreates     []itemCreateCall
	stateSyncBegins []string
	stateSyncEnds   []string
}

func (e *recordingEmitter) StateSyncBegin(requestID *string) error {
	e.stateSyncBegins = append(e.stateSyncBegins, derefString(requestID))
	return nil
}

func (e *recordingEmitter) StateSyncEnd(requestID *string) error {
	e.stateSyncEnds = append(e.stateSyncEnds, derefString(requestID))
	return nil
}

func (e *recordingEmitter) ActionCreate(action *protocol.Action) error {
	copy := *action
	if action.Continuous != nil {
		copy.Continuous = abm.BoolPtr(*action.Continuous)
	}
	if action.AllowRuntimeChange != nil {
		copy.AllowRuntimeChange = abm.BoolPtr(*action.AllowRuntimeChange)
	}
	e.actionCreates = append(e.actionCreates, &copy)
	return nil
}

func (e *recordingEmitter) ActionEnd(payload *protocol.ActionEndPayload) error {
	copy := *payload
	if payload.TickID != nil {
		copy.TickID = abm.StringPtr(*payload.TickID)
	}
	if payload.Continue != nil {
		copy.Continue = abm.BoolPtr(*payload.Continue)
	}
	if payload.Timings != nil {
		timings := *payload.Timings
		copy.Timings = &timings
	}
	e.actionEnds = append(e.actionEnds, &copy)
	return nil
}

func (e *recordingEmitter) ItemCreate(envID, layerID string, items []map[string]any) error {
	e.itemCreates = append(e.itemCreates, itemCreateCall{
		envID:   envID,
		layerID: layerID,
		items:   cloneItems(items),
	})
	return nil
}

func TestOnStateSyncInitializesFreshModel(t *testing.T) {
	model := NewVizModel(NewDefaultModel())
	emitter := &recordingEmitter{}
	requestID := "sync-1"

	if err := model.OnStateSync(emitter, &protocol.StateSyncPayload{RequestID: abm.StringPtr(requestID)}); err != nil {
		t.Fatalf("OnStateSync returned error: %v", err)
	}

	if !model.model.Initialized {
		t.Fatal("expected fresh model to initialize during first state sync")
	}
	if len(emitter.stateSyncBegins) != 1 || emitter.stateSyncBegins[0] != requestID {
		t.Fatalf("unexpected state_sync_begin payloads: %#v", emitter.stateSyncBegins)
	}
	if len(emitter.stateSyncEnds) != 1 || emitter.stateSyncEnds[0] != requestID {
		t.Fatalf("unexpected state_sync_end payloads: %#v", emitter.stateSyncEnds)
	}
	if len(emitter.itemCreates) == 0 || len(emitter.itemCreates[0].items) == 0 {
		t.Fatal("expected initial state sync to replay non-empty agent items")
	}

	actions := make(map[string]*protocol.Action, len(emitter.actionCreates))
	for _, action := range emitter.actionCreates {
		actions[action.ID] = action
	}
	if actions[ActionIDStart] == nil || actions[protocol.ActionIDStep] == nil || actions[ActionIDReset] == nil {
		t.Fatalf("expected start/step/reset actions, got %#v", actions)
	}
	if actions[ActionIDStart].Continuous == nil || !*actions[ActionIDStart].Continuous {
		t.Fatal("expected start action to be marked continuous")
	}
	if actions[protocol.ActionIDStep].Continuous != nil && *actions[protocol.ActionIDStep].Continuous {
		t.Fatal("expected step action to remain single-step")
	}
}

func TestOnActionStartEchoesTickIDAndActionID(t *testing.T) {
	model := NewVizModel(NewDefaultModel())
	emitter := &recordingEmitter{}
	requestID := "sync-2"
	if err := model.OnStateSync(emitter, &protocol.StateSyncPayload{RequestID: abm.StringPtr(requestID)}); err != nil {
		t.Fatalf("OnStateSync returned error: %v", err)
	}

	tickID := "tick-start"
	if err := model.OnAction(emitter, ActionIDStart, abm.StringPtr(tickID), true); err != nil {
		t.Fatalf("OnAction(start) returned error: %v", err)
	}

	if len(emitter.actionEnds) == 0 {
		t.Fatal("expected start action to emit action_end")
	}
	got := emitter.actionEnds[len(emitter.actionEnds)-1]
	if got.ID != ActionIDStart {
		t.Fatalf("expected action_end id %q, got %q", ActionIDStart, got.ID)
	}
	if got.TickID == nil || *got.TickID != tickID {
		t.Fatalf("expected action_end tick_id %q, got %#v", tickID, got.TickID)
	}
	if got.Continue == nil {
		t.Fatal("expected start action to emit an explicit continue flag")
	}
}

func TestOnActionResetReplaysAndStops(t *testing.T) {
	model := NewVizModel(NewDefaultModel())
	emitter := &recordingEmitter{}
	requestID := "sync-3"
	if err := model.OnStateSync(emitter, &protocol.StateSyncPayload{RequestID: abm.StringPtr(requestID)}); err != nil {
		t.Fatalf("OnStateSync returned error: %v", err)
	}

	beforeCreates := len(emitter.itemCreates)
	tickID := "tick-reset"
	if err := model.OnAction(emitter, ActionIDReset, abm.StringPtr(tickID), false); err != nil {
		t.Fatalf("OnAction(reset) returned error: %v", err)
	}

	if len(emitter.itemCreates) <= beforeCreates {
		t.Fatal("expected reset to replay the agent snapshot")
	}
	if len(emitter.actionEnds) == 0 {
		t.Fatal("expected reset action to emit action_end")
	}
	got := emitter.actionEnds[len(emitter.actionEnds)-1]
	if got.ID != ActionIDReset {
		t.Fatalf("expected action_end id %q, got %q", ActionIDReset, got.ID)
	}
	if got.TickID == nil || *got.TickID != tickID {
		t.Fatalf("expected action_end tick_id %q, got %#v", tickID, got.TickID)
	}
	if got.Continue == nil || *got.Continue {
		t.Fatalf("expected reset action to stop, got %#v", got.Continue)
	}
}

func cloneItems(items []map[string]any) []map[string]any {
	cloned := make([]map[string]any, len(items))
	for index, item := range items {
		copyMap := make(map[string]any, len(item))
		for key, value := range item {
			copyMap[key] = value
		}
		cloned[index] = copyMap
	}
	return cloned
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
