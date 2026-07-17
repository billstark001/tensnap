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
	params       []any
	paramUpdates []any
	paramSyncs   []protocol.ParamSyncPayload
	actions      []*protocol.Action
	layers       []*protocol.EnvLayerCreatePayload
	itemCreates  []itemCall
	itemUpdates  []itemCall
	itemDeletes  []deleteCall
	actionEnds   []*protocol.ActionResultPayload
	chartValues  []protocol.ChartUpdateEntry
	chartOps     []protocol.ChartOperation
	monitors     []*protocol.MonitorMetadata
	monitorVals  []*protocol.MonitorUpdatePayload
	monitorDels  []string
	restoreEnds  []*protocol.SceneRestoreEndPayload
	captures     []*protocol.SceneCaptureResultPayload
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

func (e *testEmitter) ParamUpdate(param any) error {
	e.paramUpdates = append(e.paramUpdates, param)
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

func (e *testEmitter) ActionResult(payload *protocol.ActionResultPayload) error {
	copy := *payload
	e.actionEnds = append(e.actionEnds, &copy)
	return nil
}

func (e *testEmitter) ChartUpdate(payload *protocol.ChartUpdatePayload) error {
	e.chartValues = append(e.chartValues, payload.Updates...)
	e.chartOps = append(e.chartOps, payload.Operations...)
	return nil
}

func (e *testEmitter) MonitorCreate(payload *protocol.MonitorMetadata) error {
	copy := *payload
	e.monitors = append(e.monitors, &copy)
	return nil
}

func (e *testEmitter) MonitorUpdate(payload *protocol.MonitorUpdatePayload) error {
	copy := *payload
	e.monitorVals = append(e.monitorVals, &copy)
	return nil
}

func (e *testEmitter) MonitorDelete(id string) error {
	e.monitorDels = append(e.monitorDels, id)
	return nil
}

func (e *testEmitter) SceneRestoreEnd(payload *protocol.SceneRestoreEndPayload) error {
	copy := *payload
	e.restoreEnds = append(e.restoreEnds, &copy)
	return nil
}

func (e *testEmitter) SceneCaptureResult(payload *protocol.SceneCaptureResultPayload) error {
	copy := *payload
	e.captures = append(e.captures, &copy)
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
	startContinuous := false
	for _, action := range emitter.actions {
		if action.ID == ActionIDStart && action.Continuous != nil && *action.Continuous {
			startContinuous = true
		}
	}
	if !startContinuous {
		t.Fatalf("start action must be declared continuous: %#v", emitter.actions)
	}
	for _, action := range emitter.actions {
		if action.ID == protocol.ActionIDInit {
			t.Fatalf("init must remain dispatchable without creating a renderer action: %#v", emitter.actions)
		}
	}

	if err := model.OnParamChange(emitter, "speed", 2.5); err != nil {
		t.Fatalf("OnParamChange returned error: %v", err)
	}
	if raw.speed != 2.5 {
		t.Fatalf("speed = %v, want 2.5", raw.speed)
	}

	continuous := true
	if err := model.OnAction(emitter, &protocol.ActionInvokePayload{
		ID: ActionIDStart, RequestID: "action-1", Continuous: &continuous,
	}); err != nil {
		t.Fatalf("OnAction(start) returned error: %v", err)
	}
	if len(emitter.itemUpdates) != 1 {
		t.Fatalf("expected one item update, got %#v", emitter.itemUpdates)
	}
	if got := emitter.itemUpdates[0].items[0]["x"]; got != 3.5 {
		t.Fatalf("updated x = %#v, want 3.5", got)
	}
	if len(emitter.actionEnds) == 0 || emitter.actionEnds[len(emitter.actionEnds)-1].ID != ActionIDStart {
		t.Fatalf("expected start action_result, got %#v", emitter.actionEnds)
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

func TestDeclarativeMonitorsAndRestoreHooks(t *testing.T) {
	raw := &testModel{speed: 2}
	schema := "1"
	restored := false
	model := NewModel(
		raw,
		WithSimulatorInfo[*testModel](protocol.SimulatorInfoPayload{
			Model: protocol.ModelInfo{ID: "monitor-model", StateSchemaVersion: &schema},
		}),
		WithMonitors(NewMonitor("status", "Status", func(model *testModel) any {
			return map[string]any{"speed": model.speed}
		}).Hint("tree")),
		WithSceneRestore(func(model *testModel, payload *protocol.SceneRestorePayload) error {
			restored = true
			return nil
		}),
		WithCheckpointCapture(func(model *testModel) (any, error) {
			return model.speed, nil
		}),
		WithCheckpointRestore(func(model *testModel, data any) error {
			model.speed = data.(float64)
			return nil
		}),
	)
	emitter := &testEmitter{}

	if err := model.Setup(emitter); err != nil {
		t.Fatalf("Setup returned error: %v", err)
	}
	if len(emitter.monitors) != 1 || emitter.monitors[0].RenderHint == nil || *emitter.monitors[0].RenderHint != "tree" {
		t.Fatalf("unexpected monitor metadata: %#v", emitter.monitors)
	}
	if len(emitter.monitorVals) != 1 || emitter.monitorVals[0].Value.(map[string]any)["speed"] != 2.0 {
		t.Fatalf("unexpected monitor value: %#v", emitter.monitorVals)
	}
	info := model.SimulatorInfo()
	if got := info.Capabilities; len(got) != 3 || got[0] != "monitor" || got[1] != "scene.restore.checkpoint" || got[2] != "scene.restore.projected" {
		t.Fatalf("unexpected capabilities: %#v", got)
	}
	time := 7.0
	checkpoint, err := encodeCheckpoint(9.0)
	if err != nil {
		t.Fatalf("encodeCheckpoint returned error: %v", err)
	}
	if err := model.OnSceneRestore(emitter, &protocol.SceneRestorePayload{
		RequestID: "restore-1", ModelID: "monitor-model", StateSchemaVersion: &schema, Time: &time, Checkpoint: &checkpoint,
	}); err != nil {
		t.Fatalf("OnSceneRestore returned error: %v", err)
	}
	if !restored || raw.speed != 9 || model.Tick() != 7 || len(emitter.restoreEnds) != 1 || emitter.restoreEnds[0].Status != "ok" {
		t.Fatalf("unexpected restore state: restored=%v speed=%v tick=%d ends=%#v", restored, raw.speed, model.Tick(), emitter.restoreEnds)
	}
	if err := model.OnSceneCapture(emitter, &protocol.SceneCapturePayload{RequestID: "capture-1"}); err != nil {
		t.Fatalf("OnSceneCapture returned error: %v", err)
	}
	if len(emitter.captures) != 1 || emitter.captures[0].Checkpoint.Encoding != "application/json" {
		t.Fatalf("unexpected capture: %#v", emitter.captures)
	}
	capturedData, err := decodeCheckpoint(&emitter.captures[0].Checkpoint)
	if err != nil || capturedData != 9.0 {
		t.Fatalf("unexpected decoded capture: %#v (%v)", capturedData, err)
	}
}

func TestCheckpointOnlyRestore(t *testing.T) {
	raw := &testModel{speed: 2}
	model := NewModel(
		raw,
		WithSimulatorInfo[*testModel](protocol.SimulatorInfoPayload{
			Model: protocol.ModelInfo{ID: "checkpoint-only"},
		}),
		WithCheckpointCapture(func(model *testModel) (any, error) {
			return model.speed, nil
		}),
		WithCheckpointRestore(func(model *testModel, data any) error {
			model.speed = data.(float64)
			return nil
		}),
	)
	capabilities := model.SimulatorInfo().Capabilities
	if len(capabilities) != 1 || capabilities[0] != "scene.restore.checkpoint" {
		t.Fatalf("unexpected checkpoint-only capabilities: %#v", capabilities)
	}

	checkpoint, err := encodeCheckpoint(7.0)
	if err != nil {
		t.Fatalf("encodeCheckpoint returned error: %v", err)
	}
	emitter := &testEmitter{}
	if err := model.OnSceneRestore(emitter, &protocol.SceneRestorePayload{
		RequestID: "restore-only", ModelID: "checkpoint-only", Checkpoint: &checkpoint,
	}); err != nil {
		t.Fatalf("OnSceneRestore returned error: %v", err)
	}
	if raw.speed != 7 || len(emitter.restoreEnds) != 1 || emitter.restoreEnds[0].Status != "ok" {
		t.Fatalf("unexpected checkpoint-only restore: speed=%v ends=%#v", raw.speed, emitter.restoreEnds)
	}
}

func TestResetUsesUpdatesAndRecreatesAgentState(t *testing.T) {
	raw := &testModel{speed: 2}
	initCalls := 0
	model := NewModel(
		raw,
		WithInit(func(model *testModel) error {
			initCalls++
			x := 4.0
			if initCalls > 1 {
				x = 0
			}
			model.agents = []testAgent{{id: "a", x: x}}
			return nil
		}),
		WithEnvs(NewEnv("world",
			NewAgentLayer[*testModel, testAgent]("agents").
				Items(func(model *testModel) []testAgent { return model.agents }).
				Project(func(_ *testModel, agent testAgent) map[string]any {
					return map[string]any{"id": agent.id, "x": agent.x, "y": 0.0}
				}),
		)),
		WithParams(NumberParam("speed", "Speed",
			func(model *testModel) float64 { return model.speed },
			func(model *testModel, value float64) error {
				model.speed = value
				return nil
			},
		).Build()),
		WithCharts(NewChart("speed", "Speed", "#2563EB", func(model *testModel) any { return model.speed })),
		WithMonitors(NewMonitor("status", "Status", func(model *testModel) any { return model.speed })),
	)
	emitter := &testEmitter{}
	if err := model.Setup(emitter); err != nil {
		t.Fatalf("Setup returned error: %v", err)
	}
	initialMonitorCreates := len(emitter.monitors)
	continuous := false
	if err := model.OnAction(emitter, &protocol.ActionInvokePayload{
		ID: ActionIDReset, RequestID: "reset-1", Continuous: &continuous,
	}); err != nil {
		t.Fatalf("OnAction(reset) returned error: %v", err)
	}

	if len(emitter.monitors) != initialMonitorCreates {
		t.Fatalf("reset emitted duplicate monitor_create: %#v", emitter.monitors)
	}
	if len(emitter.itemCreates) != 2 || emitter.itemCreates[1].items[0]["x"] != 0.0 {
		t.Fatalf("reset did not recreate current agent state: %#v", emitter.itemCreates)
	}
	if len(emitter.itemDeletes) != 1 || len(emitter.itemDeletes[0].items) != 1 || emitter.itemDeletes[0].items[0] != "a" {
		t.Fatalf("reset did not delete the previous agent state before recreating it: %#v", emitter.itemDeletes)
	}
	if len(emitter.paramUpdates) != 1 {
		t.Fatalf("reset did not emit a protocol parameter definition: %#v", emitter.paramUpdates)
	}
	if _, ok := emitter.paramUpdates[0].(protocol.NumberParameter); !ok {
		t.Fatalf("reset emitted internal parameter metadata instead of a protocol payload: %T", emitter.paramUpdates[0])
	}
	if len(emitter.chartOps) != 1 || emitter.chartOps[0].Operation != "clear" {
		t.Fatalf("reset did not clear charts explicitly: %#v", emitter.chartOps)
	}
	if len(emitter.monitorVals) < 2 || len(emitter.actionEnds) == 0 {
		t.Fatalf("reset did not replay current values/result: monitors=%#v results=%#v", emitter.monitorVals, emitter.actionEnds)
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
		}).
		Width(2).
		OnAgentDelete(protocol.TrajectoryAgentDeleteRetain).
		OnStateSync(protocol.TrajectoryStateSyncPreserve).
		OnReset(protocol.TrajectoryResetClear)
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
	if trailPayload.Data["width"] != 2.0 || trailPayload.Data["on_agent_delete"] != protocol.TrajectoryAgentDeleteRetain || trailPayload.Data["on_state_sync"] != protocol.TrajectoryStateSyncPreserve || trailPayload.Data["on_reset"] != protocol.TrajectoryResetClear {
		t.Fatalf("unexpected trajectory lifecycle metadata: %#v", trailPayload.Data)
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
