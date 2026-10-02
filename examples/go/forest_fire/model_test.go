package main

import (
	"reflect"
	"testing"
)

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
	items := make([]map[string]any, len(m.Cells))
	for id, cell := range cells(m) {
		items[id] = map[string]any{
			"id": cell.ID, "x": id % m.Width, "y": id / m.Width,
			"data": map[string]any{"state": cell.State},
		}
	}
	m.Step()
	if err := restoreCells(m, items); err != nil {
		t.Fatal(err)
	}
	for id, item := range items {
		if m.Cells[id] != item["data"].(map[string]any)["state"] {
			t.Fatal("projected cell state was not restored")
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
