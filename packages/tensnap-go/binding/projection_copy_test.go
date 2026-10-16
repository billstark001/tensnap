package binding

import (
	"testing"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
)

func TestLayerProjectionOwnership(t *testing.T) {
	type model struct{ item map[string]any }
	type diffLayer interface {
		computeDiffs(*model) ([]map[string]any, []map[string]any, []any)
	}
	for _, kind := range []string{"agent", "edge", "trajectory", "fields"} {
		t.Run(kind, func(t *testing.T) {
			m := &model{item: map[string]any{"id": "a", "source": "a", "target": "b", "data": map[string]any{"count": 0}}}
			items := func(m *model) []map[string]any { return []map[string]any{m.item} }
			project := func(_ *model, item map[string]any) map[string]any { return item }
			var layer diffLayer
			switch kind {
			case "agent":
				layer = NewAgentLayer[*model, map[string]any]("agents").Items(items).Project(project)
			case "edge":
				layer = NewEdgeLayer[*model, map[string]any]("edges").Items(items).Project(project)
			case "trajectory":
				layer = NewTrajectoryLayer[*model, map[string]any]("trails").Items(items).Project(project)
			default:
				layer = NewAgentLayer[*model, map[string]any]("agents").Items(items).Field("id", func(_ *model, item map[string]any) any { return item["id"] }).Select("data", "data")
			}
			created, _, _ := layer.computeDiffs(m)
			m.item["data"].(map[string]any)["count"] = 1
			_, updates, _ := layer.computeDiffs(m)
			if len(updates) != 1 || created[0]["data"].(map[string]any)["count"] != 0 {
				t.Fatal("model mutation rewrote published state or was not emitted")
			}
		})
	}
}

func TestCustomOwnedMapProjectionDetachesInjectedSourceValue(t *testing.T) {
	type model struct{ values map[string]map[string]any }
	value := map[string]any{"count": 0}
	m := &model{values: map[string]map[string]any{"a": value}}
	l := NewMapAgentLayer[*model, string, map[string]any]("items").Source(func(m *model) map[string]map[string]any { return m.values }).Project(func(*model, string, map[string]any) map[string]any { return map[string]any{} }).ProjectorOwnsValues(true)
	created, _, _ := l.computeDiffs(m)
	value["count"] = 1
	_, updates, _ := l.computeDiffs(m)
	saved := created[0]["data"].(map[string]any)["value"].(map[string]any)
	if saved["count"] != 0 || len(updates) != 1 {
		t.Fatal("injected source value aliased the model")
	}
}

func TestLayerCopyOverrides(t *testing.T) {
	type model struct{ data map[string]any }
	for _, copyBoundary := range []bool{false, true} {
		l := NewAgentLayer[*model, int]("agents").Items(func(*model) []int { return []int{1} }).Field("id", func(*model, int) any { return 1 }).Field("data", func(m *model, _ int) any { return m.data }).ProjectorDeepCopy(false).DeepCopy(copyBoundary)
		m := &model{data: map[string]any{"count": 0}}
		created, _, _ := l.computeDiffs(m)
		m.data["count"] = 1
		if (created[0]["data"].(map[string]any)["count"] == 0) != copyBoundary {
			t.Fatal("explicit copy policy was ignored")
		}
	}
	// Built-in output is transferred to a tracker by default, but callers can force a second copy.
	l := NewAgentLayer[*model, int]("agents").Field("id", func(*model, int) any { return 1 })
	if l.diff.DeepCopy {
		t.Fatal("built-in projection should not be copied again")
	}
	l.DeepCopy(true)
	if !l.diff.DeepCopy {
		t.Fatal("forced publication copy was ignored")
	}
	owned := abm.SnapshotItem(map[string]any{"id": 1}, true)
	l.diff.SeedOwned([]abm.ItemSnapshot{owned})
}

func TestMatrixProjectionOwnsNestedSourceValues(t *testing.T) {
	type model struct{ cells [][]map[string]any }
	for _, custom := range []bool{false, true} {
		value := map[string]any{"values": []int{0}}
		m := &model{cells: [][]map[string]any{{value}}}
		l := NewMatrixAgentLayer[*model, map[string]any]("items").Source(func(m *model) [][]map[string]any { return m.cells })
		if custom {
			l.Project(func(*model, int, int, map[string]any) map[string]any { return map[string]any{} }).ProjectorOwnsValues(true)
		}
		created, _, _ := l.computeDiffs(m)
		value["values"].([]int)[0] = 1
		_, updates, _ := l.computeDiffs(m)
		saved := created[0]["data"].(map[string]any)["value"].(map[string]any)
		if saved["values"].([]int)[0] != 0 || len(updates) != 1 {
			t.Fatalf("custom=%v: matrix source value aliased published state", custom)
		}
	}
}

func TestOwnedCustomProjectionDetachesAdditionalFields(t *testing.T) {
	type model struct{ extra map[string]any }
	m := &model{extra: map[string]any{"count": 0}}
	l := NewAgentLayer[*model, int]("agents").
		Items(func(*model) []int { return []int{1} }).
		Project(func(*model, int) map[string]any { return map[string]any{"id": 1} }).
		ProjectorOwnsValues(true).
		Field("data", func(m *model, _ int) any { return m.extra })
	created, _, _ := l.computeDiffs(m)
	m.extra["count"] = 1
	_, updates, _ := l.computeDiffs(m)
	if created[0]["data"].(map[string]any)["count"] != 0 || len(updates) != 1 {
		t.Fatal("additional field was incorrectly covered by the custom callback's ownership promise")
	}
}
