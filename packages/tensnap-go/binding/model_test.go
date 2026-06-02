package binding

import (
	"testing"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

type testAgent struct {
	id string
	x  float64
}

type testModel struct {
	agents []testAgent
	speed  float64
}

type testEmitter struct {
	abm.Sink
	params      []any
	actions     []*protocol.Action
	layers      []*protocol.EnvLayerCreatePayload
	itemCreates []itemCall
	itemUpdates []itemCall
	actionEnds  []*protocol.ActionEndPayload
	chartValues []protocol.ChartUpdateEntry
}

type itemCall struct {
	envID   string
	layerID string
	items   []map[string]any
}

func (e *testEmitter) ParamCreate(param any) error {
	e.params = append(e.params, param)
	return nil
}

func (e *testEmitter) ActionCreate(action *protocol.Action) error {
	copy := *action
	e.actions = append(e.actions, &copy)
	return nil
}

func (e *testEmitter) EnvLayerCreate(layer *protocol.EnvLayerCreatePayload) error {
	copy := *layer
	e.layers = append(e.layers, &copy)
	return nil
}

func (e *testEmitter) ItemCreate(envID, layerID string, items []map[string]any) error {
	e.itemCreates = append(e.itemCreates, itemCall{envID: envID, layerID: layerID, items: cloneSnapshots(items)})
	return nil
}

func (e *testEmitter) ItemUpdate(envID, layerID string, items []map[string]any) error {
	e.itemUpdates = append(e.itemUpdates, itemCall{envID: envID, layerID: layerID, items: cloneSnapshots(items)})
	return nil
}

func (e *testEmitter) ActionEnd(payload *protocol.ActionEndPayload) error {
	copy := *payload
	e.actionEnds = append(e.actionEnds, &copy)
	return nil
}

func (e *testEmitter) ChartUpdate(payload *protocol.ChartUpdatePayload) error {
	e.chartValues = append(e.chartValues, payload.Updates...)
	return nil
}

func TestDeclarativeModelReplaysAndDiffsOwnedState(t *testing.T) {
	raw := &testModel{speed: 1}
	model := NewModel(
		raw,
		WithInit(func(model *testModel) error {
			model.agents = []testAgent{{id: "a", x: 1}}
			return nil
		}),
		WithStep(func(model *testModel) (bool, error) {
			model.agents[0].x += model.speed
			return true, nil
		}),
		WithParams(
			NumberParam("speed", "Speed",
				func(model *testModel) float64 { return model.speed },
				func(model *testModel, value float64) error {
					model.speed = value
					return nil
				},
			).Range(0, 5).Step(0.5).Runtime(true).Build(),
		),
		WithEnvs(NewEnv("world",
			NewAgentLayer[*testModel, testAgent]("agents").
				Items(func(model *testModel) []testAgent { return model.agents }).
				Project(func(_ *testModel, agent testAgent) map[string]any {
					return map[string]any{"id": agent.id, "x": agent.x, "y": 0.0}
				}),
		)),
		WithCharts(NewChart("count", "Count", "#000", func(model *testModel) any {
			return float64(len(model.agents))
		})),
	)
	emitter := &testEmitter{}

	if err := model.Setup(emitter); err != nil {
		t.Fatalf("Setup returned error: %v", err)
	}
	if len(emitter.params) != 1 {
		t.Fatalf("expected one param, got %d", len(emitter.params))
	}
	if len(emitter.layers) != 1 || emitter.layers[0].LayerID != "agents" {
		t.Fatalf("expected agent layer replay, got %#v", emitter.layers)
	}
	if len(emitter.itemCreates) != 1 || emitter.itemCreates[0].items[0]["id"] != "a" {
		t.Fatalf("expected initial item create, got %#v", emitter.itemCreates)
	}

	if err := model.OnParamChange(emitter, "speed", 2.5); err != nil {
		t.Fatalf("OnParamChange returned error: %v", err)
	}
	if raw.speed != 2.5 {
		t.Fatalf("speed = %v, want 2.5", raw.speed)
	}

	if err := model.OnAction(emitter, ActionIDStart, nil, true); err != nil {
		t.Fatalf("OnAction(start) returned error: %v", err)
	}
	if len(emitter.itemUpdates) != 1 {
		t.Fatalf("expected one item update, got %#v", emitter.itemUpdates)
	}
	if got := emitter.itemUpdates[0].items[0]["x"]; got != 3.5 {
		t.Fatalf("updated x = %#v, want 3.5", got)
	}
	if len(emitter.actionEnds) == 0 || emitter.actionEnds[len(emitter.actionEnds)-1].ID != ActionIDStart {
		t.Fatalf("expected start action_end, got %#v", emitter.actionEnds)
	}
	if len(emitter.chartValues) == 0 || emitter.chartValues[len(emitter.chartValues)-1].ID != "count" {
		t.Fatalf("expected chart update, got %#v", emitter.chartValues)
	}
}

func TestAgentLayerUsesIncrementalTrackerWhenConfigured(t *testing.T) {
	raw := &testModel{
		agents: []testAgent{
			{id: "a", x: 1},
			{id: "b", x: 2},
		},
	}
	changed := map[string]bool{}
	projectCalls := 0
	layer := NewAgentLayer[*testModel, testAgent]("agents").
		Items(func(model *testModel) []testAgent { return model.agents }).
		ItemID(func(_ *testModel, agent testAgent) any { return agent.id }).
		Changed(func(_ *testModel, agent testAgent) bool { return changed[agent.id] }).
		Project(func(_ *testModel, agent testAgent) map[string]any {
			projectCalls++
			return map[string]any{"id": agent.id, "x": agent.x, "y": 0.0}
		})
	emitter := &testEmitter{}

	if err := layer.ReplayState(raw, "world", emitter); err != nil {
		t.Fatalf("ReplayState returned error: %v", err)
	}
	if projectCalls != 2 {
		t.Fatalf("initial project calls = %d, want 2", projectCalls)
	}

	projectCalls = 0
	raw.agents[0].x = 3
	changed["a"] = true
	if err := layer.PushDiffs(raw, "world", emitter); err != nil {
		t.Fatalf("PushDiffs returned error: %v", err)
	}
	if projectCalls != 1 {
		t.Fatalf("incremental project calls = %d, want 1", projectCalls)
	}
	if len(emitter.itemUpdates) != 1 {
		t.Fatalf("expected one update, got %#v", emitter.itemUpdates)
	}
	got := emitter.itemUpdates[0].items[0]
	if got["id"] != "a" || got["x"] != float64(3) {
		t.Fatalf("unexpected update payload: %#v", got)
	}
	if _, ok := got["y"]; ok {
		t.Fatalf("unchanged y should not be present: %#v", got)
	}
}

func cloneSnapshots(items []map[string]any) []map[string]any {
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
