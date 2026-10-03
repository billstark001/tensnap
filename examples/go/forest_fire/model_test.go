package main

import (
	"reflect"
	"testing"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

type fireEmitter struct {
	abm.Sink
	items      []map[string]any
	layers     map[string]map[string]any
	restoreEnd *protocol.SceneRestoreEndPayload
}

func (e *fireEmitter) EnvLayerCreate(layer *protocol.EnvLayerCreatePayload) error {
	if e.layers == nil {
		e.layers = make(map[string]map[string]any)
	}
	e.layers[layer.LayerID] = layer.Data
	return nil
}

func (e *fireEmitter) ItemCreate(_ string, layerID string, items []map[string]any) error {
	if layerID == "cells" {
		e.items = append(e.items, items...)
	}
	return nil
}

func (e *fireEmitter) SceneRestoreEnd(result *protocol.SceneRestoreEndPayload) error {
	e.restoreEnd = result
	return nil
}

func TestForestFireMatrixBindingProjectsFlatCells(t *testing.T) {
	config := DefaultConfig()
	config.Width, config.Height = 4, 3
	emitter := &fireEmitter{}
	model := NewVizModel(config)
	if err := model.OnStateSync(emitter, &protocol.StateSyncPayload{
		RequestID: "fire-grid", ModelID: "examples.go.forest_fire",
	}); err != nil {
		t.Fatal(err)
	}
	if len(emitter.items) != config.Width*config.Height {
		t.Fatalf("expected %d matrix cells, got %d", config.Width*config.Height, len(emitter.items))
	}
	first, last := emitter.items[0], emitter.items[len(emitter.items)-1]
	if first["id"] != "cell:0:0" || first["x"] != 0 || first["y"] != config.Height-1 ||
		last["id"] != "cell:2:3" || last["x"] != 3 || last["y"] != 0 {
		t.Fatalf("incorrect matrix coordinates: first=%v last=%v", first, last)
	}
	for _, item := range emitter.items {
		data, ok := item["data"].(map[string]any)
		if !ok {
			t.Fatalf("cell is missing data.value: %v", item)
		}
		if _, err := decodeCellState(data["value"]); err != nil {
			t.Fatal(err)
		}
	}
	restored := make([]any, len(emitter.items))
	for index, item := range emitter.items {
		restored[index] = item
	}
	firstRestored := make(map[string]any)
	for key, value := range emitter.items[0] {
		firstRestored[key] = value
	}
	firstRestored["data"] = map[string]any{"value": burning}
	restored[0] = firstRestored
	version := "2"
	if err := model.OnSceneRestore(emitter, &protocol.SceneRestorePayload{
		RequestID: "restore-fire", ModelID: "examples.go.forest_fire", StateSchemaVersion: &version,
		Envs: []any{map[string]any{"id": "forest", "type": "2d", "layers": []any{
			map[string]any{"layer_id": "grid", "layer_type": "grid", "metadata": emitter.layers["grid"]},
			map[string]any{"layer_id": "cells", "layer_type": "agent", "metadata": emitter.layers["cells"], "items": restored},
		}}},
	}); err != nil {
		t.Fatal(err)
	}
	if emitter.restoreEnd == nil || emitter.restoreEnd.Status != "ok" {
		t.Fatalf("matrix scene restore failed: %#v", emitter.restoreEnd)
	}
	if emitter.items[len(emitter.items)-len(restored)]["data"].(map[string]any)["value"] != burning {
		t.Fatal("matrix scene restore did not replay the changed cell")
	}
}

func TestCheckpointResumesSameFire(t *testing.T) {
	config := DefaultConfig()
	config.Width, config.Height = 7, 6
	config.Lightning = 0.1
	m := NewModel(config)
	for range 8 {
		m.Step()
	}
	saved := m.Snapshot()
	m.Step()
	want := m.Snapshot()
	if err := m.Restore(saved); err != nil {
		t.Fatal(err)
	}
	m.Step()
	if !reflect.DeepEqual(m.Snapshot(), want) {
		t.Fatal("checkpoint did not resume the same fire path")
	}
}

func TestProjectedFireLayerRestoresCells(t *testing.T) {
	config := DefaultConfig()
	config.Width, config.Height = 4, 3
	m := NewModel(config)
	values := make([][]string, m.Height)
	for row := range values {
		values[row] = append([]string(nil), m.Cells[row*m.Width:(row+1)*m.Width]...)
	}
	m.Step()
	if err := restoreCellMatrix(m, values); err != nil {
		t.Fatal(err)
	}
	for row, items := range values {
		for col, state := range items {
			id := row*m.Width + col
			if m.Cells[id] != state {
				t.Fatal("projected cell state was not restored")
			}
		}
	}
}

func TestFireSpreadsSynchronouslyToCardinalTrees(t *testing.T) {
	config := DefaultConfig()
	config.Width, config.Height = 3, 3
	config.Growth, config.Lightning = 0, 0
	m := NewModel(config)
	for id := range m.Cells {
		m.Cells[id] = empty
	}
	m.Cells[4] = burning
	m.Cells[1] = tree // cardinal neighbor
	m.Cells[0] = tree // diagonal: not exposed until the following tick
	m.Step()
	if m.Cells[4] != empty || m.Cells[1] != burning || m.Cells[0] != tree {
		t.Fatalf("fire ignored synchronous four-neighbor rules: %v", m.Cells)
	}
	m.Step()
	if m.Cells[1] != empty || m.Cells[0] != burning {
		t.Fatalf("fire did not propagate on the next tick: %v", m.Cells)
	}
}
