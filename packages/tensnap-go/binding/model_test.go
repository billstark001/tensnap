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

type testEdge struct {
	source string
	target string
	width  float64
}

type testModel struct {
	agents []testAgent
	edges  []testEdge
	speed  float64
}

type testEmitter struct {
	abm.Sink
	params      []any
	paramSyncs  []protocol.ParamSyncPayload
	actions     []*protocol.Action
	layers      []*protocol.EnvLayerCreatePayload
	itemCreates []itemCall
	itemUpdates []itemCall
	itemDeletes []deleteCall
	actionEnds  []*protocol.ActionEndPayload
	chartValues []protocol.ChartUpdateEntry
}

type itemCall struct {
	envID   string
	layerID string
	items   []map[string]any
}

type deleteCall struct {
	envID   string
	layerID string
	items   []any
}

func (e *testEmitter) ParamCreate(param any) error {
	e.params = append(e.params, param)
	return nil
}

func (e *testEmitter) ParamSync(id string, value any) error {
	e.paramSyncs = append(e.paramSyncs, protocol.ParamSyncPayload{ID: id, Value: value})
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

func (e *testEmitter) ItemDelete(envID, layerID string, items []any) error {
	e.itemDeletes = append(e.itemDeletes, deleteCall{envID: envID, layerID: layerID, items: append([]any(nil), items...)})
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

func TestChartGroupMetadataAndUpdates(t *testing.T) {
	raw := &testModel{
		agents: []testAgent{
			{id: "a", x: 1},
			{id: "b", x: 2},
		},
		speed: 2.5,
	}
	chart := NewChartGroup(
		"model_stats", "Model Stats",
		NewChartSeries("agent_count", "Agent Count", "#16A34A", func(model *testModel) any {
			return len(model.agents)
		}),
		NewChartSeries("speed", "Speed", "#2563EB", func(model *testModel) any {
			return model.speed
		}),
	)
	metadata := chart.Metadata()

	if metadata.ID != "model_stats" || metadata.Label != "Model Stats" {
		t.Fatalf("unexpected chart metadata: %#v", metadata)
	}
	if len(metadata.DataList) != 2 {
		t.Fatalf("expected two chart series, got %#v", metadata.DataList)
	}
	if metadata.DataList[0].ID != "agent_count" || metadata.DataList[1].ID != "speed" {
		t.Fatalf("unexpected dataList ids: %#v", metadata.DataList)
	}

	model := NewModel(raw, WithCharts(chart))
	emitter := &testEmitter{}

	if err := model.PushCharts(emitter, 4); err != nil {
		t.Fatalf("PushCharts returned error: %v", err)
	}
	if len(emitter.chartValues) != 2 {
		t.Fatalf("expected two chart updates, got %#v", emitter.chartValues)
	}
	if got := emitter.chartValues[0]; got.ID != "agent_count" || got.Value != 2 {
		t.Fatalf("unexpected first chart update: %#v", got)
	}
	if got := emitter.chartValues[1]; got.ID != "speed" || got.Value != 2.5 {
		t.Fatalf("unexpected second chart update: %#v", got)
	}
	for _, update := range emitter.chartValues {
		if update.Time == nil || *update.Time != 4 {
			t.Fatalf("unexpected chart update time: %#v", update)
		}
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

func TestEdgeLayerDiffsWithObjectDeleteKeys(t *testing.T) {
	raw := &testModel{
		edges: []testEdge{{source: "a", target: "b", width: 1}},
	}
	layer := NewEdgeLayer[*testModel, testEdge]("edges").
		Items(func(model *testModel) []testEdge { return model.edges }).
		Project(func(_ *testModel, edge testEdge) map[string]any {
			return map[string]any{"source": edge.source, "target": edge.target, "width": edge.width}
		})
	emitter := &testEmitter{}

	payload := layer.CreatePayload(raw, "world")
	if payload.LayerType != "edge" || payload.DependencyLayerIDs["agent"] != "agents" {
		t.Fatalf("unexpected edge create payload: %#v", payload)
	}
	if err := layer.ReplayState(raw, "world", emitter); err != nil {
		t.Fatalf("ReplayState returned error: %v", err)
	}
	raw.edges = nil
	if err := layer.PushDiffs(raw, "world", emitter); err != nil {
		t.Fatalf("PushDiffs returned error: %v", err)
	}
	if len(emitter.itemDeletes) != 1 {
		t.Fatalf("expected one edge delete, got %#v", emitter.itemDeletes)
	}
	key, ok := emitter.itemDeletes[0].items[0].(map[string]any)
	if !ok || key["source"] != "a" || key["target"] != "b" {
		t.Fatalf("unexpected edge delete key: %#v", emitter.itemDeletes[0].items[0])
	}
}

func TestTrajectoryAndBackgroundLayerCreatePayloads(t *testing.T) {
	raw := &testModel{}
	trails := NewEmptyTrajectoryLayer[*testModel]("trails").
		AgentLayer("agents").
		Data(func(*testModel) map[string]any {
			return map[string]any{"length": 25, "color": "#f00"}
		})
	background := NewBackgroundLayer[*testModel]("background").
		Data(func(*testModel) map[string]any {
			return map[string]any{"background": "asset://map", "interpolation": "nearest"}
		})

	trailPayload := trails.CreatePayload(raw, "world")
	if trailPayload.LayerType != "trajectory" || trailPayload.DependencyLayerIDs["agent"] != "agents" {
		t.Fatalf("unexpected trajectory payload: %#v", trailPayload)
	}
	if trailPayload.Data["length"] != 25 {
		t.Fatalf("unexpected trajectory metadata: %#v", trailPayload.Data)
	}
	backgroundPayload := background.CreatePayload(raw, "world")
	if backgroundPayload.LayerType != "background" || backgroundPayload.Data["background"] != "asset://map" {
		t.Fatalf("unexpected background payload: %#v", backgroundPayload)
	}
}

func TestParamChangeSyncsOnlyCanonicalCorrections(t *testing.T) {
	raw := &testModel{speed: 1}
	model := NewModel(
		raw,
		WithParams(
			NumberParam("speed", "Speed",
				func(model *testModel) float64 { return model.speed },
				func(model *testModel, value float64) error {
					model.speed = value
					return nil
				},
			).Range(0, 5).Step(1).Build(),
		),
	)
	emitter := &testEmitter{}

	if err := model.Setup(emitter); err != nil {
		t.Fatalf("Setup returned error: %v", err)
	}
	if err := model.OnParamChange(emitter, "speed", 3.0); err != nil {
		t.Fatalf("OnParamChange returned error: %v", err)
	}
	if len(emitter.paramSyncs) != 0 {
		t.Fatalf("accepted value should not sync, got %#v", emitter.paramSyncs)
	}
	if err := model.OnParamChange(emitter, "speed", 99.0); err != nil {
		t.Fatalf("OnParamChange returned error: %v", err)
	}
	if len(emitter.paramSyncs) != 1 || emitter.paramSyncs[0].Value != 5.0 {
		t.Fatalf("expected canonical param_sync to 5, got %#v", emitter.paramSyncs)
	}
}

func TestEnumParamSupportsDynamicOptions(t *testing.T) {
	type enumModel struct {
		mode    string
		options []string
	}
	raw := &enumModel{mode: "a", options: []string{"a", "b"}}
	param := EnumParam("mode", "Mode",
		func(model *enumModel) string { return model.mode },
		func(model *enumModel, value string) error {
			model.mode = value
			model.options = []string{value, "c"}
			return nil
		},
	).OptionsFunc(func(model *enumModel) []string {
		return model.options
	}).Build()
	model := NewModel(raw, WithParams(param))
	emitter := &testEmitter{}

	if err := model.Setup(emitter); err != nil {
		t.Fatalf("Setup returned error: %v", err)
	}
	metadata := param.Metadata(raw).Definition.(protocol.EnumParameter)
	if len(metadata.Options) != 2 || metadata.Options[0] != "a" || metadata.Options[1] != "b" {
		t.Fatalf("unexpected enum options: %#v", metadata.Options)
	}
	if err := model.OnParamChange(emitter, "mode", "b"); err != nil {
		t.Fatalf("OnParamChange returned error: %v", err)
	}
	metadata = param.Metadata(raw).Definition.(protocol.EnumParameter)
	if len(metadata.Options) != 2 || metadata.Options[0] != "b" || metadata.Options[1] != "c" {
		t.Fatalf("unexpected updated enum options: %#v", metadata.Options)
	}
	if err := model.OnParamChange(emitter, "mode", "a"); err == nil {
		t.Fatal("expected invalid enum value to be rejected")
	}
	if len(emitter.paramSyncs) != 1 || emitter.paramSyncs[0].Value != "b" {
		t.Fatalf("expected rejected value sync to b, got %#v", emitter.paramSyncs)
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
