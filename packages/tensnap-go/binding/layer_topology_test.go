package binding

import (
	"strings"
	"testing"

	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

type twoGridModel struct{ left, right string }

func TestDependencySiblingsFollowDeclarationOrder(t *testing.T) {
	indices, err := orderLayerDependencies(
		[]string{"dependent", "second", "first"},
		[][]string{{"first", "second"}, nil, nil},
	)
	if err != nil || len(indices) != 3 || indices[0] != 1 || indices[1] != 2 || indices[2] != 0 {
		t.Fatalf("dependency siblings must follow declaration order: %v, %v", indices, err)
	}
}

func TestEnvironmentCompilesDependencyOrderOnce(t *testing.T) {
	raw := &testModel{}
	ens := NewEnv("main",
		NewEdgeLayer[*testModel, testAgent]("edges").AgentLayer("agents"),
		NewAgentLayer[*testModel, testAgent]("agents"),
	)
	first := ens.Scenario(raw)
	if first.Layers[0].LayerID != "agents" || first.Layers[1].LayerID != "edges" {
		t.Fatalf("prerequisite must precede dependent: %#v", first.Layers)
	}
	if !ens.topologyPrepared {
		t.Fatal("environment topology was not compiled")
	}
	second := ens.Scenario(raw)
	if second.Layers[0].LayerID != "agents" || second.Layers[1].LayerID != "edges" {
		t.Fatalf("compiled order changed: %#v", second.Layers)
	}
}

func TestEnvironmentRejectsInvalidDependencies(t *testing.T) {
	raw := &testModel{}
	missing := NewEnv("main", NewEdgeLayer[*testModel, testAgent]("edges"))
	if _, err := missing.orderedLayers(raw); err == nil || !strings.Contains(err.Error(), "missing layer") {
		t.Fatalf("expected missing dependency error, got %v", err)
	}
	wrongType := NewEnv("main",
		NewEdgeLayer[*testModel, testAgent]("edges"),
		NewGridLayer[*testModel]("agents"),
	)
	if _, err := wrongType.orderedLayers(raw); err == nil || !strings.Contains(err.Error(), "requires agent layer") {
		t.Fatalf("expected wrong dependency type error, got %v", err)
	}
	cycle := NewEnv("main",
		NewAgentLayer[*testModel, testAgent]("agents"),
		NewEdgeLayer[*testModel, testAgent]("edges").DependencyLayer("other", "trails"),
		NewTrajectoryLayer[*testModel, testAgent]("trails").DependencyLayer("other", "edges"),
	)
	if _, err := cycle.orderedLayers(raw); err == nil || !strings.Contains(err.Error(), "cyclic") {
		t.Fatalf("expected cycle error, got %v", err)
	}
	duplicate := NewEnv("main",
		NewGridLayer[*testModel]("same"), NewGridLayer[*testModel]("same"),
	)
	if _, err := duplicate.orderedLayers(raw); err == nil || !strings.Contains(err.Error(), "duplicate layer id") {
		t.Fatalf("expected duplicate id error, got %v", err)
	}
}

func TestLayerRestoreCallbacksStayWithTheirLayer(t *testing.T) {
	raw := &twoGridModel{}
	left := NewGridLayer[*twoGridModel]("left").Restore(RestoreLayer[*twoGridModel]{
		Metadata: func(m *twoGridModel, data map[string]any) error {
			m.left = data["marker"].(string)
			return nil
		},
	})
	right := NewGridLayer[*twoGridModel]("right").Restore(RestoreLayer[*twoGridModel]{
		Metadata: func(m *twoGridModel, data map[string]any) error {
			m.right = data["marker"].(string)
			return nil
		},
	})
	model := NewModel(raw,
		WithSimulatorInfo[*twoGridModel](protocol.SimulatorInfoPayload{Model: protocol.ModelInfo{ID: "two-grids"}}),
		WithEnvs(NewEnv("main", right, left)),
	)
	emitter := &testEmitter{}
	err := model.OnSceneRestore(emitter, &protocol.SceneRestorePayload{
		RequestID: "restore-grids", ModelID: "two-grids",
		Envs: []any{map[string]any{"id": "main", "type": "2d", "layers": []any{
			map[string]any{"layer_id": "right", "layer_type": "grid", "metadata": map[string]any{"marker": "R"}},
			map[string]any{"layer_id": "left", "layer_type": "grid", "metadata": map[string]any{"marker": "L"}},
		}}},
	})
	if err != nil || raw.left != "L" || raw.right != "R" || emitter.restoreEnds[len(emitter.restoreEnds)-1].Status != "ok" {
		t.Fatalf("restore crossed layer ownership: left=%q right=%q err=%v ends=%#v", raw.left, raw.right, err, emitter.restoreEnds)
	}
}
