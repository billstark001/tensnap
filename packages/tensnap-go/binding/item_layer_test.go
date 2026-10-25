package binding

import "testing"

func TestItemLayersShareReplayDiffAndSelectors(t *testing.T) {
	type model struct{ records []map[string]any }
	items := func(m *model) []map[string]any { return m.records }
	layers := map[string]func() Layer[*model]{
		"agent": func() Layer[*model] {
			return NewAgentLayer[*model, map[string]any]("items").Items(items).
				Select("id", "id").Select("source", "source").Select("target", "target").
				Select("data", "data").Const("color", "navy")
		},
		"edge": func() Layer[*model] {
			return NewEdgeLayer[*model, map[string]any]("items").Items(items).
				Select("id", "id").Select("source", "source").Select("target", "target").
				Select("data", "data").Const("color", "navy")
		},
		"trajectory": func() Layer[*model] {
			return NewTrajectoryLayer[*model, map[string]any]("items").Items(items).
				Select("id", "id").Select("source", "source").Select("target", "target").
				Select("data", "data").Const("color", "navy")
		},
	}
	for name, create := range layers {
		t.Run(name, func(t *testing.T) {
			m := &model{records: []map[string]any{{"id": "a", "source": "a", "target": "b", "data": map[string]any{"count": 0}}}}
			layer := create()
			emitter := &testEmitter{}
			if err := layer.ReplayState(m, "main", emitter); err != nil {
				t.Fatal(err)
			}
			if err := layer.PushDiffs(m, "main", emitter); err != nil {
				t.Fatal(err)
			}
			if len(emitter.itemCreates) != 1 || len(emitter.itemUpdates) != 0 {
				t.Fatal("replay did not seed the diff baseline")
			}
			m.records[0]["data"].(map[string]any)["count"] = 1
			if err := layer.PushDiffs(m, "main", emitter); err != nil {
				t.Fatal(err)
			}
			if len(emitter.itemUpdates) != 1 || emitter.itemUpdates[0].items[0]["data"].(map[string]any)["count"] != 1 {
				t.Fatal("nested update was lost")
			}
			if emitter.itemCreates[0].items[0]["data"].(map[string]any)["count"] != 0 || emitter.itemCreates[0].items[0]["color"] != "navy" {
				t.Fatal("projected values were not retained")
			}
			m.records = nil
			if err := layer.PushDiffs(m, "main", emitter); err != nil {
				t.Fatal(err)
			}
			if len(emitter.itemDeletes) != 1 {
				t.Fatal("item removal was lost")
			}
			layer.Reset()
			if err := layer.ReplayState(m, "main", emitter); err != nil {
				t.Fatal(err)
			}
		})
	}
}
