package binding

import (
	"reflect"
	"testing"
)

func TestMapAgentLayerStableOrderAndFalseEntry(t *testing.T) {
	type model struct{ flags map[string]bool }
	m := &model{flags: map[string]bool{"z": false, "a": true}}
	layer := NewMapAgentLayer[*model, string, bool]("flags").
		Source(func(m *model) map[string]bool { return m.flags }).
		Select("alive", "value").Select("label", "key").Const("icon", "circle")
	items := layer.projectItems(m, layer.itemList(m))
	if !reflect.DeepEqual([]any{items[0]["id"], items[1]["id"]}, []any{"a", "z"}) {
		t.Fatalf("unstable map order: %v", items)
	}
	if items[1]["data"].(map[string]any)["value"] != false {
		t.Fatalf("false map value was lost: %v", items[1])
	}
	if items[1]["alive"] != false || items[1]["label"] != "z" || items[1]["icon"] != "circle" {
		t.Fatalf("declarative map fields were not projected: %v", items[1])
	}
	layer.RestoreSource(nil, nil)
	spec := layer.restoreDefinition()
	if err := spec.Validate(m, map[string]any{"items": []map[string]any{items[0], items[0]}}); err == nil {
		t.Fatal("duplicate map IDs were accepted")
	}
	if err := spec.Validate(m, map[string]any{"items": []map[string]any{{"id": true, "data": map[string]any{"value": false}}}}); err == nil {
		t.Fatal("invalid map ID was accepted")
	}
	if !m.flags["a"] || m.flags["z"] {
		t.Fatal("invalid restore mutated the map")
	}
	if err := spec.Replace(m, []map[string]any{items[1]}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(m.flags, map[string]bool{"z": false}) {
		t.Fatalf("restore lost false value: %v", m.flags)
	}
}

func TestMatrixAgentLayerOrientationAndFlat(t *testing.T) {
	type model struct {
		cells [][]int
		flat  []int
	}
	m := &model{cells: [][]int{{1, 2}, {3, 4}}, flat: []int{1, 2, 3, 4}}
	layer := NewMatrixAgentLayer[*model, int]("cells").Source(func(m *model) [][]int { return m.cells })
	items := layer.projectItems(m, layer.itemList(m))
	if items[0]["id"] != "cell:0:0" || items[0]["x"] != 0 || items[0]["y"] != 1 || items[3]["y"] != 0 {
		t.Fatalf("wrong matrix coordinates: %v", items)
	}
	flat := NewMatrixAgentLayer[*model, int]("flat").Flat(
		func(*model) (int, int) { return 2, 2 },
		func(m *model, row, col int) int { return m.flat[row*2+col] },
	).Select("temperature", "value").Select("source_row", "row").Const("color", "red")
	flatItems := flat.projectItems(m, flat.itemList(m))
	if flatItems[0]["id"] != items[0]["id"] || flatItems[0]["y"] != items[0]["y"] ||
		flatItems[3]["temperature"] != 4 || flatItems[3]["source_row"] != 1 || flatItems[3]["color"] != "red" {
		t.Fatalf("flat matrix declarative fields disagree: %v", flatItems)
	}
	layer.RestoreSource(nil, nil)
	spec := layer.restoreDefinition()
	metadata := layer.data(m)
	if err := spec.Validate(m, map[string]any{"metadata": metadata, "items": items[:3]}); err == nil {
		t.Fatal("incomplete dense matrix was accepted")
	}
	if !reflect.DeepEqual(m.cells, [][]int{{1, 2}, {3, 4}}) {
		t.Fatal("invalid restore mutated the matrix")
	}
	if err := spec.Validate(m, map[string]any{"metadata": metadata, "items": items}); err != nil {
		t.Fatal(err)
	}
	if err := spec.Replace(m, items); err != nil {
		t.Fatal(err)
	}
}

func TestAgentLayerDirectSelectorsAndConstants(t *testing.T) {
	type agent struct {
		ID       string
		Position struct{ X int }
	}
	type model struct{ agents []agent }
	m := &model{agents: []agent{{ID: "a", Position: struct{ X int }{X: 3}}}}
	layer := NewAgentLayer[*model, agent]("agents").
		Items(func(m *model) []agent { return m.agents }).
		Select("id", "ID").Select("x", "Position.X").Const("icon", "circle")
	item := layer.projectItems(m, layer.itemList(m))[0]
	if item["id"] != "a" || item["x"] != 3 || item["icon"] != "circle" {
		t.Fatalf("agent fields were not projected: %v", item)
	}
}
