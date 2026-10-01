package main

import (
	"reflect"
	"testing"
)

func TestCheckpointResumesSameSIRSStep(t *testing.T) {
	config := DefaultConfig()
	config.Rows, config.Cols = 6, 7
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
		t.Fatal("checkpoint did not resume the same SIRS path")
	}
}

func TestProjectedSIRSLayerRestoresHealthStates(t *testing.T) {
	config := DefaultConfig()
	config.Rows, config.Cols = 3, 4
	m := NewModel(config)
	items := make([]map[string]any, len(m.People))
	for id, person := range m.People {
		items[id] = map[string]any{
			"id": person.ID, "x": id % m.Cols, "y": id / m.Cols,
			"data": map[string]any{"state": person.State},
		}
	}
	m.Step()
	if err := restorePeople(m, items); err != nil {
		t.Fatal(err)
	}
	for id, item := range items {
		if m.People[id].State != item["data"].(map[string]any)["state"] {
			t.Fatal("projected health state was not restored")
		}
	}
}
