package schelling

import (
	"encoding/json"
	"testing"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

type itemCreateCall struct {
	envID   string
	layerID string
	items   []map[string]any
}

type itemDeleteCall struct {
	envID   string
	layerID string
	items   []any
}

type recordingEmitter struct {
	abm.Sink
	actionCreates   []*protocol.Action
	actionResults   []*protocol.ActionResultPayload
	itemCreates     []itemCreateCall
	itemDeletes     []itemDeleteCall
	paramUpdates    []any
	chartOperations []protocol.ChartOperation
	metadataTimes   []float64
	stateSyncBegins []string
	stateSyncEnds   []string
}

func (e *recordingEmitter) MetadataUpdate(payload *protocol.MetadataUpdatePayload) error {
	if payload.Time != nil {
		e.metadataTimes = append(e.metadataTimes, *payload.Time)
	}
	return nil
}

func (e *recordingEmitter) StateSyncBegin(payload *protocol.StateSyncBeginPayload) error {
	e.stateSyncBegins = append(e.stateSyncBegins, payload.RequestID)
	return nil
}

func (e *recordingEmitter) StateSyncEnd(payload *protocol.StateSyncEndPayload) error {
	e.stateSyncEnds = append(e.stateSyncEnds, payload.RequestID)
	return nil
}

func (e *recordingEmitter) ActionCreate(action *protocol.Action) error {
	copy := *action
	if action.Continuous != nil {
		copy.Continuous = abm.BoolPtr(*action.Continuous)
	}
	e.actionCreates = append(e.actionCreates, &copy)
	return nil
}

func (e *recordingEmitter) ActionResult(payload *protocol.ActionResultPayload) error {
	copy := *payload
	copy.RequestID = payload.RequestID
	if payload.ShouldContinue != nil {
		copy.ShouldContinue = abm.BoolPtr(*payload.ShouldContinue)
	}
	if payload.Timings != nil {
		timings := *payload.Timings
		copy.Timings = &timings
	}
	e.actionResults = append(e.actionResults, &copy)
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

func (e *recordingEmitter) ItemDelete(envID, layerID string, items []any) error {
	e.itemDeletes = append(e.itemDeletes, itemDeleteCall{
		envID: envID, layerID: layerID, items: append([]any(nil), items...),
	})
	return nil
}

func (e *recordingEmitter) ParamUpdate(payload any) error {
	if _, err := json.Marshal(payload); err != nil {
		return err
	}
	e.paramUpdates = append(e.paramUpdates, payload)
	return nil
}

func (e *recordingEmitter) ChartUpdate(payload *protocol.ChartUpdatePayload) error {
	e.chartOperations = append(e.chartOperations, payload.Operations...)
	return nil
}

func TestOnStateSyncInitializesFreshModel(t *testing.T) {
	model := NewVizModel(NewDefaultModel())
	emitter := &recordingEmitter{}
	requestID := "sync-1"

	if err := model.OnStateSync(emitter, stateSyncPayload(model, requestID)); err != nil {
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
	if actions[protocol.ActionIDInit] != nil {
		t.Fatalf("init is a lifecycle handshake and must not create a button: %#v", actions[protocol.ActionIDInit])
	}
	if actions[ActionIDStart].Continuous == nil || !*actions[ActionIDStart].Continuous {
		t.Fatal("expected start action to be marked continuous")
	}
	if actions[protocol.ActionIDStep].Continuous != nil && *actions[protocol.ActionIDStep].Continuous {
		t.Fatal("expected step action to remain single-step")
	}
}

func TestStartActionEchoesRequestIDAndActionID(t *testing.T) {
	model := NewVizModel(NewDefaultModel())
	emitter := &recordingEmitter{}
	requestID := "sync-2"
	if err := model.OnStateSync(emitter, stateSyncPayload(model, requestID)); err != nil {
		t.Fatalf("OnStateSync returned error: %v", err)
	}

	requestID = "action-start"
	continuous := true
	if err := model.OnAction(emitter, &protocol.ActionInvokePayload{
		ID: ActionIDStart, RequestID: requestID, Continuous: &continuous,
	}); err != nil {
		t.Fatalf("OnAction(start) returned error: %v", err)
	}

	if len(emitter.actionResults) == 0 {
		t.Fatal("expected start action to emit action_result")
	}
	got := emitter.actionResults[len(emitter.actionResults)-1]
	if got.ID != ActionIDStart {
		t.Fatalf("expected action_result id %q, got %q", ActionIDStart, got.ID)
	}
	if got.RequestID != requestID {
		t.Fatalf("expected action_result request_id %q, got %q", requestID, got.RequestID)
	}
	if got.ShouldContinue == nil {
		t.Fatal("expected start action to emit an explicit should_continue flag")
	}
}

func TestOnActionResetReplaysAndStops(t *testing.T) {
	model := NewVizModel(NewDefaultModel())
	emitter := &recordingEmitter{}
	requestID := "sync-3"
	if err := model.OnStateSync(emitter, stateSyncPayload(model, requestID)); err != nil {
		t.Fatalf("OnStateSync returned error: %v", err)
	}

	beforeCreates := len(emitter.itemCreates)
	beforeDeletes := len(emitter.itemDeletes)
	previousAgentCount := len(emitter.itemCreates[beforeCreates-1].items)
	requestID = "action-reset"
	continuous := false
	if err := model.OnAction(emitter, &protocol.ActionInvokePayload{
		ID: ActionIDReset, RequestID: requestID, Continuous: &continuous,
	}); err != nil {
		t.Fatalf("OnAction(reset) returned error: %v", err)
	}

	if len(emitter.itemCreates) <= beforeCreates {
		t.Fatal("expected reset to replay the agent snapshot")
	}
	if len(emitter.itemDeletes) <= beforeDeletes {
		t.Fatal("expected reset to delete the previous agent snapshot")
	}
	if got := len(emitter.itemDeletes[len(emitter.itemDeletes)-1].items); got != previousAgentCount {
		t.Fatalf("expected reset to delete %d previous agents, got %d", previousAgentCount, got)
	}
	if len(emitter.paramUpdates) == 0 {
		t.Fatal("expected reset to publish serializable parameter updates")
	}
	if len(emitter.chartOperations) != 2 {
		t.Fatalf("expected reset to clear both chart groups, got %#v", emitter.chartOperations)
	}
	if len(emitter.metadataTimes) == 0 || emitter.metadataTimes[len(emitter.metadataTimes)-1] != 0 {
		t.Fatalf("expected reset to publish time 0, got %#v", emitter.metadataTimes)
	}
	if len(emitter.actionResults) == 0 {
		t.Fatal("expected reset action to emit action_result")
	}
	got := emitter.actionResults[len(emitter.actionResults)-1]
	if got.ID != ActionIDReset {
		t.Fatalf("expected action_result id %q, got %q", ActionIDReset, got.ID)
	}
	if got.RequestID != requestID {
		t.Fatalf("expected action_result request_id %q, got %q", requestID, got.RequestID)
	}
	if got.ShouldContinue == nil || *got.ShouldContinue {
		t.Fatalf("expected reset action to stop, got %#v", got.ShouldContinue)
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

func stateSyncPayload(model *VizModel, requestID string) *protocol.StateSyncPayload {
	return &protocol.StateSyncPayload{
		RequestID: requestID,
		ModelID:   model.SimulatorInfo().Model.ID,
	}
}
