package binding

import (
	"testing"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
)

func TestEdgeDataTagsAndFields(t *testing.T) {
	type link struct {
		Source string         `tensnap:"source,scope=edge"`
		Target string         `tensnap:"target,scope=edge"`
		Data   map[string]any `tensnap:"data,scope=edge"`
	}
	for _, useField := range []bool{false, true} {
		item := &link{Source: "a", Target: "b", Data: map[string]any{"count": 0}}
		layer := NewEdgeLayer[*link, *link]("edges").
			Items(func(m *link) []*link { return []*link{m} }).ProjectTags()
		if useField {
			layer.Field("data", func(_ *link, item *link) any { return item.Data })
		}
		created, _, _ := layer.computeDiffs(item)
		item.Data["count"] = 1
		_, updated, _ := layer.computeDiffs(item)
		if len(created) != 1 || len(updated) != 1 ||
			created[0]["data"].(map[string]any)["count"] != 0 ||
			updated[0]["data"].(map[string]any)["count"] != 1 {
			t.Fatalf("edge data must survive tags/fields and nested mutation: created=%v updated=%v", created, updated)
		}
	}
}

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

func TestBuiltinScanScratchDoesNotEscape(t *testing.T) {
	type model struct{ items []map[string]any }
	type layer interface {
		computeDiffs(*model) ([]map[string]any, []map[string]any, []any)
	}
	for _, kind := range []string{"agent", "precise-agent", "edge", "trajectory"} {
		t.Run(kind, func(t *testing.T) {
			m := &model{items: []map[string]any{{"id": 0, "source": 0, "target": 1, "data": []int{0}}, {"id": 1, "source": 1, "target": 2, "data": []int{1}}}}
			items := func(m *model) []map[string]any { return m.items }
			fields := map[string]ItemFieldFunc[*model, map[string]any]{}
			for _, key := range []string{"id", "source", "target", "data"} {
				key := key
				fields[key] = func(_ *model, item map[string]any) any { return item[key] }
			}
			var l layer
			switch kind {
			case "edge":
				v := NewEdgeLayer[*model, map[string]any]("edges").Items(items)
				for key, field := range fields {
					v.Field(key, field)
				}
				l = v
			case "trajectory":
				v := NewTrajectoryLayer[*model, map[string]any]("trails").Items(items)
				for key, field := range fields {
					v.Field(key, field)
				}
				l = v
			default:
				v := NewAgentLayer[*model, map[string]any]("agents").Items(items)
				for key, field := range fields {
					v.Field(key, field)
				}
				if kind == "precise-agent" {
					v.ItemID(func(_ *model, item map[string]any) any { return item["id"] }).Changed(func(*model, map[string]any) bool { return true })
				}
				l = v
			}
			initial, _, _ := l.computeDiffs(m)
			if len(initial) != 2 || initial[0]["id"] != 0 || initial[1]["id"] != 1 {
				t.Fatal("scratch escaped into created records")
			}
			m.items[0]["data"].([]int)[0] = 2
			m.items[1]["data"].([]int)[0] = 3
			_, updates, _ := l.computeDiffs(m)
			if len(updates) != 2 || updates[0]["data"].([]int)[0] != 2 || updates[1]["data"].([]int)[0] != 3 {
				t.Fatal("scratch escaped into update records")
			}
			m.items[0]["data"].([]int)[0] = 4
			l.computeDiffs(m)
			if initial[0]["data"].([]int)[0] != 0 || updates[0]["data"].([]int)[0] != 2 {
				t.Fatal("later scan rewrote retained records")
			}
		})
	}
}

func TestBorrowedProjectorClearsBaseFields(t *testing.T) {
	base := func(_ int, item int) map[string]any {
		if item == 0 {
			return map[string]any{"optional": true}
		}
		return nil
	}
	fields := map[string]ItemFieldFunc[int, int]{"id": func(_ int, item int) any { return item }}
	project := borrowedProjector(base, fields)
	scratch := map[string]any{}
	first := abm.SnapshotItem(project(0, 0, scratch), true)
	second := project(0, 1, scratch)
	if _, present := second["optional"]; present {
		t.Fatal("scratch retained a previous item's base field")
	}
	if first["optional"] != true || first["id"] != 0 || second["id"] != 1 {
		t.Fatal("borrowed projection lifetime changed")
	}
}
