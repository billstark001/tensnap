package binding

import (
	"testing"

	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

func TestRestorePlanReconcilesCompleteLayerAndRejectsDuplicates(t *testing.T) {
	raw := &testModel{agents: []testAgent{{id: "old", x: 1}}}
	layer := NewAgentLayer[*testModel, testAgent]("agents").
		Items(func(m *testModel) []testAgent { return m.agents }).
		Project(func(_ *testModel, a testAgent) map[string]any { return map[string]any{"id": a.id, "x": a.x} }).
		Restore(RestoreLayer[*testModel]{
			Create: func(m *testModel, item map[string]any) error {
				m.agents = append(m.agents, testAgent{id: item["id"].(string), x: item["x"].(float64)})
				return nil
			},
			Update: func(m *testModel, item map[string]any) error {
				for i := range m.agents {
					if m.agents[i].id == item["id"] {
						m.agents[i].x = item["x"].(float64)
					}
				}
				return nil
			},
			Delete: func(m *testModel, item map[string]any) error {
				for i := range m.agents {
					if m.agents[i].id == item["id"] {
						m.agents = append(m.agents[:i], m.agents[i+1:]...)
						break
					}
				}
				return nil
			},
		})
	model := NewModel(raw,
		WithSimulatorInfo[*testModel](protocol.SimulatorInfoPayload{Model: protocol.ModelInfo{ID: "restore-plan"}}),
		WithEnvs(NewEnv("main", layer)),
		WithRestoreTime(func(_ *testModel, _ float64) error { return nil }),
	)
	emitter := &testEmitter{}
	tick := 7.0
	restore := func(request string, items []any) {
		t.Helper()
		if err := model.OnSceneRestore(emitter, &protocol.SceneRestorePayload{
			RequestID: request, ModelID: "restore-plan", Time: &tick,
			Envs: []any{map[string]any{"id": "main", "type": "2d", "layers": []any{
				map[string]any{"layer_id": "agents", "layer_type": "agent", "items": items},
			}}},
		}); err != nil {
			t.Fatal(err)
		}
	}
	restore("bad", []any{map[string]any{"id": "same"}, map[string]any{"id": "same"}})
	if emitter.restoreEnds[len(emitter.restoreEnds)-1].Status != "rejected" || len(raw.agents) != 1 {
		t.Fatalf("invalid input mutated the model: %#v", raw.agents)
	}
	restore("ok", []any{map[string]any{"id": "new", "x": 3.0}})
	if emitter.restoreEnds[len(emitter.restoreEnds)-1].Status != "ok" || len(raw.agents) != 1 || raw.agents[0].id != "new" || raw.agents[0].x != 3 || model.Tick() != 7 {
		t.Fatalf("restore failed: agents=%#v ends=%#v tick=%d", raw.agents, emitter.restoreEnds, model.Tick())
	}
}
